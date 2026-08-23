import { push, ref, set as fbSet, update as fbUpdate, remove } from 'firebase/database'
import { db } from './firebase'
import { P } from './paths'
import { useAuthStore } from '../store/authStore'
import { useUserProfileStore } from '../store/userProfileStore'
import { assigneeKeyToEmail, parseAssignees } from './utils'
import { pushNotice } from './push'
import type { Status, Task } from '../types'

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
  | 'status_changed' // 내가 담당인 업무의 상태를 남이 바꿈
  | 'subtask'       // 내 업무 아래 하위 업무가 생김
  | 'due_soon'      // 아침 브리핑이 남기는 것 (서버가 씀)
  | 'overdue'
  | 'file_changed'  // 내 업무에 붙여 둔 드라이브 파일을 남이 고침
  | 'file_removed'  // 그 파일이 사라짐 (휴지통 / 공유 해제)

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
  /** For a status change: the status it moved *to*, so the row can draw it. */
  status?: Status
  at: number
  read?: boolean
}

/**
 * Everything the app needs to address a notice at somebody.
 *
 * The email is what addresses it and is always available. The uid is optional
 * and only buys the extra buzz: the push sender stores subscriptions by uid, so
 * without it the notice still lands in the inbox and simply does not ring.
 */
type Target = { email: string; uid?: string }

/**
 * Who an assignee token refers to.
 *
 * This used to return null unless the person's uid could be found among the
 * loaded profiles, and the whole feature turned on that: profiles are only
 * loaded for uids listed in a shared project's member node, so anybody missing
 * from that list got **no notice at all**, silently, while their name still
 * rendered fine from the email. That is why a status change reached nobody.
 *
 * Now the email addresses the notice and always resolves. The uid is looked up
 * as a bonus for the push sender, and its absence costs a buzz rather than the
 * message.
 */
function targetFor(assignee: string): Target | null {
  const email = assigneeKeyToEmail(assignee)
  if (!email) return null
  const profiles = useUserProfileStore.getState().profiles
  for (const [uid, profile] of Object.entries(profiles)) {
    if (profile.email?.toLowerCase() === email) return { email, uid }
  }
  return { email }
}

function myName(): string {
  const { email, displayName } = useAuthStore.getState()
  return displayName || email?.split('@')[0] || '누군가'
}

/** How each kind reads in the inbox — a phrase, where the push gets a sentence. */
export const NOTICE_LABEL: Record<NoticeKind, string> = {
  assigned:       '담당자로 지정',
  unassigned:     '담당에서 제외',
  due_changed:    '마감일 변경',
  status_changed: '상태 변경',
  subtask:        '하위 업무 추가',
  due_soon:       '마감 임박',
  overdue:        '마감 지남',
  file_changed:   '첨부 파일 수정',
  file_removed:   '첨부 파일 없어짐',
}

/** Colour carries the kind at a glance; the dot is the only colour in the row. */
export const NOTICE_TONE: Record<NoticeKind, string> = {
  assigned:       '#2383E2',
  unassigned:     '#787774',
  due_changed:    '#D9730D',
  status_changed: '#2383E2',
  subtask:        '#9065B0',
  due_soon:       '#D9730D',
  overdue:        'var(--danger)',
  file_changed:   '#0F9D58',
  file_removed:   'var(--danger)',
}

/** How each kind reads as a notification title. The body is the task's name. */
export const NOTICE_HEADLINE: Record<NoticeKind, string> = {
  assigned:    '새 업무를 맡았습니다',
  unassigned:  '담당에서 제외됐습니다',
  due_changed: '마감일이 바뀌었습니다',
  status_changed: '상태가 바뀌었습니다',
  subtask:     '하위 업무가 추가됐습니다',
  due_soon:    '마감이 다가옵니다',
  overdue:     '마감이 지났습니다',
  file_changed: '첨부 파일이 수정됐습니다',
  file_removed: '첨부 파일이 없어졌습니다',
}

/**
 * Writes one notice, then asks the server to buzz the phone about it.
 *
 * Both are fire-and-forget: a failed notice must not fail the edit that caused
 * it, and a failed push costs a buzz rather than the information — the inbox
 * already has it by then.
 */
