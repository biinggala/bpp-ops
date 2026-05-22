import { create } from 'zustand'
import { ref, set as fbSet, onValue, off } from 'firebase/database'
import { db } from '../lib/firebase'
import { gid, loadFromStorage, saveToStorage, getLocalTs } from '../lib/utils'
import type { Task, Status } from '../types'

interface TaskState {
  tasks: Task[]
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
  tasks: loadFromStorage<Task[]>() ?? [],

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
        const tasks = get().tasks
        if (tasks.length && localTs > 0) {
          fbSet(ref(db, 'cringe'), { tasks, savedAt: Date.now() })
        }
        return
      }

      const fbTs: number = root.savedAt || 0
      if (fbTs > localTs) {
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
