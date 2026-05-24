export type TaskType = '상위' | '세부'
export type Status = '진행중' | '대기' | '검토중' | '완료'
export type Priority = '높음' | '중간' | '낮음'
export type MemberKey = 'YL' | 'SJ' | 'HC'
export type ViewType = 't' | 'b' | 'c' | 'p' | 'g' | 's'

// Category는 이제 동적 — Space의 name 값
export type Category = string

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
}

export interface Milestone {
  id: string
  projectId: string
  name: string
  dueDate: string     // YYYY-MM-DD
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
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
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

export const STATUS_COLORS: Record<Status, { bg: string; text: string }> = {
  진행중: { bg: 'rgba(35,131,226,.14)', text: '#1869c9' },
  대기:   { bg: 'rgba(120,117,114,.12)', text: '#4b4947' },
  검토중: { bg: '#fef3c7',              text: '#b45309' },
  완료:   { bg: '#d1fae5',              text: '#047857' },
}

// Space용 색상 팔레트
export const SPACE_PALETTE = [
  '#007aff','#ef4444','#10b981','#f59e0b','#8b5cf6',
  '#06b6d4','#ec4899','#3730a3','#166534','#92400e',
]

// Project용 색상 팔레트
export const PROJECT_PALETTE = [
  '#2383e2','#8b5cf6','#059669','#dc2626','#d97706',
  '#0891b2','#7c3aed','#be185d','#047857','#b45309',
]

// Space 이름으로 배지 색상 생성 (해시 기반)
export function getCatColor(spaceName: string): { bg: string; text: string } {
  const presets: Record<string, { bg: string; text: string }> = {
    Strategy:       { bg: '#fef3c7', text: '#92400e' },
    Production:     { bg: '#fee2e2', text: '#b91c1c' },
    'Internal Ops': { bg: '#d1fae5', text: '#065f46' },
    'Biz Dev':      { bg: '#dbeafe', text: '#1e40af' },
    Branding:       { bg: '#fce7f3', text: '#9d174d' },
    Analytics:      { bg: '#e0e7ff', text: '#3730a3' },
    Community:      { bg: '#dcfce7', text: '#166534' },
  }
  if (presets[spaceName]) return presets[spaceName]

  // 해시로 팔레트에서 색 선택
  let h = 0
  for (let i = 0; i < spaceName.length; i++) h = spaceName.charCodeAt(i) + ((h << 5) - h)
  const color = SPACE_PALETTE[Math.abs(h) % SPACE_PALETTE.length]
  return { bg: color + '18', text: color }
}

export const TAG_PALETTE = [
  '#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316',
  '#eab308','#22c55e','#06b6d4','#3b82f6','#14b8a6',
]

export function getTagColor(tag: string): { bg: string; text: string } {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = tag.charCodeAt(i) + ((h << 5) - h)
  const color = TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length]
  return { bg: color + '18', text: color }
}
