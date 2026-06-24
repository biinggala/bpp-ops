import { create } from 'zustand'
import { ref, set as fbSet, onValue, off } from 'firebase/database'
import { db } from '../lib/firebase'
import { gid, loadFromStorage, saveToStorage, getLocalTs } from '../lib/utils'
import type { Task, Status } from '../types'

interface TaskState {
  tasks: Task[]
  history: Task[][]
  addTask: (t: Omit<Task, 'id'>) => Task
  updateTask: (id: string, patch: Partial<Task>) => void
  deleteTask: (id: string) => void
  reorderTasks: (tasks: Task[]) => void
  undo: () => void
  syncToFirebase: () => void
  subscribeFirebase: () => () => void
}

function persist(tasks: Task[]) {
  saveToStorage(tasks)
}

const MAX_HISTORY = 50

// Recursively drop keys whose value is `undefined`; Firebase refuses to write
// undefined and throws synchronously if any is present. Arrays are preserved.
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = stripUndefined(v)
    }
    return out as T
  }
  return value
}

function pushHistory(get: () => TaskState) {
  const prev = get().history
  const snapshot = get().tasks
  return prev.length >= MAX_HISTORY
    ? [...prev.slice(1), snapshot]
    : [...prev, snapshot]
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: loadFromStorage<Task[]>() ?? [],
  history: [],

  addTask: (t) => {
    const task: Task = { ...t, id: gid() }
    const tasks = [...get().tasks, task]
    set({ tasks, history: pushHistory(get) }); persist(tasks)
    get().syncToFirebase()
    return task
  },

  updateTask: (id, patch) => {
    const tasks = get().tasks.map(t => t.id === id ? { ...t, ...patch } : t)
    set({ tasks, history: pushHistory(get) }); persist(tasks)
    get().syncToFirebase()
  },

  deleteTask: (id) => {
    const tasks = get().tasks.filter(t => t.id !== id)
    set({ tasks, history: pushHistory(get) }); persist(tasks)
    get().syncToFirebase()
  },

  reorderTasks: (tasks) => {
    set({ tasks, history: pushHistory(get) }); persist(tasks)
    get().syncToFirebase()
  },

  undo: () => {
    const { history } = get()
    if (!history.length) return
    const tasks = history[history.length - 1]
    set({ tasks, history: history.slice(0, -1) })
    persist(tasks)
    get().syncToFirebase()
  },

  syncToFirebase: () => {
    const tasks = get().tasks
    const now = Date.now()
    // Firebase rejects `undefined` anywhere in the payload — and does so by
    // throwing synchronously, which .catch() cannot intercept. Strip undefined
    // fields (e.g. parentId/milestoneId/createdBy on newly added tasks) first.
    const clean = stripUndefined(tasks)
    try {
      fbSet(ref(db, 'cringe/tasks'), clean).catch((e: unknown) => console.warn('[sync]', e))
      fbSet(ref(db, 'cringe/savedAt'), now).catch((e: unknown) => console.warn('[sync savedAt]', e))
    } catch (e) {
      console.warn('[sync threw]', e)
    }
  },

  subscribeFirebase: () => {
    const dbRef = ref(db, 'cringe')
    const handler = onValue(dbRef, (snapshot) => {
      const root = snapshot.val()
      const localTs = getLocalTs()

      if (!root?.tasks) {
        const tasks = get().tasks
        if (tasks.length && localTs > 0) {
          fbSet(ref(db, 'cringe/tasks'), tasks).catch(() => {})
          fbSet(ref(db, 'cringe/savedAt'), Date.now()).catch(() => {})
        }
        return
      }

      const fbTs: number = root.savedAt || 0
      if (fbTs > localTs || localTs === 0) {
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

export function useStatusCounts() {
  const tasks = useTaskStore(s => s.tasks)
  const counts: Partial<Record<Status, number>> = {}
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1
  return counts
}
