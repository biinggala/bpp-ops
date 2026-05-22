import { create } from 'zustand'
import type { ViewType, Category, Status, MemberKey } from '../types'

interface Filters {
  categories: Category[]
  assignees: MemberKey[]
  statuses: Status[]
  search: string
  sort: 'due_asc' | 'due_desc' | 'default'
}

interface UiState {
  view: ViewType
  space: Category | null          // null = 전체
  filters: Filters
  detailTaskId: string | null
  editTaskId: string | null
  isTaskModalOpen: boolean
  isFilterPanelOpen: boolean
  isColorSettingsOpen: boolean
  calYear: number
  calMonth: number                // 0-indexed

  setView: (v: ViewType) => void
  setSpace: (s: Category | null) => void
  setFilters: (f: Partial<Filters>) => void
  resetFilters: () => void
  setDetailTaskId: (id: string | null) => void
  setEditTaskId: (id: string | null) => void
  openTaskModal: (editId?: string) => void
  closeTaskModal: () => void
  setFilterPanel: (open: boolean) => void
  setColorSettings: (open: boolean) => void
  calNav: (delta: number) => void
  calToday: () => void
}

const now = new Date()

const defaultFilters: Filters = {
  categories: [],
  assignees: [],
  statuses: [],
  search: '',
  sort: 'due_asc',
}

export const useUiStore = create<UiState>((set, get) => ({
  view: 't',
  space: null,
  filters: { ...defaultFilters },
  detailTaskId: null,
  editTaskId: null,
  isTaskModalOpen: false,
  isFilterPanelOpen: false,
  isColorSettingsOpen: false,
  calYear: now.getFullYear(),
  calMonth: now.getMonth(),

  setView: (view) => set({ view }),
  setSpace: (space) => set({ space }),
  setFilters: (f) => set(s => ({ filters: { ...s.filters, ...f } })),
  resetFilters: () => set({ filters: { ...defaultFilters } }),
  setDetailTaskId: (id) => set({ detailTaskId: id }),
  setEditTaskId: (id) => set({ editTaskId: id }),
  openTaskModal: (editId) => set({ isTaskModalOpen: true, editTaskId: editId ?? null }),
  closeTaskModal: () => set({ isTaskModalOpen: false, editTaskId: null }),
  setFilterPanel: (open) => set({ isFilterPanelOpen: open }),
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
