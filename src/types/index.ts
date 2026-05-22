export type TaskType = '상위' | '세부'
export type Category = 'Strategy' | 'Production' | 'Internal Ops' | 'Biz Dev' | 'Branding' | 'Analytics' | 'Community'
export type Status = '진행중' | '대기' | '검토중' | '완료'
export type Priority = '높음' | '중간' | '낮음'
export type MemberKey = 'YL' | 'SJ' | 'HC'
export type ViewType = 't' | 'b' | 'c' | 'p' | 'g' | 's'

export interface Task {
  id: string
  type: TaskType
  name: string
  cat: Category
  assignee: string   // comma-separated MemberKeys e.g. "YL,HC"
  start: string      // YYYY-MM-DD
  due: string        // YYYY-MM-DD
  priority: Priority
  status: Status
  progress: number   // 0–100
  memo: string
  parentId?: string
  order?: number
  checklist?: ChecklistItem[]
  gcalEventId?: string
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface Member {
  key: MemberKey
  n: string          // display name
  email: string
  grad: string       // CSS gradient or color
}

export interface ColorConfig {
  [key: string]: { bg: string; text: string }
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

export const CATEGORIES: Category[] = [
  'Strategy', 'Production', 'Internal Ops', 'Biz Dev', 'Branding', 'Analytics', 'Community',
]

export const STATUS_LIST: Status[] = ['진행중', '대기', '검토중', '완료']
export const PRIORITY_LIST: Priority[] = ['높음', '중간', '낮음']

export const CAT_COLORS: Record<Category, { bg: string; text: string }> = {
  Strategy:     { bg: '#fef3c7', text: '#92400e' },
  Production:   { bg: '#fee2e2', text: '#b91c1c' },
  'Internal Ops': { bg: '#d1fae5', text: '#065f46' },
  'Biz Dev':    { bg: '#dbeafe', text: '#1e40af' },
  Branding:     { bg: '#fce7f3', text: '#9d174d' },
  Analytics:    { bg: '#e0e7ff', text: '#3730a3' },
  Community:    { bg: '#dcfce7', text: '#166534' },
}

export const STATUS_COLORS: Record<Status, { bg: string; text: string }> = {
  진행중: { bg: 'rgba(0,122,255,.1)', text: '#007aff' },
  대기:   { bg: '#f3f4f6',           text: '#6b7280' },
  검토중: { bg: '#fef3c7',           text: '#d97706' },
  완료:   { bg: '#d1fae5',           text: '#059669' },
}
