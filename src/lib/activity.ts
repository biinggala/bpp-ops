import { push, ref, set as fbSet } from 'firebase/database'
import { db } from './firebase'
import { P } from './paths'
import { useAuthStore } from '../store/authStore'
import { useUserProfileStore } from '../store/userProfileStore'
import { parseAssignees, assigneeKeyToEmail } from './utils'
import type { Task } from '../types'

/**
 * ── 활동 기록 ────────────────────────────────────────────────────────────────
 *
 * Who changed what, and when. The panel that shows this existed already and
 * always said the same sentence — "태스크가 생성됐습니다" — because nothing was
 * ever written down. This is the writing down.
 *
 * It lives at `projects/{pid}/activity/{taskId}`, which needs no new rule and
 * no new idea of who may see it: the project node is already readable and
 * writable by exactly its members, and children inherit that. A task's history
 * is visible to the same people the task is.
 *
 * **Personal tasks keep no log.** Nobody but their owner can edit them, so a
 * record of who did it would only ever name one person.
 *
 * One entry per edit, not per field. Changing a status and a due date in the
 * same motion is one thing that happened, and splitting it into two lines makes
 * a busy afternoon unreadable.
 */

export interface ActivityChange {
  /** Already worded for the screen: '상태', '마감일'. */
  label: string
  /** '진행중 → 검토중', '+최희건', '수정'. */
  detail: string
}

export interface Activity {
  id: string
  kind: 'created' | 'changed' | 'deleted'
  /** The display name, resolved when written so it survives. */
  by: string
  at: number
  changes?: ActivityChange[]
}

/** The fields worth a line, in the order a row is read. */
const LABEL: Partial<Record<keyof Task, string>> = {
  name: '이름',
  status: '상태',
  assignee: '담당자',
  due: '마감일',
  start: '시작일',
  priority: '우선순위',
  progress: '진행률',
  projectId: '프로젝트',
  milestoneId: '마일스톤',
  tags: '태그',
  memo: '메모',
  links: '자료',
  parentId: '상위 업무',
}

function myName(): string {
  const { email, displayName } = useAuthStore.getState()
  return displayName || email?.split('@')[0] || '누군가'
}

function nameOf(assignee: string): string {
  const email = assigneeKeyToEmail(assignee)
  return useUserProfileStore.getState().getNameByEmail(email)
}

/** '없음' rather than an empty gap — a date that was cleared is a fact. */
function shown(value: unknown): string {
  if (value === undefined || value === null || value === '') return '없음'
  return String(value)
}

/**
 * How one field's change reads.
 *
 * Assignees are named rather than listed as before-and-after: two comma-joined
 * strings of emails is not something anybody reads, and what actually happened
 * is that somebody joined or left.
 */
function describe(field: keyof Task, before: unknown, after: unknown): ActivityChange | null {
  const label = LABEL[field]
  if (!label) return null

  if (field === 'assignee') {
    const was = new Set(parseAssignees(String(before ?? '')))
    const now = new Set(parseAssignees(String(after ?? '')))
    const added = [...now].filter(p => !was.has(p)).map(nameOf)
    const removed = [...was].filter(p => !now.has(p)).map(nameOf)
    const parts = [
      added.length ? `+${added.join(', ')}` : '',
      removed.length ? `−${removed.join(', ')}` : '',
    ].filter(Boolean)
    return parts.length ? { label, detail: parts.join(' ') } : null
  }

  // A memo is a document; quoting its before and after in a log line is noise.
  if (field === 'memo') return { label, detail: '수정' }

  if (field === 'links') {
    const wasCount = Array.isArray(before) ? before.length : 0
    const nowCount = Array.isArray(after) ? after.length : 0
    if (nowCount === wasCount) return { label, detail: '수정' }
    return { label, detail: nowCount > wasCount ? `${nowCount - wasCount}개 추가` : `${wasCount - nowCount}개 삭제` }
  }

  if (field === 'tags') {
    const was = new Set(Array.isArray(before) ? before as string[] : [])
    const now = new Set(Array.isArray(after) ? after as string[] : [])
    const added = [...now].filter(t => !was.has(t))
    const removed = [...was].filter(t => !now.has(t))
    const parts = [
      added.length ? `+${added.join(', ')}` : '',
      removed.length ? `−${removed.join(', ')}` : '',
    ].filter(Boolean)
    return parts.length ? { label, detail: parts.join(' ') } : null
  }

  if (field === 'progress') return { label, detail: `${shown(before)}% → ${shown(after)}%` }

  return { label, detail: `${shown(before)} → ${shown(after)}` }
}

function write(task: Task, entry: Omit<Activity, 'id' | 'by' | 'at'>) {
  if (!task.projectId) return
  const me = useAuthStore.getState().uid
  if (!me) return
  const node = push(ref(db, P.activity(task.projectId, task.id)))
  fbSet(node, { ...entry, by: myName(), at: Date.now() })
    .catch(e => console.warn('[activity]', e))
}

export function logCreated(task: Task) {
  write(task, { kind: 'created' })
}

export function logDeleted(task: Task) {
  write(task, { kind: 'deleted' })
}

/** One entry for the whole patch, or nothing when nothing actually moved. */
export function logChanged(task: Task, patch: Partial<Task>, before: Partial<Task>) {
  const changes: ActivityChange[] = []
  for (const key of Object.keys(patch) as (keyof Task)[]) {
    if (JSON.stringify(patch[key]) === JSON.stringify(before[key])) continue
    const change = describe(key, before[key], patch[key])
    if (change) changes.push(change)
  }
  if (!changes.length) return
  write(task, { kind: 'changed', changes })
}
