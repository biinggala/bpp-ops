import { create } from 'zustand'
import { ref, set as fbSet, update as fbUpdate, remove as fbRemove } from 'firebase/database'
import { db } from '../lib/firebase'
import { gid } from '../lib/utils'
import { P } from '../lib/paths'
import type { Milestone } from '../types'

// Milestones live under their project, so a milestone without one has nowhere
// to go — every writer here needs a project id.

interface MilestoneState {
  milestones: Milestone[]
  addMilestone: (projectId: string, name: string, dueDate: string) => Milestone
  updateMilestone: (id: string, patch: Partial<Omit<Milestone, 'id'>>) => void
  deleteMilestone: (id: string) => void
  deleteMilestonesForProject: (projectId: string) => void
  getMilestonesForProject: (projectId: string) => Milestone[]
  applyRemote: (milestones: Milestone[]) => void
}

export const useMilestoneStore = create<MilestoneState>((set, get) => ({
  milestones: [],

  addMilestone: (projectId, name, dueDate) => {
    const milestone: Milestone = { id: gid(), projectId, name: name.trim(), dueDate }
    set({ milestones: [...get().milestones, milestone] })
    const { projectId: _pid, ...rest } = milestone
    fbSet(ref(db, P.projectMilestone(projectId, milestone.id)), rest)
      .catch(e => console.warn('[milestone add]', e))
    return milestone
  },

  updateMilestone: (id, patch) => {
    const current = get().milestones.find(m => m.id === id)
    if (!current) return
    set({ milestones: get().milestones.map(m => m.id === id ? { ...m, ...patch } : m) })
    const payload: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'projectId') continue   // moving a milestone would change its path
      payload[k] = v === undefined ? null : v
    }
    fbUpdate(ref(db, P.projectMilestone(current.projectId, id)), payload)
      .catch(e => console.warn('[milestone update]', e))
  },

  deleteMilestone: (id) => {
    const current = get().milestones.find(m => m.id === id)
    if (!current) return
    set({ milestones: get().milestones.filter(m => m.id !== id) })
    fbRemove(ref(db, P.projectMilestone(current.projectId, id)))
      .catch(e => console.warn('[milestone delete]', e))
  },

  // Deleting a project removes its whole subtree, milestones included, so this
  // only has to drop them from local state until the subscription catches up.
  deleteMilestonesForProject: (projectId) => {
    set({ milestones: get().milestones.filter(m => m.projectId !== projectId) })
  },

  getMilestonesForProject: (projectId) => get().milestones.filter(m => m.projectId === projectId),

  applyRemote: (milestones) => set({ milestones }),
}))
