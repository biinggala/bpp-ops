import { create } from 'zustand'
import type { ViewType, Status, CalRange } from '../types'

const HIDDEN_KEY = 'sidebar_hidden'

function loadSidebarHidden(): boolean {
  try { return localStorage.getItem(HIDDEN_KEY) === '1' } catch { return false }
}

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
  /**
   * 프로젝트에 속하지 않은 업무만.
   *
   * 이런 업무는 `personalTasks/{내 계정}`에 살고 **아무도 못 봅니다** — 공유될
   * 경로 자체가 없습니다. 그래서 목록에 섞여 있으면 '이건 나만 아는 일'이라는
   * 사실이 화면에서 사라집니다. 따로 세워 두면 그 줄에 선 것만으로 그 뜻이
   * 됩니다.
   *
   * 프로젝트 선택과 배타입니다 — 프로젝트를 고르면 꺼집니다. '프로젝트 없음'과
   * '이 프로젝트'는 같이 참일 수 없습니다.
   */
  personalOnly: boolean
  hideCompleted: boolean        // hide tasks with status === '완료'
  filters: Filters
  /**
   * 지금 보고 있는 게 '오늘'인가, 업무 화면인가.
   *
   * 뷰 탭(리스트·보드·캘린더…)은 *한 프로젝트의 업무를 보는 방법들*이라 오늘이
   * 낄 자리가 아닙니다. 오늘은 프로젝트에 속하지도, 남과 공유되지도 않습니다.
   * 그래서 한 층 위에 둡니다.
   */
  screen: 'today' | 'work' | 'calendar'
  setScreen: (s: 'today' | 'work' | 'calendar') => void
  /**
   * 캘린더를 '뷰'가 아니라 '가는 곳'으로 여는 문.
   *
   * 뷰 탭의 캘린더는 *이 프로젝트의* 마감을 그립니다. 하지만 사람들이 하루에도
   * 몇 번씩 열고 싶은 캘린더는 그게 아니라 **내 일정 전부**입니다. 그걸 보려면
   * 지금은 아무 업무 목록에 들어가서 → 범위를 전체로 바꾸고 → 캘린더 탭을
   * 눌러야 합니다. 자주 가는 곳으로 가는 길로는 너무 깁니다.
   *
   * 그래서 범위를 걷어내고 한 층 위로 올립니다. 여기 서 있는 동안은 프로젝트도
   * 담당자도 걸려 있지 않아서, 보이는 것이 곧 '내 앞의 전부'입니다.
   */
  openCalendar: () => void
  /** 오늘 화면이 펼쳐 놓은 날짜. null이면 진짜 오늘입니다. */
  noteDate: string | null
  openNote: (date: string | null) => void
  detailTaskId: string | null
  editTaskId: string | null
  newTaskParentId: string | null
  newTaskMilestoneId: string | null
  newTaskProjectId: string | null
  /**
   * 미리 채워 둘 마감일. 캘린더에서 **날짜를 눌러** 열었을 때만 있습니다.
   *
   * 이 값이 있다는 건 '이 날에 무언가를 놓으려 한다'는 뜻이라, 창이 마감일을
   * 채워 둘 뿐 아니라 **날짜 없는 업무 목록**도 같이 보여줍니다. 만들 것이
   * 이미 있을 수도 있으니까요.
   */
  newTaskDue: string | null
  isTaskModalOpen: boolean
  isFilterPanelOpen: boolean
  isColorSettingsOpen: boolean
  isCommandPaletteOpen: boolean
  sidebarOpen: boolean
  /**
   * 넓은 화면에서 사이드바를 접어 뒀는가.
   *
   * `sidebarOpen`과 따로입니다. 폰에서 그건 '서랍이 열려 있다'는 뜻이고 기본이
   * 닫힘인데, 넓은 화면에서 사이드바의 기본은 **보이는 것**입니다. 같은 값에
   * 두 뜻을 담으면 앱을 켤 때마다 노트북에서 사이드바가 사라져 있게 됩니다.
   *
   * 이 기기에만 남습니다. 50명이 같은 값을 놓고 다투게 할 일이 아닙니다 —
   * 사이드바 폭과 같은 줄입니다.
   */
  sidebarHidden: boolean
  /** Calendar: how much is shown at once, and the date it starts from. */
  calRange: CalRange
  calAnchor: string

  setView: (v: ViewType) => void
  setListGroup: (g: ListGroup) => void
  setSpace: (s: string | null) => void
  setProject: (id: string | null) => void
  setPersonalOnly: (v: boolean) => void
  setMyTasksOnly: (v: boolean) => void
  setHideCompleted: (v: boolean) => void
  setFilters: (f: Partial<Filters>) => void
  resetFilters: () => void
  setDetailTaskId: (id: string | null) => void
  openTaskDetail: (id: string) => void
  closeTaskDetail: () => void
  /**
   * 새 업무 창을 엽니다.
   *
   * 인자를 객체로 받습니다. 자리로 받던 때는 `openTaskModal(undefined, undefined,
   * m?.id, undefined)` 같은 호출이 나왔는데, undefined 세 개를 세어 가며 읽어야
   * 하는 코드는 다음 인자가 붙는 순간 틀립니다.
   */
  openTaskModal: (opts?: { editId?: string; parentId?: string; milestoneId?: string; projectId?: string; due?: string }) => void
  closeTaskModal: () => void
  setColorSettings: (open: boolean) => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  setSidebarOpen: (v: boolean) => void
  toggleSidebar: () => void
  toggleSidebarHidden: () => void
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
  personalOnly: false,
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
  newTaskDue: null,
  isTaskModalOpen: false,
  isFilterPanelOpen: false,
  isColorSettingsOpen: false,
  isCommandPaletteOpen: false,
  sidebarOpen: false,
  sidebarHidden: loadSidebarHidden(),
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
    // 프로젝트를 고르면 '개인'은 꺼집니다 — 둘은 같이 참일 수 없습니다.
    personalOnly: false,
    filters: projectId ? { ...st.filters, projects: [] } : st.filters,
  })),
  setPersonalOnly: (personalOnly) => set(st => ({
    personalOnly, screen: 'work',
    ...(personalOnly ? { projectId: null, space: null } : {}),
    filters: personalOnly ? { ...st.filters, projects: [] } : st.filters,
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
  openCalendar: () => set(st => ({
    screen: 'calendar',
    // 범위를 지우고 들어갑니다 — '전체 일정'이라 해 놓고 지난번에 보던
    // 프로젝트만 그려 주면 그건 다른 화면입니다.
    projectId: null, space: null, myTasksOnly: false, personalOnly: false,
    filters: { ...st.filters, projects: [], assignees: [] },
  })),
  openNote: (noteDate) => set({ noteDate, screen: 'today' }),
  setDetailTaskId: (id) => set({ detailTaskId: id }),
  openTaskDetail: (id: string) => set({ detailTaskId: id }),
  closeTaskDetail: () => set({ detailTaskId: null }),
  openTaskModal: (opts) => set({
    isTaskModalOpen: true,
    editTaskId: opts?.editId ?? null,
    newTaskParentId: opts?.parentId ?? null,
    newTaskMilestoneId: opts?.milestoneId ?? null,
    newTaskProjectId: opts?.projectId ?? null,
    newTaskDue: opts?.due ?? null,
  }),
  closeTaskModal: () => set({ isTaskModalOpen: false, editTaskId: null, newTaskParentId: null, newTaskMilestoneId: null, newTaskProjectId: null, newTaskDue: null }),
  setColorSettings: (open) => set({ isColorSettingsOpen: open }),
  openCommandPalette: () => set({ isCommandPaletteOpen: true }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
  toggleSidebarHidden: () => set(s => {
    const sidebarHidden = !s.sidebarHidden
    try { localStorage.setItem(HIDDEN_KEY, sidebarHidden ? '1' : '0') } catch { /* private mode */ }
    return { sidebarHidden }
  }),
  setCalRange: (calRange) => set({ calRange }),
  setCalAnchor: (calAnchor) => set({ calAnchor }),
}))
