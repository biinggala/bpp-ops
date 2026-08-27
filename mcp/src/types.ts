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
  links?: TaskLink[]
}

export interface TaskLink {
  id: string
  title: string
  url: string
  driveId?: string
  mimeType?: string
  /** The tab of a multi-tab Google Doc the URL opens on. */
  tabTitle?: string
  /** A line somebody wrote, to tell two links to the same file apart. */
  note?: string
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
  /**
   * 이 프로젝트가 속한 워크스페이스. 한 번 정해지면 안 바뀝니다.
   *
   * 읽을 때 한 겹 더 봐야 하는 근거입니다 — 프로젝트 멤버라도 그 워크스페이스
   * 명단에서 내려간 사람은 못 읽습니다(access.ts의 orgAllows).
   */
  orgId?: string
  archived?: boolean
  driveFolderUrl?: string
  /** Materials belonging to the project rather than to any one task. */
  links?: TaskLink[]
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
