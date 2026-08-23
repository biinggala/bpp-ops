import { create } from 'zustand'
import type { ViewType, Status, CalRange } from '../types'

interface Filters {
  assignees: string[]
  statuses: Status[]
  tags: string[]
  projects: string[]
  search: string
  sort: 'due_asc' | 'due_desc' | 'priority_desc' | 'name_asc' | 'default'
}

/**
 * How the list view groups rows.
 *
 * 'project' is the original nested layout — one card per project, milestones
 * inside it. Everything else flattens to a single table so a row can be
 * compared against every other row, which is the only way to answer "what is
 * urgent right now" across projects. Flat rows carry their project/milestone
 * as a breadcrumb instead of getting it from the header they sit under.
 */
export type ListGroup = 'project' | 'none' | 'due' | 'priority' | 'assignee' | 'status' | 'tag'

interface UiState {
  view: ViewType
  listGroup: ListGroup
  space: string | null
  projectId: string | null      // sidebar project filter
  myTasksOnly: boolean          // quick filter: my tasks
  hideCompleted: boolean        // hide tasks with status === '완료'
  filters: Filters
  /**
   * 지금 보고 있는 게 '오늘'인가, 업무 화면인가.
   *
   * 뷰 탭(리스트·보드·캘린더…)은 *한 프로젝트의 업무를 보는 방법들*이라 오늘이
   * 낄 자리가 아닙니다. 오늘은 프로젝트에 속하지도, 남과 공유되지도 않습니다.
   * 그래서 한 층 위에 둡니다.
   */
  screen: 'today' | 'work'
  setScreen: (s: 'today' | 'work') => void
  /** 오늘 화면이 펼쳐 놓은 날짜. null이면 진짜 오늘입니다. */
  noteDate: string | null
  openNote: (date: string | null) => void
  detailTaskId: string | null
  editTaskId: string | null
  newTaskParentId: string | null
  newTaskMilestoneId: string | null
  newTaskProjectId: string | null
  isTaskModalOpen: boolean
  isFilterPanelOpen: boolean
  isColorSettingsOpen: boolean
  isCommandPaletteOpen: boolean
  sidebarOpen: boolean
  /** Calendar: how much is shown at once, and the date it starts from. */
  calRange: CalRange
  calAnchor: string

  setView: (v: ViewType) => void
  setListGroup: (g: ListGroup) => void
  setSpace: (s: string | null) => void
  setProject: (id: string | null) => void
  setMyTasksOnly: (v: boolean) => void
  setHideCompleted: (v: boolean) => void
  setFilters: (f: Partial<Filters>) => void
  resetFilters: () => void
  setDetailTaskId: (id: string | null) => void
  openTaskDetail: (id: string) => void
  closeTaskDetail: () => void
  openTaskModal: (editId?: string, parentId?: string, milestoneId?: string, projectId?: string) => void
  closeTaskModal: () => void
  setColorSettings: (open: boolean) => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  setSidebarOpen: (v: boolean) => void
  toggleSidebar: () => void
  setCalRange: (r: CalRange) => void
  setCalAnchor: (date: string) => void
}

const LIST_GROUP_KEY = 'cringe_list_group_v1'
const LIST_GROUPS: ListGroup[] = ['project', 'none', 'due', 'priority', 'assignee', 'status', 'tag']

function loadListGroup(): ListGroup {
  try {
    const v = localStorage.getItem(LIST_GROUP_KEY)
    if (v && (LIST_GROUPS as string[]).includes(v)) return v as ListGroup
  } catch { /* ignore */ }
  return 'project'
}

const now = new Date()

const defaultFilters: Filters = {
  assignees: [],
  statuses: [],
  tags: [],
  projects: [],
  search: '',
  sort: 'due_asc',
}

export const useUiStore = create<UiState>((set, get) => ({
  view: 't',
  listGroup: loadListGroup(),
  space: null,
  projectId: null,
  // The day starts with what is mine. Opening on 전체 업무 meant everybody's
  // first sight of the app was fifty people's work, and the first click of every
  // morning was the same one.
  myTasksOnly: true,
  hideCompleted: false,
  filters: { ...defaultFilters },
  // 아침에 여는 화면. 내 할 일은 재고이고, 오늘은 계획입니다.
  screen: 'today',
  noteDate: null,
  detailTaskId: null,
  editTaskId: null,
  newTaskParentId: null,
  newTaskMilestoneId: null,
  newTaskProjectId: null,
  isTaskModalOpen: false,
  isFilterPanelOpen: false,
  isColorSettingsOpen: false,
  isCommandPaletteOpen: false,
  sidebarOpen: false,
  calRange: 7,
  calAnchor: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,

  setView: (view) => set({ view }),
  setListGroup: (listGroup) => {
    try { localStorage.setItem(LIST_GROUP_KEY, listGroup) } catch { /* ignore */ }
    set({ listGroup })
  },
  setSpace: (space) => set({ space, projectId: null, screen: 'work' }),
  // Entering a project makes the project filter meaningless at best and
  // self-contradicting at worst — filtering to project B while inside project A
  // can only ever return nothing. Same for 내 할 일 and the assignee filter.
  // Dropping the conflicting selection here means no caller can produce the
  // contradiction, and the bar has nothing incoherent left to render.
  // 업무를 고르는 모든 길은 업무 화면으로 데려갑니다. 오늘에 서서 프로젝트를
  // 눌렀는데 아무 일도 안 일어나면 그 줄은 고장 난 것으로 보입니다.
  setProject: (projectId) => set(st => ({
    projectId, space: null, screen: 'work',
    filters: projectId ? { ...st.filters, projects: [] } : st.filters,
  })),
  setMyTasksOnly: (myTasksOnly) => set(st => ({
    myTasksOnly, screen: 'work',
    filters: myTasksOnly ? { ...st.filters, assignees: [] } : st.filters,
  })),
  // 완료 숨기기 and a 완료 status filter are a guaranteed empty list. The
  // toggle the user just pressed wins.
  setHideCompleted: (hideCompleted) => set(st => ({
    hideCompleted,
    filters: hideCompleted
      ? { ...st.filters, statuses: st.filters.statuses.filter(s => s !== '완료') }
      : st.filters,
  })),
  setFilters: (f) => set(s => ({ filters: { ...s.filters, ...f } })),
  resetFilters: () => set(st => ({ filters: { ...defaultFilters, sort: st.filters.sort } })),
  setScreen: (screen) => set({ screen }),
  openNote: (noteDate) => set({ noteDate, screen: 'today' }),
  setDetailTaskId: (id) => set({ detailTaskId: id }),
  openTaskDetail: (id: string) => set({ detailTaskId: id }),
  closeTaskDetail: () => set({ detailTaskId: null }),
  openTaskModal: (editId, parentId, milestoneId, projectId) => set({ isTaskModalOpen: true, editTaskId: editId ?? null, newTaskParentId: parentId ?? null, newTaskMilestoneId: milestoneId ?? null, newTaskProjectId: projectId ?? null }),
  closeTaskModal: () => set({ isTaskModalOpen: false, editTaskId: null, newTaskParentId: null, newTaskMilestoneId: null, newTaskProjectId: null }),
  setColorSettings: (open) => set({ isColorSettingsOpen: open }),
  openCommandPalette: () => set({ isCommandPaletteOpen: true }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
  setCalRange: (calRange) => set({ calRange }),
  setCalAnchor: (calAnchor) => set({ calAnchor }),
}))
