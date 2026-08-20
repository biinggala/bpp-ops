import { push, ref, set as fbSet, update as fbUpdate, remove } from 'firebase/database'
import { db } from './firebase'
import { P } from './paths'
import { useAuthStore } from '../store/authStore'
import { useUserProfileStore } from '../store/userProfileStore'
import { assigneeKeyToEmail, parseAssignees } from './utils'
import { pushNotice } from './push'
import type { Task } from '../types'

/**
 * ── 알림 ─────────────────────────────────────────────────────────────────────
 *
 * A notice is left for one person, by another person, about one thing. It is
 * written straight to that person's own branch of the database — no server in
 * the middle — which is why the inbox works the moment this ships and does not
 * wait on push infrastructure.
 *
 * What gets a notice is decided by one question: **would this person not
 * otherwise find out?** Assigning work to somebody is the clearest case; they
 * have no reason to be looking at that project today. Moving the deadline on
 * work somebody else is holding is the same. Everything else — a status changed,
 * a tag added, fifty people editing all day — belongs on the screen they are
 * already looking at, not in a notification. Fifty people generate enough events
 * to make an inbox worthless within a week if this rule is relaxed.
 *
 * And never for one's own doing: the person who just typed the change is the one
 * person who does not need to be told about it.
 */

export type NoticeKind =
  | 'assigned'      // 이 업무 담당자가 되셨습니다
  | 'unassigned'    // 담당에서 빠졌습니다
  | 'due_changed'   // 내가 담당인 업무의 마감일이 바뀜
  | 'subtask'       // 내 업무 아래 하위 업무가 생김
  | 'due_soon'      // 아침 브리핑이 남기는 것 (서버가 씀)
  | 'overdue'

export interface Notice {
  id: string
  kind: NoticeKind
  /** Who did it, as a display name — resolved when written, so it survives. */
  by: string
  /** The thing it is about. */
  taskId?: string
  taskName?: string
  projectId?: string
  /** Extra detail, already worded: "8/22 → 8/25". */
  detail?: string
  at: number
  read?: boolean
}

/** Everything the app needs to address a notice at somebody. */
type Target = { uid: string }

/**
 * The uid behind an assignee token, or null.
 *
 * Assignees are stored as emails (and, from before, as legacy member keys),
 * while notices are addressed by uid — the only key the security rules can
 * check. Profiles for everyone sharing a project are already loaded, so this is
 * a lookup rather than a fetch; somebody outside every shared project cannot be
 * resolved, and gets no notice rather than a broken one.
 */
function targetFor(assignee: string): Target | null {
  const email = assigneeKeyToEmail(assignee)
  if (!email) return null
  const profiles = useUserProfileStore.getState().profiles
  for (const [uid, profile] of Object.entries(profiles)) {
    if (profile.email?.toLowerCase() === email.toLowerCase()) return { uid }
  }
  return null
}

function myName(): string {
  const { email, displayName } = useAuthStore.getState()
  return displayName || email?.split('@')[0] || '누군가'
}

/** How each kind reads as a notification title. The body is the task's name. */
const HEADLINE: Record<NoticeKind, string> = {
  assigned:    '새 업무를 맡았습니다',
  unassigned:  '담당에서 제외됐습니다',
  due_changed: '마감일이 바뀌었습니다',
  subtask:     '하위 업무가 추가됐습니다',
  due_soon:    '마감이 다가옵니다',
  overdue:     '마감이 지났습니다',
}

/**
 * Writes one notice, then asks the server to buzz the phone about it.
 *
 * Both are fire-and-forget: a failed notice must not fail the edit that caused
 * it, and a failed push costs a buzz rather than the information — the inbox
 * already has it by then.
 */
function leave(target: Target, notice: Omit<Notice, 'id' | 'at' | 'by'>) {
  const me = useAuthStore.getState().uid
  if (!me || target.uid === me) return
  const node = push(ref(db, P.notices(target.uid)))
  const payload: Record<string, unknown> = { ...notice, by: myName(), at: Date.now() }
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key]
  }
  fbSet(node, payload).catch(e => console.warn('[notice]', e))

  const detail = notice.detail ? ` · ${notice.detail}` : ''
  void pushNotice(
    target.uid,
    HEADLINE[notice.kind],
    `${notice.taskName ?? ''}${detail}`.trim() || myName(),
    notice.taskId ? `/?task=${notice.taskId}` : '/',
  )
}

/** 담당자가 바뀌었을 때 — 새로 들어온 사람과 빠진 사람에게. */
export function noticeAssigneeChange(task: Task, before: string, after: string) {
  const was = new Set(parseAssignees(before))
  const now = new Set(parseAssignees(after))
  const common = { taskId: task.id, taskName: task.name, projectId: task.projectId }

  for (const person of now) {
    if (was.has(person)) continue
    const target = targetFor(person)
    if (target) leave(target, { kind: 'assigned', ...common })
  }
  for (const person of was) {
    if (now.has(person)) continue
    const target = targetFor(person)
    if (target) leave(target, { kind: 'unassigned', ...common })
  }
}

/** 마감일이 바뀌었을 때 — 그 일을 들고 있는 사람들에게. */
export function noticeDueChange(task: Task, before: string, after: string) {
  const detail = `${before || '없음'} → ${after || '없음'}`
  for (const person of parseAssignees(task.assignee)) {
    const target = targetFor(person)
    if (target) {
      leave(target, {
        kind: 'due_changed', detail,
        taskId: task.id, taskName: task.name, projectId: task.projectId,
      })
    }
  }
}

/** 하위 업무가 생겼을 때 — 부모 업무의 담당자에게. */
export function noticeSubtask(parent: Task, child: Task) {
  for (const person of parseAssignees(parent.assignee)) {
    const target = targetFor(person)
    if (target) {
      leave(target, {
        kind: 'subtask', detail: child.name,
        taskId: parent.id, taskName: parent.name, projectId: parent.projectId,
      })
    }
  }
}

export function markNoticeRead(uid: string, id: string) {
  fbUpdate(ref(db, `${P.notices(uid)}/${id}`), { read: true }).catch(() => {})
}

export function markAllNoticesRead(uid: string, ids: string[]) {
  const patch: Record<string, unknown> = {}
  for (const id of ids) patch[`${id}/read`] = true
  if (Object.keys(patch).length) fbUpdate(ref(db, P.notices(uid)), patch).catch(() => {})
}

export function removeNotice(uid: string, id: string) {
  remove(ref(db, `${P.notices(uid)}/${id}`)).catch(() => {})
}
