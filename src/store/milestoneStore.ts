import { create } from 'zustand'
import { ref, set as fbSet, onValue, off } from 'firebase/database'
import { db } from '../lib/firebase'
import { gid, loadFromStorage, saveToStorage } from '../lib/utils'
import type { Milestone } from '../types'

const MILESTONE_KEY = 'cringe_milestones_v1'

interface MilestoneState {
  milestones: Milestone[]
  addMilestone: (projectId: string, name: string, dueDate: string) => Milestone
  updateMilestone: (id: string, patch: Partial<Omit<Milestone, 'id'>>) => void
  deleteMilestone: (id: string) => void
  getMilestonesForProject: (projectId: string) => Milestone[]
  subscribeFirebase: () => () => void
}

function persist(milestones: Milestone[]) {
  saveToStorage(milestones, MILESTONE_KEY)
}

function syncFb(milestones: Milestone[]) {
  fbSet(ref(db, 'cringe/milestones'), milestones).catch(() => {})
}

export const useMilestoneStore = create<MilestoneState>((set, get) => ({
  milestones: loadFromStorage<Milestone[]>(MILESTONE_KEY) ?? [],

  addMilestone: (projectId, name, dueDate) => {
    const milestone: Milestone = { id: gid(), projectId, name: name.trim(), dueDate }
    const milestones = [...get().milestones, milestone]
    set({ milestones }); persist(milestones); syncFb(milestones)
    return milestone
  },

  updateMilestone: (id, patch) => {
    const milestones = get().milestones.map(m => m.id === id ? { ...m, ...patch } : m)
    set({ milestones }); persist(milestones); syncFb(milestones)
  },

  deleteMilestone: (id) => {
    const milestones = get().milestones.filter(m => m.id !== id)
    set({ milestones }); persist(milestones); syncFb(milestones)
  },

  getMilestonesForProject: (projectId) => {
    return get().milestones.filter(m => m.projectId === projectId)
  },

  subscribeFirebase: () => {
    const dbRef = ref(db, 'cringe/milestones')
    const handler = onValue(dbRef, (snap) => {
      const data = snap.val()
      if (!data) return
      const incoming: Milestone[] = Array.isArray(data) ? data : Object.values(data)
      set({ milestones: incoming })
      persist(incoming)
    })
    return () => off(dbRef, 'value', handler)
  },
}))
