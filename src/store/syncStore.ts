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
  /**
   * 첫 그림이 다 도착했는가.
   *
   * 예전엔 프로젝트 **목록**이 오는 순간 참이 됐습니다. 목록은 이름표 몇 개라
   * 즉시 오지만 그 안의 업무는 프로젝트마다 따로 읽어 와야 하고, 그 사이 몇
   * 초 동안 앱은 "업무 0개"를 아주 자신 있게 보여 줬습니다. 없는 것과 아직
   * 안 온 것은 다른 말인데 화면에서는 같아 보였습니다.
   *
   * 이제는 목록에 적힌 프로젝트가 **하나도 빠짐없이 한 번씩 응답한 뒤에야**
   * 참이 됩니다. 응답에는 거절도 포함됩니다 — 못 읽는 프로젝트를 영원히
   * 기다리면 로딩 표시가 안 끝납니다.
   */
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

    // 아직 첫 응답을 안 준 프로젝트들. 비면 그림이 다 온 것입니다.
    const awaiting = new Set<string>()
    let indexSeen = false
    let personalSeen = false

    const settle = () => {
      if (stopped) return
      set({ ready: indexSeen && personalSeen && awaiting.size === 0 })
    }

    // 끝나지 않는 로딩 표시는 빈 목록보다 나쁩니다. 연결이 안 좋아 한
    // 프로젝트가 영영 대답을 안 해도, 8초 뒤에는 지금까지 온 것으로
    // 화면을 엽니다.
    const deadline = window.setTimeout(() => {
      if (stopped) return
      awaiting.clear()
      indexSeen = true
      personalSeen = true
      settle()
    }, 8000)

    /**
     * ── 다시 펼치기 ────────────────────────────────────────────────────────────
     *
     * 프로젝트 하나가 오면 **모든** 프로젝트의 모든 업무를 새 객체로 다시
     * 만들고 있었습니다. 남이 업무 하나의 상태를 바꾸면 내 화면의 업무 이천
     * 개가 전부 새것이 되고, 그것에 기대던 memo와 목록 줄이 통째로 다시
     * 그려졌습니다. 프로젝트가 스무 개면 처음 켤 때만 스무 번입니다.
     *
     * 두 가지를 고칩니다.
     *
     * **바뀐 프로젝트만 다시 만듭니다.** onValue가 준 node 객체를 기억해 두고,
     * 같은 객체면 지난번에 만들어 둔 배열을 그대로 씁니다 — 객체 정체까지
     * 그대로라 React가 '안 바뀌었다'를 알아봅니다.
     *
     * **바뀐 프로젝트 안에서도 그대로인 업무는 그대로 둡니다.** 한 줄을
     * 고쳤다고 그 프로젝트의 나머지 백 줄이 다시 그려질 이유는 없습니다.
     */
    const shaped = new Map<string, {
      node: ProjectNode
      project: Project
      tasks: Task[]
      milestones: Milestone[]
      members: Record<string, string>
    }>()
    /** 지난번에 내보낸 업무들, id로. 같은 내용이면 그 객체를 다시 씁니다. */
    let lastTaskById = new Map<string, Task>()

    const keep = <T extends { id: string }>(next: T, prev: T | undefined): T =>
      prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next

    /**
     * 한 박자에 한 번만.
     *
     * 앱을 켜면 프로젝트 스무 개가 거의 동시에 도착합니다. 도착할 때마다
     * 다시 펼치면 스무 번을 펼치고 스무 번을 그립니다 — 마지막 한 번 말고는
     * 전부 버려지는 그림입니다. 같은 틱에 온 것들은 모아서 한 번에 냅니다.
     */
    let pending = false
    const republish = () => {
      if (stopped || pending) return
      pending = true
      queueMicrotask(() => { pending = false; publish() })
    }

    const publish = () => {
      if (stopped) return

      const projects: Project[] = []
      const tasks: Task[] = []
      const milestones: Milestone[] = []
      const membersByProject: Record<string, Record<string, string>> = {}
      const nextTaskById = new Map<string, Task>()

      for (const [pid, node] of nodes) {
        if (!node.meta) continue          // still loading, or the project is gone

        let cut = shaped.get(pid)
        if (!cut || cut.node !== node) {
          cut = {
            node,
            project: keep({ ...(node.meta as Project), id: pid }, shaped.get(pid)?.project),
            members: node.members ?? {},
            // The task's own projectId is trusted over its location only when
            // they agree; the path is the thing the rules enforce, so it wins.
            tasks: values(node.tasks).map(task =>
              keep({ ...task, projectId: pid }, lastTaskById.get(task.id))),
            milestones: values(node.milestones).map(m => ({ ...m, projectId: pid })),
          }
          shaped.set(pid, cut)
        }

        projects.push(cut.project)
        membersByProject[pid] = cut.members
        for (const task of cut.tasks) { tasks.push(task); nextTaskById.set(task.id, task) }
        for (const milestone of cut.milestones) milestones.push(milestone)
      }
      for (const task of values(personalTasks)) {
        const t = keep({ ...task, projectId: undefined }, lastTaskById.get(task.id))
        tasks.push(t); nextTaskById.set(t.id, t)
      }
      lastTaskById = nextTaskById

      // 목록에서 사라진 프로젝트의 캐시는 같이 버립니다.
      for (const pid of shaped.keys()) if (!nodes.has(pid)) shaped.delete(pid)

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
      awaiting.add(pid)
      const handler = onValue(projectRef, snap => {
        const node: ProjectNode | null = snap.val()
        if (node) nodes.set(pid, node)
        else nodes.delete(pid)   // deleted, or access was removed
        awaiting.delete(pid)
        settle()
        republish()
      }, () => {
        // Listed in our index but not readable: treat it as not ours.
        nodes.delete(pid)
        awaiting.delete(pid)
        settle()
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
        awaiting.delete(pid)
      }
      indexSeen = true
      settle()
      republish()
    })

    const personalRef = ref(db, P.personalTasks(uid))
    const personalHandler = onValue(personalRef, snap => {
      personalTasks = snap.val() ?? {}
      personalSeen = true
      settle()
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
      clearTimeout(deadline)
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
