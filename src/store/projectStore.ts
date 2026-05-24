import { create } from 'zustand'
import { ref, set as fbSet, onValue, off } from 'firebase/database'
import { db } from '../lib/firebase'
import { gid, loadFromStorage, saveToStorage } from '../lib/utils'
import { PROJECT_PALETTE } from '../types'
import type { Project } from '../types'

const PROJECT_KEY = 'cringe_projects_v1'

interface ProjectState {
  projects: Project[]
  addProject: (name: string, color?: string, dueDate?: string, clientName?: string, creatorEmail?: string) => Project
  updateProject: (id: string, patch: Partial<Omit<Project, 'id'>>) => void
  deleteProject: (id: string) => void
  addMember: (projectId: string, email: string) => void
  removeMember: (projectId: string, email: string) => void
  acceptInvite: (projectId: string, email: string) => void
  findByInvite: (code: string, email: string) => { project: Project; status: 'active' | 'pending' } | null
  subscribeFirebase: () => () => void
}

function persist(projects: Project[]) {
  saveToStorage(projects, PROJECT_KEY)
}

function syncFb(projects: Project[]) {
  fbSet(ref(db, 'cringe/projects'), projects).catch(() => {})
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: loadFromStorage<Project[]>(PROJECT_KEY) ?? [],

  addProject: (name, color, dueDate, clientName, creatorEmail) => {
    const existing = get().projects
    const resolvedColor = color ?? PROJECT_PALETTE[existing.length % PROJECT_PALETTE.length]
    const project: Project = {
      id: gid(),
      name: name.trim(),
      color: resolvedColor,
      inviteCode: gid().slice(0, 8),
      memberEmails: creatorEmail ? [creatorEmail] : [],
      ...(creatorEmail ? { creatorEmail: creatorEmail.toLowerCase() } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(clientName ? { clientName } : {}),
    }
    const projects = [...existing, project]
    set({ projects }); persist(projects); syncFb(projects)
    return project
  },

  updateProject: (id, patch) => {
    const projects = get().projects.map(p => p.id === id ? { ...p, ...patch } : p)
    set({ projects }); persist(projects); syncFb(projects)
  },

  deleteProject: (id) => {
    const projects = get().projects.filter(p => p.id !== id)
    set({ projects }); persist(projects); syncFb(projects)
  },

  addMember: (projectId, email) => {
    const normalized = email.toLowerCase().trim()
    const projects = get().projects.map(p => {
      if (p.id !== projectId) return p
      const active = p.memberEmails ?? []
      const pending = p.pendingEmails ?? []
      if (active.some(e => e.toLowerCase() === normalized)) return p
      if (pending.some(e => e.toLowerCase() === normalized)) return p
      return { ...p, pendingEmails: [...pending, normalized] }
    })
    set({ projects }); persist(projects); syncFb(projects)
  },

  removeMember: (projectId, email) => {
    const normalized = email.toLowerCase().trim()
    const projects = get().projects.map(p => {
      if (p.id !== projectId) return p
      return {
        ...p,
        memberEmails: (p.memberEmails ?? []).filter(e => e.toLowerCase() !== normalized),
        pendingEmails: (p.pendingEmails ?? []).filter(e => e.toLowerCase() !== normalized),
      }
    })
    set({ projects }); persist(projects); syncFb(projects)
  },

  acceptInvite: (projectId, email) => {
    const normalized = email.toLowerCase().trim()
    const projects = get().projects.map(p => {
      if (p.id !== projectId) return p
      const pendingEmails = (p.pendingEmails ?? []).filter(e => e.toLowerCase() !== normalized)
      const alreadyActive = (p.memberEmails ?? []).some(e => e.toLowerCase() === normalized)
      const memberEmails = alreadyActive ? (p.memberEmails ?? []) : [...(p.memberEmails ?? []), normalized]
      return { ...p, pendingEmails, memberEmails }
    })
    set({ projects }); persist(projects); syncFb(projects)
  },

  findByInvite: (code, email) => {
    const project = get().projects.find(p => p.inviteCode === code)
    if (!project) return null
    const normalized = email.toLowerCase().trim()
    // Legacy open project (no access lists) — treat as active
    if (!project.memberEmails?.length && !project.pendingEmails?.length) {
      return { project, status: 'active' }
    }
    if (project.memberEmails?.some(e => e.toLowerCase() === normalized)) {
      return { project, status: 'active' }
    }
    if (project.pendingEmails?.some(e => e.toLowerCase() === normalized)) {
      return { project, status: 'pending' }
    }
    return null
  },

  subscribeFirebase: () => {
    const dbRef = ref(db, 'cringe/projects')
    const handler = onValue(dbRef, (snap) => {
      const data = snap.val()
      if (!data) return
      const incoming: Project[] = Array.isArray(data) ? data : Object.values(data)
      set({ projects: incoming })
      persist(incoming)
    })
    return () => off(dbRef, 'value', handler)
  },
}))
