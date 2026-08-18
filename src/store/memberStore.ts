import { create } from 'zustand'
import { ref, set as fbSet, onValue, off } from 'firebase/database'
import { db } from '../lib/firebase'
import { gid, loadFromStorage, saveToStorage, parseAssignees } from '../lib/utils'
import { MEMBER_PALETTE, fallbackMember } from '../types'
import { useAuthStore } from './authStore'
import { useTaskStore } from './taskStore'
import type { Member } from '../types'

const MEMBER_KEY = 'cringe_members_v1'

interface MemberState {
  members: Member[]
  addMember: (input: { name: string; email: string; key?: string; color?: string }) => Member
  updateMember: (id: string, patch: Partial<Omit<Member, 'id'>>) => void
  deleteMember: (id: string) => void
  subscribeFirebase: () => () => void
}

function persist(members: Member[]) {
  saveToStorage(members, MEMBER_KEY)
}

function syncFb(members: Member[]) {
  fbSet(ref(db, 'cringe/members'), members).catch(() => {})
}

/** 이메일/이름에서 짧은 키를 만든다. 중복이면 숫자를 붙인다. 등록 화면에서 수정 가능. */
export function suggestMemberKey(name: string, email: string, taken: string[]): string {
  const source = (email.split('@')[0] || name).replace(/[^a-zA-Z0-9]/g, '')
  const base = (source.slice(0, 2) || name.slice(0, 2) || 'M').toUpperCase()
  if (!taken.includes(base)) return base
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}${i}`
    if (!taken.includes(candidate)) return candidate
  }
  return base + gid().slice(0, 3).toUpperCase()
}

export const useMemberStore = create<MemberState>((set, get) => ({
  members: loadFromStorage<Member[]>(MEMBER_KEY) ?? [],

  addMember: ({ name, email, key, color }) => {
    const existing = get().members
    const resolvedKey = (key?.trim() || suggestMemberKey(name, email, existing.map(m => m.key))).toUpperCase()
    const member: Member = {
      id: gid(),
      key: resolvedKey,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      color: color ?? MEMBER_PALETTE[existing.length % MEMBER_PALETTE.length].color,
    }
    const members = [...existing, member]
    set({ members }); persist(members); syncFb(members)
    return member
  },

  updateMember: (id, patch) => {
    const normalized = {
      ...patch,
      ...(patch.key ? { key: patch.key.trim().toUpperCase() } : {}),
      ...(patch.email ? { email: patch.email.trim().toLowerCase() } : {}),
    }
    const members = get().members.map(m => m.id === id ? { ...m, ...normalized } : m)
    set({ members }); persist(members); syncFb(members)
  },

  deleteMember: (id) => {
    const members = get().members.filter(m => m.id !== id)
    set({ members }); persist(members); syncFb(members)
  },

  subscribeFirebase: () => {
    const dbRef = ref(db, 'cringe/members')
    const handler = onValue(dbRef, (snap) => {
      const data = snap.val()
      if (!data) return
      const incoming: Member[] = Array.isArray(data) ? data : Object.values(data)
      set({ members: incoming })
      persist(incoming)
    })
    return () => off(dbRef, 'value', handler)
  },
}))

/** 등록된 멤버 목록 (담당자 선택·필터의 단일 소스) */
export function useMembers(): Member[] {
  return useMemberStore(s => s.members)
}

/**
 * assignee 키를 Member로 해석한다. 디렉터리에 없는 키(과거 데이터)는
 * 키 자체를 이름으로 쓰는 폴백 멤버로 반환하므로 화면이 깨지지 않는다.
 */
export function useResolveMember(): (key: string) => Member {
  const members = useMemberStore(s => s.members)
  return (key: string) => members.find(m => m.key === key) ?? fallbackMember(key)
}

/** 로그인한 사용자를 이메일로 멤버 디렉터리와 연결한다. */
export function useCurrentMember(): Member | null {
  const email = useAuthStore(s => s.email)
  const members = useMemberStore(s => s.members)
  if (!email) return null
  return members.find(m => m.email === email.toLowerCase()) ?? null
}

/** 태스크에는 쓰이지만 디렉터리에 없는 assignee 키 — 멤버 관리 화면에서 등록을 유도한다. */
export function useUnregisteredKeys(): string[] {
  const members = useMemberStore(s => s.members)
  const tasks = useTaskStore(s => s.tasks)
  const known = new Set(members.map(m => m.key))
  const found = new Set<string>()
  tasks.forEach(t => parseAssignees(t.assignee).forEach(k => { if (!known.has(k)) found.add(k) }))
  return Array.from(found).sort()
}
