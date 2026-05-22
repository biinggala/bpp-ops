import { create } from 'zustand'
import type { ViewType, Status, MemberKey } from '../types'

interface Filters {
  assignees: MemberKey[]
  statuses: Status[]
  search: string
  sort: 'due_asc' | 'due_desc' | 'default'
}

interface UiState {
  view: ViewType
  space: string | null
  projectId: string | null      // sidebar project filter
  myTasksOnly: boolean          // quick filter: my tasks
  filters: Filters
  detailTaskId: string | null
  editTaskId: string | null
  newTaskParentId: string | null
  isTaskModalOpen: boolean
  isFilterPanelOpen: boolean
  isColorSettingsOpen: boolean
  calYear: number
  calMonth: number

  setView: (v: ViewType) => void
  setSpace: (s: string | null) => void
  setProject: (id: string | null) => void
  setMyTasksOnly: (v: boolean) => void
  setFilters: (f: Partial<Filters>) => void
  resetFilters: () => void
  setDetailTaskId: (id: string | null) => void
  openTaskModal: (editId?: string, parentId?: string) => void
  closeTaskModal: () => void
  setColorSettings: (open: boolean) => void
  calNav: (delta: number) => void
  calToday: () => void
}

const now = new Date()

const defaultFilters: Filters = {
  assignees: [],
  statuses: [],
  search: '',
  sort: 'due_asc',
}

export const useUiStore = create<UiState>((set, get) => ({
  view: 't',
  space: null,
  projectId: null,
  myTasksOnly: false,
  filters: { ...defaultFilters },
  detailTaskId: null,
  editTaskId: null,
  newTaskParentId: null,
  isTaskModalOpen: false,
  isFilterPanelOpen: false,
  isColorSettingsOpen: false,
  calYear: now.getFullYear(),
  calMonth: now.getMonth(),

  setView: (view) => set({ view }),
  setSpace: (space) => set({ space, projectId: null }),
  setProject: (projectId) => set({ projectId, space: null }),
  setMyTasksOnly: (myTasksOnly) => set({ myTasksOnly }),
  setFilters: (f) => set(s => ({ filters: { ...s.filters, ...f } })),
  resetFilters: () => set({ filters: { ...defaultFilters } }),
  setDetailTaskId: (id) => set({ detailTaskId: id }),
  openTaskModal: (editId, parentId) => set({ isTaskModalOpen: true, editTaskId: editId ?? null, newTaskParentId: parentId ?? null }),
  closeTaskModal: () => set({ isTaskModalOpen: false, editTaskId: null, newTaskParentId: null }),
  setColorSettings: (open) => set({ isColorSettingsOpen: open }),
  calNav: (delta) => {
    const { calYear, calMonth } = get()
    const d = new Date(calYear, calMonth + delta, 1)
    set({ calYear: d.getFullYear(), calMonth: d.getMonth() })
  },
  calToday: () => {
    const n = new Date()
    set({ calYear: n.getFullYear(), calMonth: n.getMonth() })
  },
}))
