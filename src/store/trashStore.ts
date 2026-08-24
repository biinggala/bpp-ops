// 휴지통 — 지운 업무가 머무는 곳, 그리고 되살리는 길.
//
// **그 화면을 열 때만 읽습니다.** 프로젝트 노드 안에 두지 않은 이유가 그것
// 입니다(lib/paths의 trash 참고): 거기 있는 것은 앱을 켜는 모두가 늘
// 내려받습니다. 지운 업무는 아무도 매일 보지 않습니다.

import { create } from 'zustand'
import { get as fbGet, ref, remove as fbRemove } from 'firebase/database'
import { db } from '../lib/firebase'
import { P } from '../lib/paths'
import { useAuthStore } from './authStore'
import { useTaskStore } from './taskStore'
import type { Task } from '../types'

export interface TrashItem {
  /** 저장된 자리 — 되살리거나 영영 지울 때 쓰는 주소. */
  path: string
  task: Task
  at: number
  by?: string
  /** 어느 프로젝트의 휴지통인가. 개인 업무면 없습니다. */
  projectId?: string
}

interface TrashState {
  items: TrashItem[]
  loading: boolean
  error: string | null
  /** 읽어 옵니다. 화면이 열릴 때 한 번. */
  load: (projectIds: string[]) => Promise<void>
  /** 되살립니다. 성공하면 목록에서 빠집니다. */
  restore: (item: TrashItem) => Promise<boolean>
  /** 영영 지웁니다. 이건 안 돌아옵니다. */
  purge: (item: TrashItem) => Promise<void>
  clear: () => void
}

interface Stored { task: Omit<Task, 'id'>; at: number; by?: string }

function read(node: Record<string, Stored> | null, base: string, projectId?: string): TrashItem[] {
  return Object.entries(node ?? {})
    .filter(([, v]) => v?.task)
    .map(([id, v]) => ({
      path: `${base}/${id}`,
      task: { ...v.task, id, ...(projectId ? { projectId } : {}) } as Task,
      at: v.at ?? 0,
      by: v.by,
      projectId,
    }))
}

export const useTrashStore = create<TrashState>((set, get) => ({
  items: [],
  loading: false,
  error: null,

  load: async (projectIds) => {
    const uid = useAuthStore.getState().uid
    set({ loading: true, error: null })
    const found: TrashItem[] = []
    try {
      // 프로젝트마다 한 번씩. 못 읽는 프로젝트가 있어도 나머지는 옵니다 —
      // 하나가 거절당했다고 휴지통 전체가 빈 것처럼 보이면 안 됩니다.
      await Promise.all([
        ...projectIds.map(async pid => {
          const snap = await fbGet(ref(db, P.trash(pid))).catch(() => null)
          if (snap) found.push(...read(snap.val(), P.trash(pid), pid))
        }),
        (async () => {
          if (!uid) return
          const snap = await fbGet(ref(db, P.personalTrash(uid))).catch(() => null)
          if (snap) found.push(...read(snap.val(), P.personalTrash(uid)))
        })(),
      ])
      set({ items: found.sort((a, b) => b.at - a.at), loading: false })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : '휴지통을 읽지 못했습니다' })
    }
  },

  /**
   * 되살리기.
   *
   * **상위 업무가 사라졌으면 상위를 지웁니다.** 그대로 두면 어느 목록에도
   * 안 나타나는 업무가 됩니다 — 있지도 않은 부모 밑에 접혀 있는 셈이라,
   * 되살렸는데 안 보이는 것보다 나쁜 결과는 없습니다. 최상위로 올라옵니다.
   */
  restore: async (item) => {
    const tasks = useTaskStore.getState().tasks
    const orphaned = item.task.parentId && !tasks.some(t => t.id === item.task.parentId)
    const task: Task = orphaned ? { ...item.task, parentId: undefined } : item.task
    try {
      useTaskStore.getState().restoreTask(task)
      await fbRemove(ref(db, item.path))
      set({ items: get().items.filter(i => i.path !== item.path) })
      return true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '되살리지 못했습니다' })
      return false
    }
  },

  purge: async (item) => {
    await fbRemove(ref(db, item.path)).catch(() => {})
    set({ items: get().items.filter(i => i.path !== item.path) })
  },

  clear: () => set({ items: [], loading: false, error: null }),
}))
