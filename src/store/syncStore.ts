// Owns every Realtime Database subscription the app makes.
//
// Under the old layout one listener on the `cringe` root delivered the whole
// workspace to every client. The rules now scope data per project, and a parent
// can only be read when every child is readable — so `projects` as a whole is
// closed and the client has to be told which projects are its own. That list is
// userIndex/$uid/projects; this module follows it and attaches one listener per
// project, then fans the result out into the stores the components already use.
//
// Keeping the fan-out here means the stores stay plain state containers and the
// components see exactly the shapes they saw before.

import { create } from 'zustand'
import { ref, onValue, off, type Unsubscribe } from 'firebase/database'
import { db } from '../lib/firebase'
import { P } from '../lib/paths'
import { useProjectStore } from './projectStore'
import { useTaskStore } from './taskStore'
import { useMilestoneStore } from './milestoneStore'
import { useSpaceStore } from './spaceStore'
import { useUserProfileStore } from './userProfileStore'
import type { Milestone, Project, Space, Task } from '../types'

interface ProjectNode {
  meta?: Partial<Project>
  members?: Record<string, string>
  tasks?: Record<string, Task>
  milestones?: Record<string, Milestone>
}

interface SyncState {
  /** uid → invite code, per project. Needed to remove a member by address. */
  membersByProject: Record<string, Record<string, string>>
  ready: boolean
  subscribe: (uid: string, email: string | null) => () => void
}

const values = <T,>(record: Record<string, T> | undefined): T[] =>
  record ? Object.values(record).filter(Boolean) : []

export const useSyncStore = create<SyncState>((set) => ({
  membersByProject: {},
  ready: false,

  subscribe: (uid, email) => {
    const nodes = new Map<string, ProjectNode>()
    const projectListeners = new Map<string, Unsubscribe>()
    const profileListeners = new Map<string, Unsubscribe>()
    let personalTasks: Record<string, Task> = {}
    let stopped = false

    const republish = () => {
      if (stopped) return

      const projects: Project[] = []
      const tasks: Task[] = []
      const milestones: Milestone[] = []
      const membersByProject: Record<string, Record<string, string>> = {}

      for (const [pid, node] of nodes) {
        if (!node.meta) continue          // still loading, or the project is gone
        projects.push({ ...(node.meta as Project), id: pid })
        membersByProject[pid] = node.members ?? {}
        // The task's own projectId is trusted over its location only when they
        // agree; the path is the thing the rules enforce, so it wins.
        for (const task of values(node.tasks)) tasks.push({ ...task, projectId: pid })
        for (const milestone of values(node.milestones)) milestones.push({ ...milestone, projectId: pid })
      }
      for (const task of values(personalTasks)) tasks.push({ ...task, projectId: undefined })

      useProjectStore.getState().applyRemote(projects)
      useTaskStore.getState().applyRemote(tasks)
      useMilestoneStore.getState().applyRemote(milestones)
      set({ membersByProject })

      // Names come from profiles read one uid at a time — the whole
      // userProfiles node is closed, so there is no directory to enumerate.
      const wanted = new Set<string>([uid])
      for (const members of Object.values(membersByProject)) {
        for (const memberUid of Object.keys(members)) wanted.add(memberUid)
      }
      for (const profileUid of wanted) {
        if (profileListeners.has(profileUid)) continue
        const profileRef = ref(db, P.userProfile(profileUid))
        const handler = onValue(profileRef, snap => {
          const profile = snap.val()
          if (profile) useUserProfileStore.getState().applyRemote(profileUid, profile)
        }, () => { /* not readable — leave the name unresolved */ })
        profileListeners.set(profileUid, () => off(profileRef, 'value', handler))
      }
    }

    const watchProject = (pid: string) => {
      if (projectListeners.has(pid)) return
      const projectRef = ref(db, P.project(pid))
      const handler = onValue(projectRef, snap => {
        const node: ProjectNode | null = snap.val()
        if (node) nodes.set(pid, node)
        else nodes.delete(pid)   // deleted, or access was removed
        republish()
      }, () => {
        // Listed in our index but not readable: treat it as not ours.
        nodes.delete(pid)
        republish()
      })
      projectListeners.set(pid, () => off(projectRef, 'value', handler))
    }

    const indexRef = ref(db, P.userProjects(uid))
    const indexHandler = onValue(indexRef, snap => {
      const wanted = new Set(Object.keys(snap.val() ?? {}))
      for (const pid of wanted) watchProject(pid)
      for (const [pid, stop] of projectListeners) {
        if (wanted.has(pid)) continue
        stop()
        projectListeners.delete(pid)
        nodes.delete(pid)
      }
      set({ ready: true })
      republish()
    })

    const personalRef = ref(db, P.personalTasks(uid))
    const personalHandler = onValue(personalRef, snap => {
      personalTasks = snap.val() ?? {}
      republish()
    })

    // Invitations addressed to me. This is the one thing a not-yet-member can
    // read, so it is how an invited person discovers a project at all.
    const inviteRef = email ? ref(db, P.inviteInbox(email)) : null
    const inviteHandler = inviteRef
      ? onValue(inviteRef, snap => {
          const raw = snap.val() ?? {}
          const invites: Record<string, { code: string; name: string }> = {}
          for (const [pid, value] of Object.entries(raw)) {
            // Older entries stored the bare code as a string.
            invites[pid] = typeof value === 'string'
              ? { code: value, name: '' }
              : (value as { code: string; name: string })
          }
          useProjectStore.getState().applyInvites(invites)
        })
      : null

    const spacesRef = ref(db, 'spaces')
    const spacesHandler = onValue(spacesRef, snap => {
      useSpaceStore.getState().applyRemote(values<Space>(snap.val()))
    })

    return () => {
      stopped = true
      off(indexRef, 'value', indexHandler)
      off(personalRef, 'value', personalHandler)
      off(spacesRef, 'value', spacesHandler)
      if (inviteRef && inviteHandler) off(inviteRef, 'value', inviteHandler)
      for (const stop of projectListeners.values()) stop()
      for (const stop of profileListeners.values()) stop()
      projectListeners.clear()
      profileListeners.clear()
      set({ ready: false })
    }
  },
}))

/** Where a task lives depends on whether it belongs to a project. */
export function taskPath(task: Pick<Task, 'id' | 'projectId'>, uid: string): string {
  return task.projectId ? P.projectTask(task.projectId, task.id) : P.personalTask(uid, task.id)
}
