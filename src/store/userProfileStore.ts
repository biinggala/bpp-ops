import { create } from 'zustand'
import { ref, set as fbSet } from 'firebase/database'
import { db } from '../lib/firebase'
import { P } from '../lib/paths'

export interface UserProfile {
  email: string
  name: string
  photoURL?: string | null
}

interface UserProfileState {
  profiles: Record<string, UserProfile>  // keyed by uid
  applyRemote: (uid: string, profile: UserProfile) => void
  setMyProfile: (uid: string, profile: UserProfile) => void
  getNameByEmail: (email: string) => string
  getProfileByEmail: (email: string) => UserProfile | null
}

export const useUserProfileStore = create<UserProfileState>((set, get) => ({
  profiles: {},

  // Profiles arrive one uid at a time from syncStore. The whole userProfiles
  // node is closed, so there is no directory to read in one go.
  applyRemote: (uid, profile) => {
    set(s => ({ profiles: { ...s.profiles, [uid]: profile } }))
  },

  setMyProfile: (uid, profile) => {
    fbSet(ref(db, P.userProfile(uid)), profile).catch(() => {})
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
