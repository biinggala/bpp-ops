import { create } from 'zustand'
import { ref, update as fbUpdate, remove as fbRemove, set as fbSet } from 'firebase/database'
import { db } from '../lib/firebase'
import { gid, parseAssignees, assigneeKeyToEmail } from '../lib/utils'
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

import { noticeAssigneeChange, noticeDueChange, noticeStatusChange, noticeSubtask } from '../lib/notify'
import { logChanged, logCreated, logDeleted } from '../lib/activity'

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

/**
 * ── 프로젝트 없는 업무의 담당자는 나 하나 ────────────────────────────────────
 *
 * 위의 pathFor가 그 이유 전부입니다. 프로젝트가 없으면 그 업무는
 * `personalTasks/$uid`에 살고, DB 규칙이 **본인만** 읽게 합니다. 남을 담당자로
 * 적어 두면 그 사람은 그 업무를 영원히 못 봅니다 — '내 할 일'에도 안 뜨고,
 * 열 수도 없고, 상태를 바꿀 수도 없습니다. 알림만 도착합니다(알림은 이메일로
 * 배달돼서 프로젝트 권한과 무관합니다). 눌러도 아무것도 없는 알림이요.
 *
 * 화면에서도 막지만(lib/utils의 assigneeOptions) 값을 쓰는 곳은 여기라,
 * 판정도 여기 둡니다. 목록에서 끌어다 놓든 업무를 개인으로 옮기든 같은 규칙을
 * 지나갑니다.
 *
 * 프로젝트가 있으면 손대지 않습니다. 그쪽 경계는 프로젝트 멤버십이고, 그건
 * 규칙이 이미 지키고 있습니다.
 */
function readableAssignee(projectId: string | null | undefined, assignee: string | undefined): string {
  if (projectId) return assignee ?? ''
  const me = useAuthStore.getState().email?.toLowerCase()
  if (!me || !assignee) return ''
  return parseAssignees(assignee).filter(a => assigneeKeyToEmail(a) === me).join(',')
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
      const task: Task = {
        ...input,
        assignee: readableAssignee(input.projectId, input.assignee),
        id: gid(),
      } as Task
      const parent = task.parentId ? get().tasks.find(t => t.id === task.parentId) : undefined
      set({ tasks: [...get().tasks, task], history: pushHistory({ kind: 'add', task }) })
      writeTask(task)
      // Whoever is holding the parent gets told their work grew a piece.
      if (parent) noticeSubtask(parent, task)
      // A task created already assigned to somebody else is an assignment.
      if (task.assignee) noticeAssigneeChange(task, '', task.assignee)
      logCreated(task)
      return task
    },

    updateTask: (id, rawPatch) => {
      const current = get().tasks.find(t => t.id === id)
      if (!current) return

      /**
       * 담당자가 그 업무를 읽을 수 있는지 먼저 봅니다. 담당자를 고칠 때만이
       * 아니라 **프로젝트를 옮길 때도** 봐야 합니다 — 프로젝트 업무를 개인으로
       * 내리면 그 자리에 남의 이름이 남고, 그때부터 그 사람은 자기 앞으로 온
       * 업무를 볼 수 없습니다. 걸러진 값은 패치에 실어 보냅니다: 기록에도
       * 남고, 알림도 '담당에서 제외'로 정확히 나갑니다.
       */
      const patch = { ...rawPatch }
      const nextProject = 'projectId' in patch ? patch.projectId : current.projectId
      const nextAssignee = 'assignee' in patch ? patch.assignee : current.assignee
      const kept = readableAssignee(nextProject, nextAssignee)
      if (kept !== (nextAssignee ?? '')) patch.assignee = kept

      const before: Partial<Task> = {}
      for (const key of Object.keys(patch) as (keyof Task)[]) {
        before[key] = current[key] as never
      }

      const next = { ...current, ...patch }
      set({ tasks: get().tasks.map(t => t.id === id ? next : t), history: pushHistory({ kind: 'update', id, before }) })

      // Three changes are worth telling somebody about, because they are the
      // ones nobody would otherwise notice: work arriving on their plate, the
      // date moving under work they are already holding, and somebody else
      // moving the state of it. See lib/notify.
      if ('assignee' in patch && patch.assignee !== current.assignee) {
        noticeAssigneeChange(next, current.assignee ?? '', patch.assignee ?? '')
      }
      if ('due' in patch && patch.due !== current.due) {
        noticeDueChange(next, current.due ?? '', patch.due ?? '')
      }
      if ('status' in patch && patch.status && patch.status !== current.status) {
        noticeStatusChange(next, current.status, patch.status)
      }

      // Notices go to the few people who need telling; the log keeps the rest,
      // for whoever opens the task later and asks who moved this.
      logChanged(next, patch, before)

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
      // The task is gone; the record of it going is not. It sits beside the
      // project rather than inside the task, so removing one does not remove
      // the other.
      logDeleted(task)
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

    /**
     * 줄 하나가 안 바뀌었으면 set도 안 합니다.
     *
     * syncStore가 안 바뀐 것들의 객체 정체를 그대로 물려주므로, 여기서 한 줄씩
     * 대 보면 '사실은 아무것도 안 바뀐 알림'을 걸러낼 수 있습니다. 그런 알림이
     * set까지 가면 배열 정체가 바뀌고, 그 배열에 기대는 화면 전부가 다시
     * 계산합니다 — 결과가 같은 계산을요.
     */
    applyRemote: (next) => set(state => {
      const now = state.tasks
      if (now.length === next.length && now.every((item, i) => item === next[i])) return state
      return { tasks: next }
    }),
  }
})

export function useStatusCounts() {
  const tasks = useTaskStore(s => s.tasks)
  const counts: Partial<Record<Status, number>> = {}
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1
  return counts
}
