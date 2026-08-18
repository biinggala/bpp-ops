import type { Project } from '../types'
import { MEMBERS } from '../types'
import type { MemberKey } from '../types'

// Central project access-check used everywhere.
// Access is granted ONLY if the user's email is explicitly listed as a member
// or matches the creator. Projects with no ownership data are denied — there is
// no "public" fallback, because other users' legacy projects would otherwise leak.
export function canAccessProject(p: Project, userEmail: string | null | undefined): boolean {
  const e = userEmail?.toLowerCase() ?? ''
  if (!e) return false
  if (p.memberEmails?.some(m => m.toLowerCase() === e)) return true
  if (p.creatorEmail && p.creatorEmail.toLowerCase() === e) return true
  return false
}

// Resolve an assignee token (a raw email, or a legacy MemberKey like 'HC') to
// its canonical lowercased email, so authorization checks are alias-agnostic.
export function assigneeKeyToEmail(key: string): string {
  const legacy = MEMBERS[key as MemberKey]
  return (legacy?.email ?? key).toLowerCase()
}

// The set of emails (lowercased) whose data may be surfaced to the current user:
// members and creators of every project they can access, plus themselves.
// Anyone outside this set must never appear in assignee/stats/filter views.
export function authorizedEmails(projects: Project[], userEmail: string | null | undefined): Set<string> {
  const out = new Set<string>()
  const self = userEmail?.toLowerCase()
  if (self) out.add(self)
  for (const p of projects) {
    if (!canAccessProject(p, userEmail)) continue
    p.memberEmails?.forEach(m => out.add(m.toLowerCase()))
    if (p.creatorEmail) out.add(p.creatorEmail.toLowerCase())
  }
  return out
}

// True if an assignee token belongs to an authorized participant.
export function isAuthorizedAssignee(key: string, authorized: Set<string>): boolean {
  return authorized.has(assigneeKeyToEmail(key))
}

// All tokens that refer to the same person as `key` — the canonical email plus
// any legacy MemberKey mapping to it. Used so a single selected assignee filter
// matches tasks whether they were assigned by email or by legacy key.
export function assigneeAliases(key: string): string[] {
  const email = assigneeKeyToEmail(key)
  const out = new Set<string>([key, email])
  for (const m of Object.values(MEMBERS)) {
    if (m.email.toLowerCase() === email) { out.add(m.key); out.add(m.email.toLowerCase()) }
  }
  return Array.from(out)
}

/**
 * A link is only opened if it is plainly http(s).
 *
 * Any project member can set the folder address, and the app opens it in a new
 * tab — without this check a `javascript:` address would run in the app's own
 * origin the moment someone clicked the folder icon.
 */
export function safeExternalUrl(raw: string | undefined | null): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch { return null }
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function gid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function fmtDate(d: string): string {
  if (!d) return ''
  const dt = new Date(d)
  return `${dt.getMonth() + 1}/${dt.getDate()}`
}

export function isOverdue(due: string, status: string): boolean {
  if (!due || status === '완료') return false
  return new Date(due) < new Date(new Date().toDateString())
}

export function parseAssignees(assignee: string): string[] {
  return assignee ? assignee.split(',').map(s => s.trim()).filter(Boolean) : []
}

/**
 * Is this task assigned to the given person?
 *
 * One definition, used by both the 내 할 일 view and the sidebar's count of it.
 * They used to disagree: the sidebar compared the whole assignee string for
 * equality, so any task with two assignees ("a,b") never matched, and anyone
 * without a legacy MemberKey counted zero — while the view matched on substring
 * and by email. The badge and the list were answering different questions.
 */
export function isAssignedTo(
  assignee: string,
  memberKey: string | null | undefined,
  email: string | null | undefined,
): boolean {
  if (!assignee) return false
  if (memberKey && assignee.includes(memberKey)) return true
  if (email && assignee.toLowerCase().includes(email.toLowerCase())) return true
  return false
}

const STORAGE_KEY = 'cringe_v9'

export function loadFromStorage<T>(key = STORAGE_KEY): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function saveToStorage<T>(data: T, key = STORAGE_KEY): void {
  try {
    localStorage.setItem(key, JSON.stringify(data))
    localStorage.setItem(key + '_ts', String(Date.now()))
  } catch { /* quota exceeded etc. */ }
}

export function getLocalTs(key = STORAGE_KEY): number {
  return parseInt(localStorage.getItem(key + '_ts') || '0')
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}

export function toDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function fmtYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

// BFS: returns all task IDs reachable via .blocking chains from startId (startId excluded)
export function getBlockingCascade(startId: string, allTasks: { id: string; blocking?: string[] }[]): string[] {
  const result: string[] = []
  const visited = new Set<string>([startId])
  const queue = [startId]
  while (queue.length) {
    const id = queue.shift()!
    const task = allTasks.find(t => t.id === id)
    task?.blocking?.forEach(bid => {
      if (!visited.has(bid)) {
        visited.add(bid)
        result.push(bid)
        queue.push(bid)
      }
    })
  }
  return result
}

// True while an IME (Korean/Japanese/Chinese) is still composing a character.
//
// Pressing Enter to commit a composition fires a keydown with key === 'Enter'
// *and* is followed by a second, real Enter keydown — so an unguarded handler
// runs twice. In the inline add-task row that produced two tasks: the full text,
// then the trailing syllable that the IME re-inserted into the cleared input.
//
// `keyCode === 229` is the legacy signal for the same state, kept for older
// WebKit where `isComposing` is unreliable.
// Accepts both React synthetic events and native ones without pulling React in.
type ComposableKeyEvent = KeyboardEvent | { nativeEvent: KeyboardEvent }

export function isComposing(e: ComposableKeyEvent): boolean {
  const native = 'nativeEvent' in e ? e.nativeEvent : e
  return native.isComposing || native.keyCode === 229
}
