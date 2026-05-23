import { create } from 'zustand'
import { ref, set as fbSet, onValue, onDisconnect } from 'firebase/database'
import { db } from '../lib/firebase'

export interface PresenceEntry {
  memberKey: string   // MemberKey ('YL'|'SJ'|'HC') or uid for guests
  name: string        // Google display name
  online: boolean
  lastSeen: number
  currentTask?: string | null
}

interface PresenceState {
  presences: Record<string, PresenceEntry>  // uid → entry
  myUid: string | null
  subscribe: (uid: string, memberKey: string, name: string) => () => void
  setCurrentTask: (uid: string, taskId: string | null) => void
}

export const usePresenceStore = create<PresenceState>((set) => ({
  presences: {},
  myUid: null,

  subscribe: (uid, memberKey, name) => {
    set({ myUid: uid })
    const presRef = ref(db, `/presence/${uid}`)
    const connRef = ref(db, '.info/connected')

    const unsubConn = onValue(connRef, async (snap) => {
      if (!snap.val()) return
      await onDisconnect(presRef).update({ online: false, lastSeen: Date.now() })
      await fbSet(presRef, { memberKey, name, online: true, lastSeen: Date.now(), currentTask: null })
    })

    const allRef = ref(db, '/presence')
    const unsubAll = onValue(allRef, (snap) => {
      set({ presences: (snap.val() || {}) as Record<string, PresenceEntry> })
    })

    return () => {
      unsubConn()
      unsubAll()
      void fbSet(presRef, { memberKey, name, online: false, lastSeen: Date.now() })
    }
  },

  setCurrentTask: (uid, taskId) => {
    void fbSet(ref(db, `/presence/${uid}/currentTask`), taskId)
    set(s => ({
      presences: {
        ...s.presences,
        [uid]: s.presences[uid] ? { ...s.presences[uid], currentTask: taskId } : s.presences[uid],
      },
    }))
  },
}))
