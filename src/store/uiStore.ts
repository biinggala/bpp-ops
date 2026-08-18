import { create } from 'zustand'
import type { ViewType, Status, CalRange } from '../types'

interface Filters {
  assignees: string[]
  statuses: Status[]
  tags: string[]
  projects: string[]
  search: string
  sort: 'due_asc' | 'due_desc' | 'default'
}

interface UiState {
  view: ViewType
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