function leave(target: Target, notice: Omit<Notice, 'id' | 'at' | 'by'>) {
  const { uid: me, email: myEmail } = useAuthStore.getState()
  if (!me) return
  // Never for one's own doing, by either name for the same person.
  if (target.uid === me || target.email === myEmail?.toLowerCase()) return

  const node = push(ref(db, P.notices(target.email)))
  const payload: Record<string, unknown> = { ...notice, by: myName(), at: Date.now() }
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key]
  }
  // A rejected write used to go to the console, and on a phone the console is
  // nowhere. The person who made the change is the only one in a position to
  // notice — the recipient by definition never learns of it.
  fbSet(node, payload)
    .then(() => announce(target.email))
    .catch(e => {
      console.warn('[notice]', e)
      report(`${target.email}에게 알림 전달 실패`)
    })

  // Push is addressed by uid, because that is how subscriptions are stored.
  // No uid, no buzz; the notice above is delivered either way.
  if (!target.uid) return
  const detail = notice.detail ? ` · ${notice.detail}` : ''
  void pushNotice(
    target.uid,
    NOTICE_HEADLINE[notice.kind],
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

/**
 * 상태가 바뀌었을 때 — 그 일을 들고 있는 사람들에게.
 *
 * 상태 changes are the one kind of edit that is worth telling an assignee about
 * even though it is "just a field". Somebody else moving my task to 검토중 means
 * it is waiting on me; moving it to 완료 means it is not mine any more. Both are
 * facts about my day that I would otherwise learn by accident.
 *
 * In practice this stays quiet: the person who moves a status is usually the
 * assignee doing their own work, and `leave()` never notifies the person who
 * made the change. What is left is exactly the case worth a buzz — somebody
 * *else* moved my task.
 */
export function noticeStatusChange(task: Task, before: Status, after: Status) {
  for (const person of parseAssignees(task.assignee)) {
    const target = targetFor(person)
    if (target) {
      leave(target, {
        kind: 'status_changed', detail: `${before} → ${after}`, status: after,
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

export function markNoticeRead(email: string, id: string) {
  fbUpdate(ref(db, `${P.notices(email)}/${id}`), { read: true }).catch(() => {})
}

export function markAllNoticesRead(email: string, ids: string[]) {
  const patch: Record<string, unknown> = {}
  for (const id of ids) patch[`${id}/read`] = true
  if (Object.keys(patch).length) fbUpdate(ref(db, P.notices(email)), patch).catch(() => {})
}

export function removeNotice(email: string, id: string) {
  remove(ref(db, `${P.notices(email)}/${id}`)).catch(() => {})
}

/**
 * ── 보낸 사람에게 남기는 한 줄 ───────────────────────────────────────────────
 *
 * Both halves matter, and the second one is the newer lesson.
 *
 * A write that *fails* has to be reported, because the recipient by definition
 * never learns of it — and the console is nowhere, on a phone or in a webview.
 *
 * A write that *succeeds* has to be reported too. Otherwise the only difference
 * between "it went" and "it silently did nothing" is an error that never
 * appears, which is not a difference anybody can see. Changing somebody else's
 * task and wondering whether they will ever know is the exact doubt this line
 * removes.
 */
let onNotice: ((message: string) => void) | null = null
export function setNoticeReporter(report: (message: string) => void) {
  onNotice = report
}

function report(message: string) {
  onNotice?.(message)
}

/**
 * One line for a run of notices rather than one per person.
 *
 * A single edit can reach three assignees, and three toasts in a row for one
 * click reads as a malfunction. They are collected for a moment and named
 * together.
 */
const announced = new Set<string>()
let announceTimer: number | null = null

function announce(email: string) {
  announced.add(useUserProfileStore.getState().getNameByEmail(email))
  if (announceTimer) clearTimeout(announceTimer)
  announceTimer = window.setTimeout(() => {
    const names = [...announced]
    announced.clear()
    announceTimer = null
    if (names.length) report(`${names.join(', ')}님에게 알림을 보냈습니다`)
  }, 400)
}
