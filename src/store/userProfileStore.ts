import { create } from 'zustand'
import { ref, set as fbSet, update as fbUpdate } from 'firebase/database'
import { db } from '../lib/firebase'
import { P } from '../lib/paths'
import { useAuthStore } from './authStore'

export interface UserProfile {
  email: string
  name: string
  /** 스스로 정한 별명. 이름과 같이 검색되고, 이름 뒤에 붙어 보입니다. */
  nickname?: string
  photoURL?: string | null
  /**
   * 이름을 **직접 고쳤다**는 표시.
   *
   * 로그인할 때마다 구글 계정의 이름을 여기에 덧씌우고 있었습니다. 그러면
   * 설정에서 고친 이름이 다음 로그인에 사라집니다. 이 표시가 있으면 로그인은
   * 이름을 건드리지 않습니다 — 사진과 주소만 맞춥니다.
   */
  customName?: boolean
}

interface UserProfileState {
  profiles: Record<string, UserProfile>  // keyed by uid
  applyRemote: (uid: string, profile: UserProfile) => void
  setMyProfile: (uid: string, profile: UserProfile) => void
  /** 설정 → 프로필. 이름을 넘기면 그 순간부터 로그인이 이름을 안 덧씌웁니다. */
  updateMyProfile: (uid: string, patch: { name?: string; nickname?: string }) => Promise<void>
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

  updateMyProfile: async (uid, patch) => {
    const have = get().profiles[uid]
    const next: Record<string, unknown> = {}
    if (patch.name !== undefined) {
      const name = patch.name.trim()
      // 빈 이름은 없습니다 — 비우면 원래 자리(주소 앞부분)로 돌아갑니다.
      next.name = name || (have?.email ?? '').split('@')[0] || '?'
      next.customName = !!name
    }
    if (patch.nickname !== undefined) {
      const nick = patch.nickname.trim()
      // 빈 별명은 지웁니다. undefined를 그대로 보내면 데이터베이스가 거절합니다.
      next.nickname = nick || null
    }
    if (Object.keys(next).length === 0) return
    await fbUpdate(ref(db, P.userProfile(uid)), next)
    // 알림·휴지통·사이드바가 읽는 '내 이름'도 같이. 로그인 때만 정하면 다음
    // 로그인까지 옛 이름으로 알림이 나갑니다.
    if (typeof next.name === 'string' && useAuthStore.getState().uid === uid) useAuthStore.setState({ displayName: next.name })
    set(s => {
      const cur = s.profiles[uid] ?? { email: '', name: '' }
      const merged: UserProfile = { ...cur, ...(next as Partial<UserProfile>) }
      if (next.nickname === null) delete merged.nickname
      return { profiles: { ...s.profiles, [uid]: merged } }
    })
  },

  getNameByEmail: (email) => {
    return get().getProfileByEmail(email)?.name ?? email.split('@')[0]
  },

  getProfileByEmail: (email) => {
    const normalized = email.toLowerCase()
    return Object.values(get().profiles).find(p => p.email.toLowerCase() === normalized) ?? null
  },
}))
