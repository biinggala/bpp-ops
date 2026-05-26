import { create } from 'zustand'
import { ref, onValue, off, update } from 'firebase/database'
import { db } from '../lib/firebase'
import { gid, loadFromStorage, saveToStorage, getLocalTs } from '../lib/utils'
import type { Milestone } from '../types'

const MILESTONE_KEY = 'cringe_milestones_v1'

interface MilestoneState {
  milestones: Milestone[]
  addMilestone: (projectId: string, name: string, dueDate: string) => Milestone
  updateMilestone: (id: string, patch: Partial<Omit<Milestone, 'id'>>) => void
  deleteMilestone: (id: string) => void
  deleteMilestonesForProject: (projectId: string) => void
  getMilestonesForProject: (projectId: string) => Milestone[]
  subscribeFirebase: () => () => void
}

function persist(milestones: Milestone[]) {
  saveToStorage(milestones, MILESTONE_KEY)
}

function syncFb(milestones: Milestone[]) {
  // Atomic update: both keys change in a single server operation
  update(ref(db, 'cringe'), {
    milestones: milestones.length ? milestones : null,
    milestonesSavedAt: Date.now(),
  }).catch(() => {})
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

  deleteMilestonesForProject: (projectId) => {
    const milestones = get().milestones.filter(m => m.projectId !== projectId)
    set({ milestones }); persist(milestones); syncFb(milestones)
  },

  getMilestonesForProject: (projectId) => {
    return get().milestones.filter(m => m.projectId === projectId)
  },

  subscribeFirebase: () => {
    const dbRef = ref(db, 'cringe')
    const handler = onValue(dbRef, (snap) => {
      const root = snap.val()
      const localTs = getLocalTs(MILESTONE_KEY)

      if (!root?.milestones) {
        // Firebase has no milestones — push local data if we have any
        const milestones = get().milestones
        if (milestones.length > 0 && localTs > 0) {
          syncFb(milestones)
        }
        return
      }

      const fbTs: number = root.milestonesSavedAt || 0
      if (fbTs > localTs || localTs === 0) {
        const incoming: Milestone[] = Array.isArray(root.milestones)
          ? root.milestones
          : Object.values(root.milestones)
        set({ milestones: incoming })
        saveToStorage(incoming, MILESTONE_KEY)
      }
    })
    return () => off(dbRef, 'value', handler)
  },
}))
