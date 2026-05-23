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
  joinByInvite: (code: string, email: string) => Project | null
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

  joinByInvite: (code, email) => {
    const project = get().projects.find(p => p.inviteCode === code)
    if (!project) return null
    if (project.memberEmails?.includes(email)) return project
    const memberEmails = [...(project.memberEmails ?? []), email]
    const projects = get().projects.map(p => p.id === project.id ? { ...p, memberEmails } : p)
    set({ projects }); persist(projects); syncFb(projects)
    return { ...project, memberEmails }
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
