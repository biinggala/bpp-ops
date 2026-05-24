import { create } from 'zustand'
import { ref, set as fbSet, onValue, off } from 'firebase/database'
import { db } from '../lib/firebase'

export interface UserProfile {
  email: string
  name: string
  photoURL?: string | null
}

interface UserProfileState {
  profiles: Record<string, UserProfile>  // keyed by uid
  subscribe: () => () => void
  setMyProfile: (uid: string, profile: UserProfile) => void
  getNameByEmail: (email: string) => string
  getProfileByEmail: (email: string) => UserProfile | null
}

export const useUserProfileStore = create<UserProfileState>((set, get) => ({
  profiles: {},

  subscribe: () => {
    const dbRef = ref(db, 'cringe/userProfiles')
    const handler = onValue(dbRef, (snap) => {
      const data = snap.val()
      if (data && typeof data === 'object') set({ profiles: data })
    })
    return () => off(dbRef, 'value', handler)
  },

  setMyProfile: (uid, profile) => {
    fbSet(ref(db, `cringe/userProfiles/${uid}`), profile).catch(() => {})
    set(s => ({ profiles: { ...s.profiles, [uid]: profile } }))
  },

  getNameByEmail: (email) => {
    return get().getProfileByEmail(email)?.name ?? email.split('@')[0]
  },

  getProfileByEmail: (email) => {
    const normalized = email.toLowerCase()
    return Object.values(get().profiles).find(p => p.email.toLowerCase() === normalized) ?? null
  },
}))
