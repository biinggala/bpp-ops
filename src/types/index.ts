export type TaskType = '상위' | '세부'
export type Status = '진행중' | '대기' | '검토중' | '완료'
export type Priority = '높음' | '중간' | '낮음'
export type MemberKey = 'YL' | 'SJ' | 'HC'
export type ViewType = 't' | 'b' | 'c' | 'g' | 's' | 'f'

// Category는 이제 동적 — Space의 name 값
export type Category = string

/** How much time the calendar shows at once. */
export type CalRange = 1 | 3 | 7 | 'month'

export interface Space {
  id: string
  name: string
  color: string   // hex or css color for dot
}

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
}

export interface Member {
  key: MemberKey
  n: string
  email: string
  grad: string
}

export const MEMBERS: Record<MemberKey, Member> = {
  YL: { key: 'YL', n: '이연주', email: 'yeonju@crngfriends.com', grad: 'linear-gradient(135deg,#f093fb,#f5576c)' },
  SJ: { key: 'SJ', n: '정세운', email: 'cotta@crngfriends.com',  grad: 'linear-gradient(135deg,#4facfe,#00f2fe)' },
  HC: { key: 'HC', n: '최희건', email: 'biinggala@crngfriends.com', grad: 'linear-gradient(135deg,#43e97b,#38f9d7)' },
}

export const ALLOWED_EMAILS: Record<string, MemberKey> = {
  'yeonju@crngfriends.com': 'YL',
  'cotta@crngfriends.com': 'SJ',
  'biinggala@crngfriends.com': 'HC',
}

export const STATUS_LIST: Status[] = ['진행중', '대기', '검토중', '완료']
export const PRIORITY_LIST: Priority[] = ['높음', '중간', '낮음']

/**
 * Notion's light palette: a pale tinted background carrying a mid-tone text of
 * the same hue. Verified directly against Notion for blue (bg #E7F3F8, text
 * #487CA5), green (#DBEDDB) and brown (#EEE0DA); the rest are the same published
 * set, which could not be fetched here.
 */
export const NOTION = {
  gray:   { bg: '#EBECED', text: '#787774' },
  brown:  { bg: '#EEE0DA', text: '#9F6B53' },
  orange: { bg: '#FAEBDD', text: '#D9730D' },
  yellow: { bg: '#FBF3DB', text: '#CB912F' },
  green:  { bg: '#DBEDDB', text: '#448361' },
  blue:   { bg: '#E7F3F8', text: '#487CA5' },
  purple: { bg: '#EAE4F2', text: '#9065B0' },
  pink:   { bg: '#F4DFEB', text: '#C14C8A' },
  red:    { bg: '#FFE2DD', text: '#D44C47' },
} as const

export const STATUS_COLORS: Record<Status, { bg: string; text: string }> = {
  진행중: NOTION.blue,
  대기:   NOTION.gray,
  검토중: NOTION.yellow,
  완료:   NOTION.green,
}

// Notion's icon-strength colours: saturated enough to identify a dot at 8px,
// still from the same family as the badge tints so nothing clashes.
export const SPACE_PALETTE = [
  '#337EA9','#D44C47','#448361','#CB912F','#9065B0',
  '#9F6B53','#C14C8A','#787774','#D9730D','#2383E2',
]

export const PROJECT_PALETTE = [
  '#2383E2','#9065B0','#448361','#D44C47','#D9730D',
  '#337EA9','#C14C8A','#CB912F','#9F6B53','#787774',
]

// Space 이름으로 배지 색상 생성 (해시 기반)
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
  '#487CA5','#9065B0','#C14C8A','#D44C47','#D9730D',
  '#CB912F','#448361','#337EA9','#9F6B53','#787774',
]

export function getTagColor(tag: string): { bg: string; text: string } {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = tag.charCodeAt(i) + ((h << 5) - h)
  const pairs = Object.values(NOTION)
  return pairs[Math.abs(h) % pairs.length]
}
