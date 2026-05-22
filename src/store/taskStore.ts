import { create } from 'zustand'
import { ref, set as fbSet, onValue, off } from 'firebase/database'
import { db } from '../lib/firebase'
import { gid, loadFromStorage, saveToStorage, getLocalTs } from '../lib/utils'
import type { Task, Category, Status } from '../types'

const SAMPLE_TASKS: Omit<Task, 'id'>[] = [
  { type:'상위', name:'정부지원사업 지원',          cat:'Strategy',     assignee:'YL', start:'2026-03-01', due:'2026-05-31', priority:'높음', status:'진행중', progress:56, memo:'' },
  { type:'세부', name:'예비창업패키지 신청서 작성',  cat:'Strategy',     assignee:'YL', start:'',          due:'2026-03-24', priority:'높음', status:'진행중', progress:0,  memo:'' },
  { type:'세부', name:'창업중심대학 지역 특화',      cat:'Strategy',     assignee:'YL', start:'',          due:'2026-03-23', priority:'높음', status:'진행중', progress:0,  memo:'' },
  { type:'세부', name:'판판대로 지원 신청서 작성',   cat:'Strategy',     assignee:'YL', start:'',          due:'',           priority:'높음', status:'대기',   progress:0,  memo:'' },
  { type:'상위', name:'행정 업무',                   cat:'Internal Ops', assignee:'YL', start:'2026-03-01', due:'2026-03-30', priority:'높음', status:'진행중', progress:33, memo:'' },
  { type:'세부', name:'재무 트래킹 시트 업데이트',   cat:'Internal Ops', assignee:'YL', start:'',          due:'2026-03-30', priority:'중간', status:'완료',   progress:100, memo:'' },
  { type:'상위', name:'PlasticProduct 브랜드 필름 기획', cat:'Production', assignee:'SJ', start:'2026-03-01', due:'2026-03-03', priority:'높음', status:'진행중', progress:0, memo:'' },
  { type:'세부', name:'필름 1편 기획',               cat:'Production',   assignee:'SJ', start:'',          due:'',           priority:'높음', status:'대기',   progress:0,  memo:'플라스틱 프로덕트 답변 대기 중' },
  { type:'상위', name:'크린지 프렌즈 소개 영상 기획', cat:'Production',  assignee:'HC', start:'2026-03-01', due:'2026-03-12', priority:'높음', status:'진행중', progress:14, memo:'' },
  { type:'세부', name:'희건 촬영 대본 작성',          cat:'Production',  assignee:'HC', start:'',          due:'',           priority:'높음', status:'검토중', progress:0,  memo:'' },
  { type:'세부', name:'세운 촬영 대본 작성',          cat:'Production',  assignee:'HC', start:'',          due:'',           priority:'높음', status:'진행중', progress:0,  memo:'' },
  { type:'상위', name:'트레바리 운영',                cat:'Community',   assignee:'YL', start:'',          due:'',           priority:'중간', status:'진행중', progress:67, memo:'' },
  { type:'세부', name:'번개모임 rsvp 폼 만들기',      cat:'Community',   assignee:'YL', start:'',          due:'',           priority:'중간', status:'완료',   progress:100, memo:'' },
  { type:'세부', name:'번개모임 기획',                cat:'Community',   assignee:'YL', start:'',          due:'',           priority:'중간', status:'대기',   progress:0,  memo:'' },
  { type:'상위', name:'브랜딩 재정립',                cat:'Branding',    assignee:'SJ', start:'',          due:'',           priority:'중간', status:'대기',   progress:50, memo:'' },
]

interface TaskState {
  tasks: Task[]
  setTasks: (tasks: Task[]) => void
  addTask: (t: Omit<Task, 'id'>) => void
  updateTask: (id: string, patch: Partial<Task>) => void
  deleteTask: (id: string) => void
  reorderTasks: (tasks: Task[]) => void
  syncToFirebase: () => void
  subscribeFirebase: () => () => void
}

function persist(tasks: Task[]) {
  saveToStorage(tasks)
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: (() => {
    const saved = loadFromStorage<Task[]>()
    if (saved && saved.length > 0) return saved
    return SAMPLE_TASKS.map(t => ({ ...t, id: gid() }))
  })(),

  setTasks: (tasks) => { set({ tasks }); persist(tasks) },

  addTask: (t) => {
    const task: Task = { ...t, id: gid() }
    const tasks = [...get().tasks, task]
    set({ tasks }); persist(tasks)
    get().syncToFirebase()
  },

  updateTask: (id, patch) => {
    const tasks = get().tasks.map(t => t.id === id ? { ...t, ...patch } : t)
    set({ tasks }); persist(tasks)
    get().syncToFirebase()
  },

  deleteTask: (id) => {
    const tasks = get().tasks.filter(t => t.id !== id)
    set({ tasks }); persist(tasks)
    get().syncToFirebase()
  },

  reorderTasks: (tasks) => {
    set({ tasks }); persist(tasks)
    get().syncToFirebase()
  },

  syncToFirebase: () => {
    const tasks = get().tasks
    fbSet(ref(db, 'cringe/tasks'), tasks).catch((e: unknown) => console.warn('[sync]', e))
  },

  subscribeFirebase: () => {
    const dbRef = ref(db, 'cringe')
    const handler = onValue(dbRef, (snapshot) => {
      const root = snapshot.val()
      const localTs = getLocalTs()

      if (!root?.tasks) {
        // Firebase 비어있음 → 로컬 업로드
        const tasks = get().tasks
        if (tasks.length && localTs > 0) {
          fbSet(ref(db, 'cringe'), { tasks, savedAt: Date.now() })
        }
        return
      }

      const fbTs: number = root.savedAt || 0
      if (fbTs > localTs) {
        // Firebase가 더 최신
        const incoming: Task[] = Array.isArray(root.tasks)
          ? root.tasks
          : Object.values(root.tasks)
        set({ tasks: incoming })
        saveToStorage(incoming)
      }
    })

    return () => off(dbRef, 'value', handler)
  },
}))

// 카테고리별 task 수
export function useCategoryCounts() {
  const tasks = useTaskStore(s => s.tasks)
  const counts: Partial<Record<Category | 'all', number>> = { all: tasks.length }
  for (const t of tasks) {
    const key = t.cat.replace(' ', '') as Category
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

// 상태별 task 수
export function useStatusCounts() {
  const tasks = useTaskStore(s => s.tasks)
  const counts: Partial<Record<Status, number>> = {}
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1
  return counts
}
