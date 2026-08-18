// Mirrors the record shapes stored in Realtime Database (see docs/data-model.md).
// Kept as a standalone copy rather than imported from ../src so the server has
// no dependency on the web bundle's build setup.
//
// projectId is the task's location rather than a stored field: the store module
// fills it in from the path a task was read from.

export type Status = '진행중' | '대기' | '검토중' | '완료'
export type Priority = '높음' | '중간' | '낮음'
export type TaskType = '상위' | '세부'

export interface Task {
  id: string
  type: TaskType
  name: string
  cat: string
  assignee: string // comma-separated emails and/or legacy member keys
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
  blocking?: string[]
  blockedBy?: string[]
  order?: number
  createdBy?: string
  links?: { id: string; title: string; url: string }[]
}

export interface Project {
  id: string
  name: string
  color: string
  dueDate?: string
  clientName?: string
  inviteCode?: string
  memberEmails?: string[]
  pendingEmails?: string[]
  creatorEmail?: string
  archived?: boolean
}

export interface Milestone {
  id: string
  projectId: string
  name: string
  dueDate: string
  done?: boolean
}

export const STATUSES: Status[] = ['진행중', '대기', '검토중', '완료']
export const PRIORITIES: Priority[] = ['높음', '중간', '낮음']

/** Legacy short keys still present in older tasks' `assignee` field. */
export const LEGACY_MEMBERS: Record<string, string> = {
  YL: 'yeonju@crngfriends.com',
  SJ: 'cotta@crngfriends.com',
  HC: 'biinggala@crngfriends.com',
}
