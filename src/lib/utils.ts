import type { Project } from '../types'

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

/**
 * 담당자 토큰을 정규화합니다. 지금은 소문자로 내리는 것이 전부입니다.
 *
 * 예전에는 'HC' 같은 두 글자 별칭을 이메일로 바꾸는 표가 여기 있었습니다.
 * 회사가 도메인을 옮기면서 그 표의 주소를 쓰는 사람이 아무도 안 남았고,
 * 그때부터 이 함수는 소문자 변환만 하고 있었습니다. 표는 지웠습니다 —
 * 남은 건 직원 세 명의 실명과 옛 주소가 담긴 화면 코드였습니다.
 *
 * 함수는 남깁니다. 담당자 값은 어디서 왔든 여기를 지나야 하고, 언젠가 다시
 * 정규화할 것이 생기면 들어올 자리가 이미 있는 편이 낫습니다.
 */
export function assigneeKeyToEmail(key: string): string {
  return key.toLowerCase().trim()
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

/**
 * 같은 사람을 가리키는 모든 토큰. 지금은 원래 글자와 소문자 둘뿐입니다.
 *
 * 별칭 표가 있던 시절의 흔적입니다. 부르는 곳들이 '한 사람 = 여러 토큰'을
 * 전제하고 있어서 모양은 남겨 둡니다 — 대문자로 저장된 옛 주소가 아직
 * 있을 수 있고, 그건 이 함수가 계속 맞춰 줍니다.
 */
export function assigneeAliases(key: string): string[] {
  return Array.from(new Set([key, assigneeKeyToEmail(key)]))
}

/**
 * ── 담당자로 고를 수 있는 사람 ────────────────────────────────────────────────
 *
 * 담당자는 라벨이 아니라 "이 사람이 한다"는 약속입니다. 그 업무를 **열 수 없는
 * 사람**에게는 약속이 성립하지 않습니다 — 알림은 이메일로 배달되니 도착하지만
 * (notices/$이메일키는 프로젝트 권한과 무관합니다) 눌러도 아무것도 없고,
 * 그 사람의 '내 할 일'에도 안 뜨고, 상태를 바꿀 수도 없습니다.
 *
 * 그래서 고를 수 있는 사람은 **그 업무를 읽을 수 있는 사람**뿐입니다. 업무가
 * 어디 사는지가 그걸 정합니다.
 *
 * **프로젝트 업무** — `projects/$pid/tasks/$tid`. 그 프로젝트의 멤버.
 *
 * **프로젝트 없는 업무** — `personalTasks/$uid/$tid`. DB 규칙이 **본인만**
 * 읽게 합니다. 그러니 후보는 나 하나입니다. 여기가 새고 있었습니다: 목록이
 * '내가 속한 모든 프로젝트의 멤버 전원'으로 떨어져서, 남을 담당자로 지정할 수
 * 있었고 그 사람은 그 업무를 영원히 못 봤습니다.
 *
 * memberEmails가 빈 프로젝트(이 필드가 생기기 전에 만들어진 것)에는 예전
 * 안전망을 남겨 둡니다 — 빈 목록을 주면 아무에게도 못 맡기게 됩니다. 그쪽은
 * '못 보는 사람에게 맡김'이 아니라 '표시용 목록이 안 따라온 것'입니다.
 */
export interface AssigneeOption {
  value: string
  label: string
  /** 초대장은 나갔고 아직 수락 전. 고를 수는 있되 그렇게 말해 줍니다. */
  pending?: boolean
}

export function assigneeOptions(
  projectId: string | null | undefined,
  projects: Project[],
  myEmail: string | null | undefined,
  nameOf: (email: string) => string,
): AssigneeOption[] {
  const label = (e: string): AssigneeOption => ({ value: e, label: nameOf(e) })

  if (!projectId) {
    const me = myEmail?.toLowerCase()
    return me ? [label(me)] : []
  }

  const project = projects.find(p => p.id === projectId)
  const members = project?.memberEmails ?? []
  if (members.length === 0) {
    const fallback = new Set<string>()
    projects.forEach(p => p.memberEmails?.forEach(e => fallback.add(e)))
    return Array.from(fallback).map(label)
  }

  // 초대해 둔 사람도 목록에 남습니다. 초대하면서 맡긴 그 사람이 다음에 이
  // 칸을 열었을 때 목록에 없으면, 방금 한 일이 안 된 것처럼 보입니다.
  const pending = (project?.pendingEmails ?? []).filter(
    e => !members.some(m => m.toLowerCase() === e.toLowerCase()),
  )
  return [...members.map(label), ...pending.map(e => ({ ...label(e), pending: true }))]
}

/**
 * 이 프로젝트 사람은 아니지만, 다른 데서 이미 같이 일하는 사람들.
 *
 * 담당자로 고르려면 먼저 초대해야 하는 사람들입니다. 후보를 여기까지만 두는
 * 이유는 `authorizedEmails`와 같습니다 — 이 화면이 전체 주소록이 되어선
 * 안 됩니다. 내가 이미 어딘가에서 함께 일하는 사람만 보입니다.
 */
export function invitableColleagues(
  projectId: string | null | undefined,
  projects: Project[],
  myEmail: string | null | undefined,
  nameOf: (email: string) => string,
): { value: string; label: string }[] {
  if (!projectId) return []
  const project = projects.find(p => p.id === projectId)
  if (!project) return []

  const already = new Set(
    [...(project.memberEmails ?? []), ...(project.pendingEmails ?? [])].map(e => e.toLowerCase()),
  )
  const me = myEmail?.toLowerCase()
  return Array.from(authorizedEmails(projects, myEmail))
    .filter(e => e !== me && !already.has(e))
    .sort()
    .map(e => ({ value: e, label: nameOf(e) }))
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

/**
 * Copies text, by whichever route the surface allows.
 *
 * navigator.clipboard is the modern one and can reject outright — an embedded
 * webview may refuse it even inside a click. The old selection trick still works
 * where that happens, and the boolean is there so the caller can stop claiming
 * success it did not have.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch { /* fall through to the old way */ }

  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const ok = document.execCommand('copy')
    field.remove()
    return ok
  } catch {
    return false
  }
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function gid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/**
 * ── 초대 코드 ────────────────────────────────────────────────────────────────
 *
 * 프로젝트에 들어오는 **유일한 열쇠**입니다. 규칙이 보는 것이 이것뿐이라
 * (`members/$uid`에 이 값을 적으면 멤버가 됩니다), 맞히면 초대받은 적 없는
 * 프로젝트의 모든 업무와 메모를 읽고 씁니다.
 *
 * `gid()`로 만들고 있었습니다. 두 가지가 문제였습니다:
 *
 *   1. `Math.random()`은 암호용이 아닙니다. 브라우저의 그 난수는 상태를
 *      가진 계산기라, 출력 몇 개를 보면 상태를 되찾아 **앞뒤 값을 계산**할
 *      수 있습니다.
 *   2. 프로젝트를 만들 때 초대 코드를 뽑고 **바로 다음에** 프로젝트 id를
 *      같은 난수로 뽑았습니다. 그 id는 워크스페이스에 공개하면 명단에
 *      올라가고, 참여 요청에도 실립니다 — 즉 **옆자리 값이 남에게 보입니다.**
 *      1번과 합치면 보이는 값에서 안 보이는 값으로 갈 수 있습니다.
 *
 * `crypto.getRandomValues`는 그런 되찾기가 안 됩니다. 16자리 base32이고,
 * 헷갈리는 글자(0/O, 1/I/l)는 뺐습니다 — 사람이 옮겨 적을 수도 있어서.
 *
 * 이미 나가 있는 코드는 그대로 삽니다. 바꾸면 이미 보낸 초대 링크가 전부
 * 죽습니다 — 새로 만드는 것부터 강해집니다.
 */
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export function inviteCode(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // 31글자를 256에서 고르면 앞쪽 글자가 조금 더 자주 나옵니다. 초대 코드
  // 하나를 맞히는 일에 영향을 줄 만한 치우침은 아니고, 버리고 다시 뽑는
  // 쪽이 이 자리에서는 더 복잡합니다.
  return Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
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
 * equality, so any task with two assignees ("a,b") never matched — while the
 * view matched on substring and by email. The badge and the list were
 * answering different questions.
 */
/** 오늘로부터 며칠. 음수는 지났다는 뜻입니다. */
export function daysFrom(dateStr: string, base: Date = new Date()): number {
  const from = new Date(base).setHours(0, 0, 0, 0)
  return Math.round((new Date(dateStr).setHours(0, 0, 0, 0) - from) / 86400000)
}

export function isAssignedTo(
  assignee: string,
  email: string | null | undefined,
): boolean {
  if (!assignee || !email) return false
  // 주소 전체로 맞춥니다. 부분 일치였을 때 lee@는 klee@의 업무를 '내 것'으로 봤습니다.
  const me = email.toLowerCase().trim()
  return parseAssignees(assignee).some(tok => assigneeKeyToEmail(tok) === me || tok.toLowerCase() === me)
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
