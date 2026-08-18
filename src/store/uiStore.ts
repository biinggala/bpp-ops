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
export type ListGroup = 'project' | 'none' | 'due' | 'priority' | 'assignee' | 'status'

interface UiState {
  view: ViewType
  listGroup: ListGroup
  space: string | null
  projectId: string | null      // sidebar project filter
  myTasksOnly: boolean          // quick filter: my tasks
  hideCompleted: boolean        // hide tasks with status === '완료'
  filters: Filters
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
  showGCal: boolean

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
  setShowGCal: (v: boolean) => void
  setCalRange: (r: CalRange) => void
  setCalAnchor: (date: string) => void
}

const LIST_GROUP_KEY = 'cringe_list_group_v1'
const LIST_GROUPS: ListGroup[] = ['project', 'none', 'due', 'priority', 'assignee', 'status']

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
  myTasksOnly: false,
  hideCompleted: false,
  filters: { ...defaultFilters },
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
  showGCal: true,

  setView: (view) => set({ view }),
  setListGroup: (listGroup) => {
    try { localStorage.setItem(LIST_GROUP_KEY, listGroup) } catch { /* ignore */ }
    set({ listGroup })
  },
  setSpace: (space) => set({ space, projectId: null }),
  setProject: (projectId) => set({ projectId, space: null }),
  setMyTasksOnly: (myTasksOnly) => set({ myTasksOnly }),
  setHideCompleted: (hideCompleted) => set({ hideCompleted }),
  setFilters: (f) => set(s => ({ filters: { ...s.filters, ...f } })),
  resetFilters: () => set({ filters: { ...defaultFilters } }),
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
  setShowGCal: (showGCal) => set({ showGCal }),
  setCalRange: (calRange) => set({ calRange }),
  setCalAnchor: (calAnchor) => set({ calAnchor }),
}))
