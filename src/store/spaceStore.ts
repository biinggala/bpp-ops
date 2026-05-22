import { create } from 'zustand'
import { ref, set as fbSet, onValue, off } from 'firebase/database'
import { db } from '../lib/firebase'
import { gid, loadFromStorage, saveToStorage } from '../lib/utils'
import { SPACE_PALETTE } from '../types'
import type { Space } from '../types'

const SPACE_KEY = 'cringe_spaces_v1'

interface SpaceState {
  spaces: Space[]
  addSpace: (name: string) => Space
  updateSpace: (id: string, patch: Partial<Omit<Space, 'id'>>) => void
  deleteSpace: (id: string) => void
  subscribeFirebase: () => () => void
}

function persist(spaces: Space[]) {
  saveToStorage(spaces, SPACE_KEY)
}

function syncFb(spaces: Space[]) {
  fbSet(ref(db, 'cringe/spaces'), spaces).catch(() => {})
}

export const useSpaceStore = create<SpaceState>((set, get) => ({
  spaces: loadFromStorage<Space[]>(SPACE_KEY) ?? [],

  addSpace: (name) => {
    const existing = get().spaces
    const color = SPACE_PALETTE[existing.length % SPACE_PALETTE.length]
    const space: Space = { id: gid(), name: name.trim(), color }
    const spaces = [...existing, space]
    set({ spaces }); persist(spaces); syncFb(spaces)
    return space
  },

  updateSpace: (id, patch) => {
    const spaces = get().spaces.map(s => s.id === id ? { ...s, ...patch } : s)
    set({ spaces }); persist(spaces); syncFb(spaces)
  },

  deleteSpace: (id) => {
    const spaces = get().spaces.filter(s => s.id !== id)
    set({ spaces }); persist(spaces); syncFb(spaces)
  },

  subscribeFirebase: () => {
    const dbRef = ref(db, 'cringe/spaces')
    const handler = onValue(dbRef, (snap) => {
      const data = snap.val()
      if (!data) return
      const incoming: Space[] = Array.isArray(data) ? data : Object.values(data)
      set({ spaces: incoming })
      persist(incoming)
    })
    return () => off(dbRef, 'value', handler)
  },
}))
