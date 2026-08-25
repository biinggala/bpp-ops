export type TaskType = '상위' | '세부'
export type Status = '진행중' | '대기' | '검토중' | '완료'
export type Priority = '높음' | '중간' | '낮음'
export type ViewType = 't' | 'b' | 'c' | 'g' | 's' | 'f'

/** 업무에 적히는 분류 이름. 지금은 부모에게서 물려받는 것 말고는 안 붙습니다. */
export type Category = string

/** How much time the calendar shows at once. */
export type CalRange = 1 | 3 | 7 | 'month'

export interface Project {
  id: string
  name: string
  color: string       // from PROJECT_PALETTE
  dueDate?: string    // YYYY-MM-DD
  clientName?: string
  inviteCode?: string      // short code for invite links
  memberEmails?: string[]  // fully joined members — only these emails can see the project
  pendingEmails?: string[] // invited but not yet accepted
  creatorEmail?: string    // email of the user who created this project
  /**
   * 어느 회사의 프로젝트인가. **한 번 정해지면 안 바뀝니다**(규칙).
   *
   * 아직 아무것도 안 막습니다 — 접근은 계속 프로젝트 멤버십이 정합니다.
   * docs/tenants.md 참고.
   */
  orgId?: string
  archived?: boolean       // completed/retired — hidden from active lists and aggregates
  driveFolderUrl?: string  // the project's folder, opened straight from the sidebar
  /**
   * Materials that belong to the project rather than to any one task.
   *
   * A 계약서 or a 브랜드 가이드 is not work anybody is doing — it is the shelf
   * the work is done from. Before this there was nowhere to file one except a
   * task it did not belong to.
   */
  links?: TaskLink[]
  /**
   * Which shelf of the sidebar this project sits on — 프로덕션, 앱개발, and so on.
   *
   * Shared, and deliberately so: it says what kind of work the project is, which
   * is a fact about the project rather than a preference of whoever is looking.
   * Fifty people need one name for the same thing. It is a label and not a
   * boundary — access is still project membership alone, so a shelf simply has
   * fewer projects on it for someone who cannot see them all.
   *
   * The *order* of the sidebar is the opposite kind of thing and is kept per
   * person, in localStorage. See Sidebar.
   */
  group?: string
}

export interface Milestone {
  id: string
  projectId: string
  name: string
  dueDate: string     // YYYY-MM-DD
  done?: boolean
}

