import { create } from 'zustand'
import { limitToLast, onValue, query, ref } from 'firebase/database'
import { db } from '../lib/firebase'
import { P } from '../lib/paths'
import { markAllNoticesRead, markNoticeRead, removeNotice, type Notice } from '../lib/notify'

/**
 * The inbox, for the person signed in.
 *
 * Keyed by their **email**, which is the one name a sender always has and the
 * rules can verify against `auth.token.email`. Only ever their own branch, and
 * only the last 100 — an inbox is a place you glance at rather than an archive.
 * Old notices fall off the end; nothing is stored here that is not also in the
 * task itself.
 */
interface NoticeState {
  notices: Notice[]
  unread: number
  /** Starts listening for this email's inbox; returns the unsubscribe. */
  subscribe: (email: string) => () => void
  markRead: (id: string) => void
  markAllRead: () => void
  dismiss: (id: string) => void
}

const LIMIT = 100

export const useNoticeStore = create<NoticeState>((set, get) => {
  let owner: string | null = null   // the email this inbox belongs to

  return {
    notices: [],
    unread: 0,

    subscribe: (email) => {
      owner = email
      const q = query(ref(db, P.notices(email)), limitToLast(LIMIT))
      const unsub = onValue(q, snap => {
        const raw = (snap.val() ?? {}) as Record<string, Omit<Notice, 'id'>>
        const notices = Object.entries(raw)
          .map(([id, n]) => ({ ...n, id }))
          .sort((a, b) => b.at - a.at)
        set({ notices, unread: notices.filter(n => !n.read).length })
      }, () => set({ notices: [], unread: 0 }))

      return () => {
        unsub()
        owner = null
        set({ notices: [], unread: 0 })
      }
    },

    markRead: (id) => {
      if (!owner) return
      // Optimistic: the badge has to answer the click, not the round trip.
      set({
        notices: get().notices.map(n => n.id === id ? { ...n, read: true } : n),
        unread: get().notices.filter(n => !n.read && n.id !== id).length,
      })
      markNoticeRead(owner, id)
    },

    markAllRead: () => {
      if (!owner) return
      const ids = get().notices.filter(n => !n.read).map(n => n.id)
      set({ notices: get().notices.map(n => ({ ...n, read: true })), unread: 0 })
      markAllNoticesRead(owner, ids)
    },

    dismiss: (id) => {
      if (!owner) return
      const rest = get().notices.filter(n => n.id !== id)
      set({ notices: rest, unread: rest.filter(n => !n.read).length })
      removeNotice(owner, id)
    },
  }
})
