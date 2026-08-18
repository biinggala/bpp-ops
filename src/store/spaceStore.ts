import { create } from 'zustand'
import { ref, set as fbSet, update as fbUpdate, remove as fbRemove } from 'firebase/database'
import { db } from '../lib/firebase'
import { gid } from '../lib/utils'
import { P } from '../lib/paths'
import { SPACE_PALETTE } from '../types'
import type { Space } from '../types'

// Spaces are workspace-wide labels — no project owns them, and every signed-in
// person shares the same set. See the note in docs/data-model.md.

interface SpaceState {
  spaces: Space[]
  addSpace: (name: string) => Space
  updateSpace: (id: string, patch: Partial<Omit<Space, 'id'>>) => void
  deleteSpace: (id: string) => void
  applyRemote: (spaces: Space[]) => void
}

export const useSpaceStore = create<SpaceState>((set, get) => ({
  spaces: [],

  addSpace: (name) => {
    const existing = get().spaces
    const space: Space = {
      id: gid(),
      name: name.trim(),
      color: SPACE_PALETTE[existing.length % SPACE_PALETTE.length],
    }
    set({ spaces: [...existing, space] })
    fbSet(ref(db, P.space(space.id)), space).catch(e => console.warn('[space add]', e))
    return space
  },

  updateSpace: (id, patch) => {
    set({ spaces: get().spaces.map(s => s.id === id ? { ...s, ...patch } : s) })
    fbUpdate(ref(db, P.space(id)), patch).catch(e => console.warn('[space update]', e))
  },

  deleteSpace: (id) => {
    set({ spaces: get().spaces.filter(s => s.id !== id) })
    fbRemove(ref(db, P.space(id))).catch(e => console.warn('[space delete]', e))
  },

  applyRemote: (spaces) => set({ spaces }),
}))