export interface Task {
  id: string
  type: TaskType
  name: string
  cat: Category
  assignee: string
  start: string
  due: string
  priority: Priority
  status: Status
  progress: number
  memo: string
  parentId?: string
  projectId?: string
  milestoneId?: string
  tags?: string[]
  blocking?: string[]   // task IDs this task is blocking
  blockedBy?: string[]  // task IDs this task is blocked by
  order?: number
  checklist?: ChecklistItem[]
  createdBy?: string  // email of the task creator
  links?: TaskLink[]
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface TaskLink {
  id: string
  /** What it was called when it was attached — the fallback when Drive is unreachable. */
  title: string
  url: string
  /**
   * Set when this points at something in Drive.
   *
   * The id is the durable half: names change, files move between folders, and a
   * URL captured once records neither. Holding the id lets the app show what the
   * file is called now rather than what somebody typed last spring.
   */
  driveId?: string
  /** Cached so the right icon is drawn before Drive answers. */
  mimeType?: string
  /**
   * The tab of a multi-tab Google Doc this points at.
   *
   * Kept beside the URL rather than only inside it, so the row can say which
   * tab it opens without parsing its own link back apart.
   */
  tabTitle?: string
  /**
   * A line the person writes, to tell two links to the same file apart.
   *
   * The displayed name comes from Drive, so three links into one 출연자 미팅록
   * — one per interviewee's tab — read as the same row three times. The tab
   * name helps only when the tabs were named well; this is where somebody says
   * what they actually meant.
   */
  note?: string
}

/**
 * 일이 실제로 지나가는 순서 그대로: 대기 → 진행중 → 검토중 → 완료.
 *
 * 이 한 줄이 보드의 열 순서, 상태 메뉴, 필터, 그룹 순서를 전부 정합니다.
 * 진행중이 맨 앞이던 시절에는 보드가 두 번째 칸에서 시작했습니다.
 */
export const STATUS_LIST: Status[] = ['대기', '진행중', '검토중', '완료']
export const PRIORITY_LIST: Priority[] = ['높음', '중간', '낮음']

/**
 * Notion's light palette: a pale tinted background carrying a mid-tone text of
 * the same hue. Verified directly against Notion for blue (bg #E7F3F8, text
 * #487CA5), green (#DBEDDB) and brown (#EEE0DA); the rest are the same published
 * set, which could not be fetched here.
 */
/**
 * Notion's tag palette, as tokens rather than hexes.
 *
 * The values live in index.css so that a tag, a status pill and a milestone
 * diamond all turn over together when the theme does. A literal here would have
 * been a colour that only works in one of the two.
 */
export const NOTION = {
  gray:   { bg: 'var(--n-gray-bg)',   text: 'var(--n-gray-tx)' },
  brown:  { bg: 'var(--n-brown-bg)',  text: 'var(--n-brown-tx)' },
  orange: { bg: 'var(--n-orange-bg)', text: 'var(--n-orange-tx)' },
  yellow: { bg: 'var(--n-yellow-bg)', text: 'var(--n-yellow-tx)' },
  green:  { bg: 'var(--n-green-bg)',  text: 'var(--n-green-tx)' },
  blue:   { bg: 'var(--n-blue-bg)',   text: 'var(--n-blue-tx)' },
  purple: { bg: 'var(--n-purple-bg)', text: 'var(--n-purple-tx)' },
  pink:   { bg: 'var(--n-pink-bg)',   text: 'var(--n-pink-tx)' },
  red:    { bg: 'var(--n-red-bg)',    text: 'var(--n-red-tx)' },
} as const

export const STATUS_COLORS: Record<Status, { bg: string; text: string }> = {
  진행중: NOTION.blue,
  대기:   NOTION.gray,
  검토중: NOTION.yellow,
  완료:   NOTION.green,
}

/**
 * 상태, as the filled pill it is in the list.
 *
 * The tints in STATUS_COLORS are for places where the status is a footnote — a
 * dot on a calendar chip, a line in a menu. In the list it is the column people
 * actually read the table for, and a pale tint left it indistinguishable from
 * the four other pale tints in the same row. Filled, it is the only saturated
 * shape on the line.
 *
 * 대기 is the exception, and deliberately: nothing has happened yet, so it is
 * outlined rather than filled. What catches the eye down a long list is then
 * exactly the rows where something is going on.
 *
 * The fills are the app's own accent tones rather than darker, strictly
 * AA-compliant versions of them. Pushing the amber down to 4.5:1 against white
 * turns it olive — it was tried, side by side, and the pill stopped looking
 * like anything you would want on the screen. At 12px/600 on these fills the
 * label is comfortably readable, and the mark beside it carries the same
 * meaning without relying on colour at all.
 */
export const STATUS_SOLID: Record<Status, { fill: string; text: string; ring: string }> = {
  진행중: { fill: '#2383E2', text: '#ffffff', ring: 'transparent' },
  대기:   { fill: 'transparent', text: 'var(--n-gray-tx)', ring: 'var(--bd2)' },
  검토중: { fill: '#D9730D', text: '#ffffff', ring: 'transparent' },
  완료:   { fill: '#448361', text: '#ffffff', ring: 'transparent' },
}

/**
 * 우선순위 as a ranking: one colour, three weights, and a bar that shortens.
 *
 * 낮음 is grey and weightless on purpose — it is the absence of urgency, and
 * the old pale-blue pill for it pulled more attention than the amber 중간 above
 * it, which inverted the order the field exists to express.
 */
export const PRIORITY_ORDER: Record<Priority, { color: string; weight: number; bar: number }> = {
  높음: { color: 'var(--danger)', weight: 600, bar: 1 },
  중간: { color: '#D9730D', weight: 500, bar: .55 },
  낮음: { color: 'var(--t3)', weight: 400, bar: .35 },
}

/** The one colour that stands for a status, wherever a status is not a pill. */
export function statusAccent(status: Status): string {
  const s = STATUS_SOLID[status] ?? STATUS_SOLID['대기']
  return s.fill === 'transparent' ? s.text : s.fill
}

// Notion's icon-strength colours: saturated enough to identify a dot at 8px,
// still from the same family as the badge tints so nothing clashes.
export const PROJECT_PALETTE = [
  '#2383E2','#9065B0','#448361','var(--danger)','#D9730D',
  '#337EA9','#C14C8A','#CB912F','#9F6B53','#787774',
]

// 분류 이름으로 배지 색상 생성 (해시 기반)
export function getCatColor(spaceName: string): { bg: string; text: string } {
  const presets: Record<string, { bg: string; text: string }> = {
    Strategy:       NOTION.yellow,
    Production:     NOTION.red,
    'Internal Ops': NOTION.green,
    'Biz Dev':      NOTION.blue,
    Branding:       NOTION.pink,
    Analytics:      NOTION.purple,
    Community:      NOTION.green,
  }
  if (presets[spaceName]) return presets[spaceName]

  // 해시로 팔레트에서 색 선택
  let h = 0
  for (let i = 0; i < spaceName.length; i++) h = spaceName.charCodeAt(i) + ((h << 5) - h)
  const pairs = Object.values(NOTION)
  return pairs[Math.abs(h) % pairs.length]
}

export const TAG_PALETTE = [
  '#487CA5','#9065B0','#C14C8A','var(--danger)','#D9730D',
  '#CB912F','#448361','#337EA9','#9F6B53','#787774',
]

export function getTagColor(tag: string): { bg: string; text: string } {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = tag.charCodeAt(i) + ((h << 5) - h)
  const pairs = Object.values(NOTION)
  return pairs[Math.abs(h) % pairs.length]
}
