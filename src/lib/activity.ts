import { push, ref, set as fbSet, update as fbUpdate } from 'firebase/database'
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

/**
 * ── 같은 말을 두 번 적지 않습니다 ───────────────────────────────────────────
 *
 * 메모는 700ms마다 저장됩니다. 한 문단을 쓰는 동안 열 번쯤 저장되고, 그때마다
 * '메모 수정'이 한 줄씩 쌓였습니다. 오후에 메모를 손본 업무를 열면 활동 창이
 * 똑같은 문장으로 가득 찹니다 — 기록이 많은 게 아니라 **읽을 수 없는 것**이
 * 됩니다.
 *
 * 그래서 방금 쓴 것과 **글자 하나까지 같은** 기록이 잠깐 사이에 또 오면, 새
 * 줄을 만들지 않고 그 줄의 시각만 갱신합니다.
 *
 * **똑같을 때만** 뭉칩니다. '대기 → 진행중' 다음에 '진행중 → 검토중'이 오면
 * 두 줄로 남습니다 — 뭉치면 중간에 무슨 일이 있었는지가 사라지니까요.
 * 잃는 정보가 하나도 없을 때만 합칩니다.
 *
 * 기억은 이 브라우저 안에만 있습니다. 새로고침하면 다시 한 줄이 생기고,
 * 남이 고친 것과 섞이지도 않습니다.
 */
const MERGE_WINDOW = 10 * 60_000
const lastWrite = new Map<string, { key: string; sig: string; at: number }>()

function write(task: Task, entry: Omit<Activity, 'id' | 'by' | 'at'>) {
  if (!task.projectId) return
  const me = useAuthStore.getState().uid
  if (!me) return

  const at = Date.now()
  const path = P.activity(task.projectId, task.id)
  const slot = `${task.projectId}/${task.id}`

  if (entry.kind === 'changed') {
    const sig = JSON.stringify(entry.changes ?? [])
    const prev = lastWrite.get(slot)
    if (prev && prev.sig === sig && at - prev.at < MERGE_WINDOW) {
      prev.at = at
      fbUpdate(ref(db, `${path}/${prev.key}`), { at })
        .catch(e => console.warn('[activity]', e))
      return
    }
    const node = push(ref(db, path))
    if (node.key) lastWrite.set(slot, { key: node.key, sig, at })
    fbSet(node, { ...entry, by: myName(), at }).catch(e => console.warn('[activity]', e))
    return
  }

  // 만들기·지우기는 한 번뿐이라 뭉칠 일이 없습니다. 다음 변경이 그것과
  // 합쳐지지 않도록 기억만 지웁니다.
  lastWrite.delete(slot)
  fbSet(push(ref(db, path)), { ...entry, by: myName(), at })
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
