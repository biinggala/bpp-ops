import { create } from 'zustand'
import { ref, get as fbGet, set as fbSet, update as fbUpdate, remove as fbRemove } from 'firebase/database'
import { db } from '../lib/firebase'
import { gid } from '../lib/utils'
import { P } from '../lib/paths'
import { PROJECT_PALETTE } from '../types'
import { useAuthStore } from './authStore'
import { useUserProfileStore } from './userProfileStore'
import type { Project } from '../types'

/**
 * A project is now a subtree: meta holds what the UI draws, members/$uid is what
 * the rules check. Both list the same people, so joining and removing have to
 * write both — members alone would leave someone invisible in the member list,
 * meta alone would leave them unable to open the project at all.
 */

export interface InviteEntry {
  code: string
  name: string
}

interface ProjectState {
  projects: Project[]
  /** Invitations addressed to me, from invitesByEmail. Keyed by project id. */
  invites: Record<string, InviteEntry>
  addProject: (name: string, color?: string, dueDate?: string, clientName?: string, creatorEmail?: string) => Project
  updateProject: (id: string, patch: Partial<Omit<Project, 'id'>>) => void
  deleteProject: (id: string) => void
  addMember: (projectId: string, email: string) => void
  removeMember: (projectId: string, email: string) => void
  joinProject: (projectId: string, inviteCode: string) => Promise<boolean>
  applyRemote: (projects: Project[]) => void
  applyInvites: (invites: Record<string, InviteEntry>) => void
}

const lower = (e: string) => e.toLowerCase().trim()

function uidForEmail(email: string): string | null {
  const target = lower(email)
  const profiles = useUserProfileStore.getState().profiles
  for (const [uid, profile] of Object.entries(profiles)) {
    if (profile.email?.toLowerCase() === target) return uid
  }
  return null
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  invites: {},

  addProject: (name, color, dueDate, clientName, creatorEmail) => {
    const uid = useAuthStore.getState().uid
    const existing = get().projects
    const inviteCode = gid().slice(0, 8)
    const project: Project = {
      id: gid(),
      name: name.trim(),
      color: color ?? PROJECT_PALETTE[existing.length % PROJECT_PALETTE.length],
      inviteCode,
      memberEmails: creatorEmail ? [lower(creatorEmail)] : [],
      ...(creatorEmail ? { creatorEmail: lower(creatorEmail) } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(clientName ? { clientName } : {}),
    }
    set({ projects: [...existing, project] })

    if (uid) {
      // The rules only accept a brand new project if the creator is already in
      // its members list, so the whole subtree goes in one write.
      const { id, ...meta } = project
      fbUpdate(ref(db), {
        [P.project(id)]: { meta: { id, ...meta, teamId: null }, members: { [uid]: inviteCode } },
        [P.userProject(uid, id)]: true,
      }).catch(e => console.warn('[project create]', e))
    }
    return project
  },

  updateProject: (id, patch) => {
    set({ projects: get().projects.map(p => p.id === id ? { ...p, ...patch } : p) })
    const payload: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) payload[k] = v === undefined ? null : v
    fbUpdate(ref(db, P.projectMeta(id)), payload).catch(e => console.warn('[project update]', e))
  },

  deleteProject: (id) => {
    const uid = useAuthStore.getState().uid
    set({ projects: get().projects.filter(p => p.id !== id) })
    fbRemove(ref(db, P.project(id))).catch(e => console.warn('[project delete]', e))
    // Other members keep a dangling index entry; their client drops it when the
    // project reads back empty.
    if (uid) fbRemove(ref(db, P.userProject(uid, id))).catch(() => {})
  },

  addMember: (projectId, email) => {
    const normalized = lower(email)
    const project = get().projects.find(p => p.id === projectId)
    if (!project) return
    const active = project.memberEmails ?? []
    const pending = project.pendingEmails ?? []
    if ([...active, ...pending].some(e => lower(e) === normalized)) return

    const pendingEmails = [...pending, normalized]
    set({ projects: get().projects.map(p => p.id === projectId ? { ...p, pendingEmails } : p) })

    // The invitation is filed under the invitee's address because they cannot
    // read the project yet — this is the only thing they can see before joining.
    fbUpdate(ref(db), {
      [`${P.projectMeta(projectId)}/pendingEmails`]: pendingEmails,
      [P.inviteEntry(normalized, projectId)]: { code: project.inviteCode ?? '', name: project.name },
    }).catch(e => console.warn('[invite]', e))
  },

  removeMember: (projectId, email) => {
    const normalized = lower(email)
    const project = get().projects.find(p => p.id === projectId)
    if (!project) return
    const memberEmails = (project.memberEmails ?? []).filter(e => lower(e) !== normalized)
    const pendingEmails = (project.pendingEmails ?? []).filter(e => lower(e) !== normalized)
    set({ projects: get().projects.map(p => p.id === projectId ? { ...p, memberEmails, pendingEmails } : p) })

    const payload: Record<string, unknown> = {
      [`${P.projectMeta(projectId)}/memberEmails`]: memberEmails,
      [`${P.projectMeta(projectId)}/pendingEmails`]: pendingEmails,
      [P.inviteEntry(normalized, projectId)]: null,
    }
    // Revoking access means removing the members entry; dropping the address
    // from meta alone would leave them able to open the project.
    const uid = uidForEmail(normalized)
    if (uid) payload[P.projectMember(projectId, uid)] = null
    fbUpdate(ref(db), payload).catch(e => console.warn('[member remove]', e))
  },

  joinProject: async (projectId, inviteCode) => {
    const { uid, email } = useAuthStore.getState()
    if (!uid) return false
    try {
      // Membership first: until this lands the caller cannot touch anything else
      // under the project, so it cannot be folded into one atomic update.
      await fbSet(ref(db, P.projectMember(projectId, uid)), inviteCode)
      await fbSet(ref(db, P.userProject(uid, projectId)), true)
    } catch {
      return false   // wrong code, or the project is gone
    }

    if (email) {
      const normalized = lower(email)
      try {
        const snap = await fbGet(ref(db, P.projectMeta(projectId)))
        const meta = snap.val() ?? {}
        const memberEmails: string[] = meta.memberEmails ?? []
        const pendingEmails: string[] = meta.pendingEmails ?? []
        await fbUpdate(ref(db), {
          [`${P.projectMeta(projectId)}/memberEmails`]:
            memberEmails.some(e => lower(e) === normalized) ? memberEmails : [...memberEmails, normalized],
          [`${P.projectMeta(projectId)}/pendingEmails`]: pendingEmails.filter(e => lower(e) !== normalized),
          [P.inviteEntry(normalized, projectId)]: null,
        })
      } catch (e) {
        // Access is already granted; the display list just did not catch up.
        console.warn('[join tidy-up]', e)
      }
    }
    return true
  },

  applyRemote: (projects) => set({ projects }),
  applyInvites: (invites) => set({ invites }),
}))
