import { create } from 'zustand'
import { ref, update as fbUpdate, remove as fbRemove, set as fbSet } from 'firebase/database'
import { db } from '../lib/firebase'
import { gid } from '../lib/utils'
import { P } from '../lib/paths'
import { useAuthStore } from './authStore'
import type { Task, Status } from '../types'

/**
 * Every task is its own record now, at projects/$pid/tasks/$id or
 * personalTasks/$uid/$id. The previous version rewrote the entire task array on
 * each change, so two people saving at once lost one of the two edits outright.
 * Writing a single task touches only that task.
 *
 * Remote data arrives through syncStore, which owns the subscriptions.
 */

/** Firebase throws synchronously on `undefined`, and .catch() cannot see it. */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = stripUndefined(v)
    return out as T
  }
  return value
}

/** A patch clearing a field arrives as undefined; the database spells that null. */
function toUpdatePayload(patch: Partial<Task>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) out[k] = v === undefined ? null : stripUndefined(v)
  return out
}

// Undo used to restore a snapshot of the whole task list. With per-task writes
// that would push one person's view of every task over everyone else's work, so
// each action now records how to reverse just itself.
type UndoOp =
  | { kind: 'add'; task: Task }
  | { kind: 'update'; id: string; before: Partial<Task> }
  | { kind: 'delete'; task: Task }
  | { kind: 'batch'; ops: UndoOp[] }

const MAX_HISTORY = 50

import { noticeAssigneeChange, noticeDueChange, noticeSubtask } from '../lib/notify'

interface TaskState {
  tasks: Task[]
  history: UndoOp[]
  addTask: (t: Omit<Task, 'id'>) => Task
  updateTask: (id: string, patch: Partial<Task>) => void
  deleteTask: (id: string) => void
  reorderTasks: (tasks: Task[]) => void
  undo: () => void
  applyRemote: (tasks: Task[]) => void
}

function myUid(): string | null {
  return useAuthStore.getState().uid
}

function pathFor(task: Pick<Task, 'id' | 'projectId'>): string | null {
  if (task.projectId) return P.projectTask(task.projectId, task.id)
  const uid = myUid()
  return uid ? P.personalTask(uid, task.id) : null
}

function writeTask(task: Task) {
  const path = pathFor(task)
  if (!path) return
  const { projectId: _pid, ...rest } = task
  // The location already says which project this is; storing it again invites
  // the two to disagree after a move.
  fbSet(ref(db, path), stripUndefined(rest)).catch(e => console.warn('[task write]', e))
}

function removeTask(task: Pick<Task, 'id' | 'projectId'>) {
  const path = pathFor(task)
  if (!path) return
  fbRemove(ref(db, path)).catch(e => console.warn('[task remove]', e))
}

export const useTaskStore = create<TaskState>((set, get) => {
  const pushHistory = (op: UndoOp) => {
    const history = [...get().history, op]
    return history.length > MAX_HISTORY ? history.slice(history.length - MAX_HISTORY) : history
  }

  const applyOp = (op: UndoOp) => {
    switch (op.kind) {
      case 'add':
        set({ tasks: get().tasks.filter(t => t.id !== op.task.id) })
        removeTask(op.task)
        break
      case 'delete':
        set({ tasks: [...get().tasks, op.task] })
        writeTask(op.task)
        break
      case 'update': {
        const current = get().tasks.find(t => t.id === op.id)
        if (!current) break
        const restored = { ...current, ...op.before }
        set({ tasks: get().tasks.map(t => t.id === op.id ? restored : t) })
        if (op.before.projectId !== undefined && op.before.projectId !== current.projectId) {
          removeTask(current)
          writeTask(restored)
        } else {
          const path = pathFor(restored)
          if (path) fbUpdate(ref(db, path), toUpdatePayload(op.before)).catch(e => console.warn('[task undo]', e))
        }
        break
      }
      case 'batch':
        for (const inner of [...op.ops].reverse()) applyOp(inner)
        break
    }
  }

  return {
    tasks: [],
    history: [],

    addTask: (input) => {
      const task: Task = { ...input, id: gid() } as Task
      const parent = task.parentId ? get().tasks.find(t => t.id === task.parentId) : undefined
      set({ tasks: [...get().tasks, task], history: pushHistory({ kind: 'add', task }) })
      writeTask(task)
      // Whoever is holding the parent gets told their work grew a piece.
      if (parent) noticeSubtask(parent, task)
      // A task created already assigned to somebody else is an assignment.
      if (task.assignee) noticeAssigneeChange(task, '', task.assignee)
      return task
    },

    updateTask: (id, patch) => {
      const current = get().tasks.find(t => t.id === id)
      if (!current) return

      const before: Partial<Task> = {}
      for (const key of Object.keys(patch) as (keyof Task)[]) {
        before[key] = current[key] as never
      }

      const next = { ...current, ...patch }
      set({ tasks: get().tasks.map(t => t.id === id ? next : t), history: pushHistory({ kind: 'update', id, before }) })

      // Two changes are worth telling somebody about, because they are the two
      // nobody would otherwise notice: work arriving on their plate, and the
      // date moving under work they are already holding. See lib/notify.
      if ('assignee' in patch && patch.assignee !== current.assignee) {
        noticeAssigneeChange(next, current.assignee ?? '', patch.assignee ?? '')
      }
      if ('due' in patch && patch.due !== current.due) {
        noticeDueChange(next, current.due ?? '', patch.due ?? '')
      }

      // Moving between projects changes where the record lives, so the old copy
      // has to go rather than being patched in place.
      if ('projectId' in patch && patch.projectId !== current.projectId) {
        removeTask(current)
        writeTask(next)
        return
      }
      const path = pathFor(next)
      if (path) fbUpdate(ref(db, path), toUpdatePayload(patch)).catch(e => console.warn('[task update]', e))
    },

    deleteTask: (id) => {
      const task = get().tasks.find(t => t.id === id)
      if (!task) return
      set({ tasks: get().tasks.filter(t => t.id !== id), history: pushHistory({ kind: 'delete', task }) })
      removeTask(task)
    },

    reorderTasks: (tasks) => {
      // Only the rows whose order actually moved are written, so a drag does not
      // rewrite the list and clobber edits made elsewhere in it.
      const previous = new Map(get().tasks.map(t => [t.id, t]))
      const ops: UndoOp[] = []
      set({ tasks })
      for (const task of tasks) {
        const old = previous.get(task.id)
        if (!old || old.order === task.order) continue
        ops.push({ kind: 'update', id: task.id, before: { order: old.order } })
        const path = pathFor(task)
        if (path) fbUpdate(ref(db, path), { order: task.order ?? null }).catch(e => console.warn('[task reorder]', e))
      }
      if (ops.length) set({ history: pushHistory({ kind: 'batch', ops }) })
    },

    undo: () => {
      const history = get().history
      if (!history.length) return
      const op = history[history.length - 1]
      set({ history: history.slice(0, -1) })
      applyOp(op)
    },

    applyRemote: (tasks) => set({ tasks }),
  }
})

export function useStatusCounts() {
  const tasks = useTaskStore(s => s.tasks)
  const counts: Partial<Record<Status, number>> = {}
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1
  return counts
}
