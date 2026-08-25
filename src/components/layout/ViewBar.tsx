import React from 'react'
import { authorizedEmails, isAuthorizedAssignee, assigneeKeyToEmail, parseAssignees } from '../../lib/utils'
import { useUiStore } from '../../store/uiStore'
import { useProjectStore } from '../../store/projectStore'
import { useUserProfileStore } from '../../store/userProfileStore'
import { useAuthStore } from '../../store/authStore'
import { useScopedTasks } from '../../hooks/useScopedTasks'
import { useMobile } from '../../hooks/useMobile'
import { haptic } from '../../lib/haptics'
import { NavIcon } from './NavIcons'
import { STATUS_COLORS } from '../../types'
import type { ViewType, Status } from '../../types'
import { STATUS_LIST } from '../../types'
import { Icon } from '../shared/Icon'
import { useShallow } from 'zustand/react/shallow'

/**
 * 뷰 탭. 묶음 단위로 적습니다 — 사이의 세로선이 곧 이 묶음의 경계라,
 * 인덱스로 선을 그리면 탭 하나가 빠질 때마다 선이 엉뚱한 데로 갑니다.
 *
 * 보드는 뺐습니다. 코드는 남아 있고(`view === 'b'`로 열리면 그려집니다) 탭에서만
 * 내렸습니다 — 리스트가 하던 일과 겹쳐서, 쓰이지 않는 탭 하나가 나머지 다섯의
 * 자리를 좁히고 있었습니다.
 *
 * The icon each of these is drawn with lives in NavIcons, keyed by the same id.
 */
const VIEW_GROUPS: { id: ViewType; label: string }[][] = [
  [{ id: 't', label: '리스트' }, { id: 'c', label: '캘린더' }],
  [{ id: 'g', label: '간트' }],
  [{ id: 's', label: '통계' }, { id: 'f', label: '자료' }],
]

const VIEWS = VIEW_GROUPS.flat()

/**
 * What the phone gets. Fewer, on purpose.
 *
 * 통계 wants a wide canvas — a thing people open at a desk. Tabs across 390pt
 * leave each one a thumb-width with no room for its label, so the one that is
 * worst on a phone gives up its slot to make the others legible. Nothing is
 * lost — the desktop bar still has it, and a link into it still opens.
 */
const MOBILE_VIEWS = VIEWS.filter(v => v.id !== 's')

const SORT_OPTIONS = [
  { value: 'due_asc' as const, label: '마감 가까운 순' },
  { value: 'due_desc' as const, label: '마감 먼 순' },
  { value: 'priority_desc' as const, label: '우선순위 순' },
  { value: 'name_asc' as const, label: '이름 순' },
  { value: 'default' as const, label: '기본 순서' },
]

const GROUP_OPTIONS = [
  { value: 'project' as const, label: '프로젝트' },
  { value: 'none' as const, label: '없음' },
  { value: 'due' as const, label: '마감일' },
  { value: 'priority' as const, label: '우선순위' },
  { value: 'assignee' as const, label: '담당자' },
  { value: 'status' as const, label: '상태' },
  { value: 'tag' as const, label: '태그' },
]

/**
 * `filtersOnly`는 캘린더 화면이 쓰는 모드입니다.
 *
 * 거기서는 뷰 탭이 틀립니다 — 캘린더 화면은 뷰가 아니라 장소라, 탭을 두면
 * 자기가 서 있는 곳에서 나가는 문이 됩니다. 하지만 거르개는 오히려 거기가 더
 * 필요합니다: 한 달치 달력 위에 볼 수 있는 모든 마감이 쏟아지면 아무것도 안
 * 보이는 것과 같습니다.
 *
 * 그래서 같은 바의 오른쪽 절반만 씁니다. 새 필터 UI를 하나 더 만들지 않는
 * 편이 낫습니다 — 프로젝트·담당자·상태·태그를 고르는 법이 앱 안에 두 가지가
 * 되면 둘 다 반쯤만 익히게 됩니다.
 */
export function ViewBar({ filtersOnly = false }: { filtersOnly?: boolean }) {
  const {
    view, setView, filters, setFilters, resetFilters,
    hideCompleted, setHideCompleted,
    listGroup, setListGroup, myTasksOnly, setMyTasksOnly, personalOnly, projectId,
  } = useUiStore(useShallow(s => ({ view: s.view, setView: s.setView, filters: s.filters, setFilters: s.setFilters, resetFilters: s.resetFilters, hideCompleted: s.hideCompleted, setHideCompleted: s.setHideCompleted, listGroup: s.listGroup, setListGroup: s.setListGroup, myTasksOnly: s.myTasksOnly, setMyTasksOnly: s.setMyTasksOnly, personalOnly: s.personalOnly, projectId: s.projectId })))
  const isMobile = useMobile()
  // Options come from the current scope, not from everything the user can see:
  // a menu that offers values which cannot appear in this view is a menu of
  // ways to get an empty list.
  const scopedTasks = useScopedTasks()
  const projects = useProjectStore(s => s.projects)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const email = useAuthStore(s => s.email)

  const accessibleProjects = React.useMemo(() =>
    projects.filter(p => !p.archived)
  , [projects])

  const allTagOptions = React.useMemo(() => {
    const s = new Set<string>()
    scopedTasks.forEach(t => t.tags?.forEach(tag => s.add(tag)))
    return Array.from(s).sort()
  }, [scopedTasks])

  // Assignee options — restricted to participants with project access, keyed by
  // canonical email so each person appears once.
  const allAssigneeOptions = React.useMemo(() => {
    const authorized = authorizedEmails(accessibleProjects, email)
    const emails = new Set<string>()
    scopedTasks.forEach(t => {
      parseAssignees(t.assignee).forEach(k => {
        if (isAuthorizedAssignee(k, authorized)) emails.add(assigneeKeyToEmail(k))
      })
    })
    // Members of the project in view are offered even with nothing assigned yet;
    // across all projects that list would be everyone, which is noise.
    if (projectId) {
      projects.find(p => p.id === projectId)?.memberEmails?.forEach(e => emails.add(e.toLowerCase()))
    }
    // 이름은 그 사람이 로그인할 때 스스로 써 둔 프로필에서 옵니다.
    return Array.from(emails).sort().map(em => ({ value: em, label: getNameByEmail(em) }))
  }, [scopedTasks, accessibleProjects, projects, projectId, email, getNameByEmail])

  const allProjectOptions = React.useMemo(() =>
    accessibleProjects.map(p => ({ value: p.id, label: p.name }))
  , [accessibleProjects])

  // Status options drop 완료 while it is being hidden — offering a value that
  // another active control guarantees will match nothing is a trap.
  const statusOptions = React.useMemo(() =>
    STATUS_LIST.filter(s => !(hideCompleted && s === '완료')).map(s => ({ value: s, label: s }))
  , [hideCompleted])

  // Which filters can coherently exist here. A 담당자 filter inside 내 할 일
  // says nothing — every task is already mine. A 프로젝트 filter inside one
  // project can only ever subtract everything.
  const showProjectFilter = !projectId && allProjectOptions.length > 1
  const showAssigneeFilter = !myTasksOnly && allAssigneeOptions.length > 0
  const showTagFilter = allTagOptions.length > 0

  // Sorting only means anything where rows are listed; grouping is a property of
  // the list layout specifically (the board already groups by status, the
  // calendar by date); the calendar toggle only where calendar entries are drawn.
  const showSort = !filtersOnly && (view === 't' || view === 'b')
  const showGroup = !filtersOnly && view === 't'
  // The files view answers a different question and has its own search box: a
  // status or assignee filter has nothing to say about a 계약서.
  const showFilters = filtersOnly || view !== 'f'

  /**
   * 통계는 전체 업무와 프로젝트에만 답이 있습니다.
   *
   * 이 화면의 절반은 '담당자별 현황'입니다. 내 할 일과 개인에서는 담당자가
   * 나 하나라 막대가 하나뿐인 차트가 되고, 나머지 숫자들은 위의 목록을 세어
   * 다시 쓴 것에 가깝습니다. 답이 정해진 질문을 위해 탭을 하나 내주지 않습니다.
   */
  const showStats = !myTasksOnly && !personalOnly

  // 통계에 서 있는데 범위가 내 할 일로 바뀌면 탭이 사라집니다 — 아무 탭도
  // 켜지지 않은 화면에 남기지 않고 리스트로 데려옵니다.
  React.useEffect(() => {
    if (view === 's' && !showStats) setView('t')
  }, [view, showStats, setView])

  const groups = React.useMemo(
    () => VIEW_GROUPS
      .map(g => g.filter(v => v.id !== 's' || showStats))
      .filter(g => g.length > 0),
    [showStats],
  )

  // ── Active filters, as chips ────────────────────────────────────────────────
  // Everything narrowing the view gets a chip, including 검색 (set from the
  // sidebar) and 완료 숨기기. Previously those two could be on with nothing in
  // this bar admitting it, which made the result look wrong rather than filtered.
  const projectName = (id: string) => projects.find(p => p.id === id)?.name ?? id
  const projectColor = (id: string) => projects.find(p => p.id === id)?.color

  const chips: Chip[] = []
  if (filters.projects.length) chips.push({
    key: 'projects', label: '프로젝트',
    values: filters.projects.map(id => ({ text: projectName(id), dot: projectColor(id) })),
    onClear: () => setFilters({ projects: [] }),
  })
  if (filters.assignees.length) chips.push({
    key: 'assignees', label: '담당자',
    values: filters.assignees.map(e => ({ text: getNameByEmail(e) })),
    onClear: () => setFilters({ assignees: [] }),
  })
  if (filters.statuses.length) chips.push({
    key: 'statuses', label: '상태',
    values: filters.statuses.map(s => ({ text: s, dot: STATUS_COLORS[s]?.text })),
    onClear: () => setFilters({ statuses: [] }),
  })
  if (filters.tags.length) chips.push({
    key: 'tags', label: '태그',
    values: filters.tags.map(t => ({ text: `#${t}` })),
    onClear: () => setFilters({ tags: [] }),
  })
  if (filters.search.trim()) chips.push({
    key: 'search', label: '검색',
    values: [{ text: `"${filters.search.trim()}"` }],
    onClear: () => setFilters({ search: '' }),
  })
  if (hideCompleted) chips.push({
    key: 'hideCompleted', label: '',
    values: [{ text: '완료 숨김' }],
    onClear: () => setHideCompleted(false),
  })

  // Mobile: in-flow bottom tab bar (rendered as the last flex child in AppPage).
  // Deliberately NOT position:fixed — iOS standalone PWAs mis-anchor fixed
  // bottom elements, leaving a gap below; in-flow is always at the true bottom.
  if (isMobile) return <BottomNav view={view} onPick={v => { haptic('tap'); setView(v) }} />

  return (
    <div style={{ background: 'var(--bg)', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
      <div style={{
        height: 44, padding: '0 20px',
        display: 'flex', alignItems: 'center', gap: 2, overflowX: 'auto',
      }}>
        {!filtersOnly && groups.map((g, gi) => (
          <React.Fragment key={g[0].id}>
            {gi > 0 && <Divider />}
            {g.map(v => (
              <ViewTab key={v.id} view={v.id} active={view === v.id} onClick={() => setView(v.id)}>
                {v.label}
              </ViewTab>
            ))}
          </React.Fragment>
        ))}

        {/* 캘린더 화면의 기본은 '내 것'입니다. 넓히는 스위치는 켜져 있는
            모습으로 여기 서 있어야 합니다 — 안 그러면 남의 일정이 안 보이는
            게 설정이 아니라 고장으로 읽힙니다. 업무 화면에서는 이걸 사이드바가
            정하므로 나타나지 않습니다. */}
        {filtersOnly && (
          <Toggle active={myTasksOnly} onClick={() => setMyTasksOnly(!myTasksOnly)}>
            내 업무만
          </Toggle>
        )}

        {showFilters && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {showProjectFilter && (
            <MultiSelect label="프로젝트" options={allProjectOptions}
              selected={filters.projects} onChange={v => setFilters({ projects: v })} />
          )}
          {showAssigneeFilter && (
            <MultiSelect label="담당자" options={allAssigneeOptions}
              selected={filters.assignees} onChange={v => setFilters({ assignees: v })} />
          )}
          <MultiSelect label="상태" options={statusOptions}
            selected={filters.statuses} onChange={v => setFilters({ statuses: v as Status[] })} />
          {showTagFilter && (
            <MultiSelect label="태그" options={allTagOptions.map(t => ({ value: t, label: `#${t}` }))}
              selected={filters.tags} onChange={v => setFilters({ tags: v })} />
          )}

          <Toggle active={hideCompleted} onClick={() => setHideCompleted(!hideCompleted)}>
            완료 숨기기
          </Toggle>

          {(showGroup || showSort) && <Divider />}
          {showGroup && (
            <SingleSelect prefix="그룹" options={GROUP_OPTIONS} value={listGroup} onChange={setListGroup} />
          )}
          {showSort && (
            <SingleSelect prefix="정렬" options={SORT_OPTIONS} value={filters.sort}
              onChange={v => setFilters({ sort: v })} />
          )}
        </div>
        )}
      </div>

      {/* What is currently narrowing the view, spelled out. The dropdowns say
          how many are selected; only this says which, and it is the one place
          every active filter — including ones set elsewhere in the app — shows
          up together with a way to undo it. */}
      {showFilters && chips.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 20px', borderTop: '1px solid var(--bd)',
          background: 'var(--bg2)', overflowX: 'auto',
        }}>
          {chips.map(c => <FilterChip key={c.key} chip={c} />)}
          <button
            onClick={() => { resetFilters(); setHideCompleted(false) }}
            style={{
              marginLeft: 4, padding: '3px 6px', fontSize: 12,
              border: 'none', background: 'transparent', color: 'var(--t3)',
              cursor: 'pointer', fontFamily: 'var(--font)', whiteSpace: 'nowrap',
              borderRadius: 'var(--r1)', flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--ac)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)' }}
          >
            모두 해제
          </button>
        </div>
      )}
    </div>
  )
}

// ── Filter chips ──────────────────────────────────────────────────────────────

type Chip = {
  key: string
  /** Field name, omitted for chips that already read as a full sentence. */
  label: string
  values: { text: string; dot?: string }[]
  onClear: () => void
}

/** Two values, then a count. Past that a chip is longer than it is useful. */
const CHIP_VALUE_LIMIT = 2

function FilterChip({ chip }: { chip: Chip }) {
  const shown = chip.values.slice(0, CHIP_VALUE_LIMIT)
  const rest = chip.values.length - shown.length
  return (
    <span
      title={chip.values.map(v => v.text).join(', ')}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 4px 3px 9px', borderRadius: 999,
        background: 'var(--bg)', border: '1px solid var(--bd2)',
        fontSize: 12, color: 'var(--t1)', whiteSpace: 'nowrap', flexShrink: 0,
        maxWidth: 260,
      }}
    >
      {chip.label && <span style={{ color: 'var(--t3)' }}>{chip.label}</span>}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {shown.map((v, i) => (
          <React.Fragment key={v.text}>
            {i > 0 && <span style={{ color: 'var(--t3)' }}>,</span>}
            {v.dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: v.dot, flexShrink: 0 }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.text}</span>
          </React.Fragment>
        ))}
        {rest > 0 && <span style={{ color: 'var(--t3)' }}>+{rest}</span>}
      </span>
      <button
        onClick={chip.onClear}
        aria-label={`${chip.label || chip.values[0]?.text} 해제`}
        style={{
          width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', background: 'transparent', borderRadius: '50%',
          color: 'var(--t3)', fontSize: 11, cursor: 'pointer', flexShrink: 0,
          fontFamily: 'var(--font)', padding: 0, lineHeight: 1,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg4)'; e.currentTarget.style.color = 'var(--t1)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
      >
        ✕
      </button>
    </span>
  )
}

// ── Controls ──────────────────────────────────────────────────────────────────

/**
 * Selected is a filled rounded rectangle, not an underline.
 *
 * The app had two ways of saying "this one": a blue rule under the view tabs,
 * and a soft filled rectangle behind the sidebar's current item. Two marks for
 * one idea, and the underline was the weaker of them — a hairline that reads as
 * a shadow at a glance and disappears entirely on a laptop in daylight.
 *
 * The rectangle wins because it is already what the sidebar, the phone's bottom
 * bar and every menu row use. One shape, everywhere.
 */
/**
 * ── 이름 앞에 그 화면의 그림 ─────────────────────────────────────────────────
 *
 * 폰의 아래 바는 처음부터 그림으로 서 있었는데(NavIcons) 이 탭들은 글자만
 * 있었습니다. 같은 다섯 가지를 화면마다 다른 방식으로 고르고 있던 셈이고,
 * 사이드바의 '오늘'과 '캘린더'도 그림을 달고 있으니 여기만 맨몸이었습니다.
 *
 * **폰의 그 그림 그대로**입니다 — 리스트는 줄, 캘린더는 한 달, 간트는 계단
 * 모양 막대. 새로 그리지 않았습니다: 같은 화면을 가리키는 그림이 둘이면
 * 그건 두 가지를 배우는 것입니다.
 *
 * 켜진 탭에서 선이 한 겹 두꺼워집니다. 선택을 색 하나에만 맡기지 않으려는
 * 것이고, 아래 바가 이미 그렇게 하고 있습니다.
 */
function ViewTab({ children, view, active, onClick }: {
  children: React.ReactNode; view: ViewType; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px',
        borderRadius: 'var(--r2)', fontSize: 14, fontWeight: active ? 500 : 400,
        cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
        background: active ? 'var(--bg3)' : 'transparent',
        fontFamily: 'var(--font)',
        color: active ? 'var(--t1)' : 'var(--t2)',
        transition: 'background .1s, color .1s',
      }}
      onMouseEnter={e => { if (!active) { e.currentTarget.style.color = 'var(--t1)'; e.currentTarget.style.background = 'var(--bg3)' } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.color = 'var(--t2)'; e.currentTarget.style.background = 'transparent' } }}
    >
      <span style={{ display: 'flex', opacity: active ? 1 : .75 }}>
        <NavIcon view={view} size={15} active={active} />
      </span>
      {children}
    </button>
  )
}

function Divider() {
  return <div style={{ width: 1, height: 16, background: 'var(--bd)', margin: '0 4px', flexShrink: 0 }} />
}

function Toggle({ children, active, onClick }: {
  children: React.ReactNode; active: boolean; onClick: () => void
}) {
  const c = 'var(--ac)'
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '4px 10px', borderRadius: 'var(--r1)',
        border: `1px solid ${active ? c : 'var(--bd)'}`,
        background: active ? 'var(--ac-l)' : 'transparent',
        color: active ? c : 'var(--t2)',
        fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font)', whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}

/** Shared open/close + fixed positioning for both menus below. */
function useMenu() {
  const [open, setOpen] = React.useState(false)
  const [pos, setPos] = React.useState({ top: 0, left: 0 })
  const ref = React.useRef<HTMLDivElement>(null)
  const btnRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      // Right-aligned: these sit at the right edge of the bar, so anchoring the
      // menu's left edge to the button pushes wide menus off-screen.
      setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 180) })
    }
    setOpen(o => !o)
  }

  return { open, setOpen, pos, ref, btnRef, toggle }
}

const MENU_STYLE: React.CSSProperties = {
  position: 'fixed',
  background: 'var(--bg)', border: '1px solid var(--bd)',
  borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)',
  zIndex: 9000, width: 180, padding: '4px 0',
}

function SingleSelect<T extends string>({ prefix, options, value, onChange }: {
  prefix: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  const { open, setOpen, pos, ref, btnRef, toggle } = useMenu()
  const current = options.find(o => o.value === value)

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }}>
      <button
        ref={btnRef}
        onClick={toggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 10px', borderRadius: 'var(--r1)',
          border: '1px solid var(--bd)', background: 'transparent',
          color: 'var(--t2)', fontSize: 13, cursor: 'pointer',
          fontFamily: 'var(--font)', whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--bd2)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--bd)' }}
      >
        <span style={{ color: 'var(--t3)' }}>{prefix}</span>
        <span style={{ color: 'var(--t1)' }}>{current?.label ?? '—'}</span>
        <span style={{ fontSize: 9, opacity: .5 }}>▾</span>
      </button>

      {open && (
        <div style={{ ...MENU_STYLE, top: pos.top, left: pos.left }}>
          {options.map(opt => (
            <div
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 12px', fontSize: 13, cursor: 'pointer',
                color: opt.value === value ? 'var(--ac)' : 'var(--t1)',
                fontWeight: opt.value === value ? 500 : 400,
                background: 'transparent', transition: 'background .08s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ width: 10, fontSize: 10, color: 'var(--ac)' }}>{opt.value === value ? '✓' : ''}</span>
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MultiSelect<T extends string>({ label, options, selected, onChange }: {
  label: string; options: { value: T; label: string }[]; selected: T[]; onChange: (v: T[]) => void
}) {
  const { open, setOpen, pos, ref, btnRef, toggle } = useMenu()
  const active = selected.length > 0

  const flip = (v: T) =>
    onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }}>
      <button
        ref={btnRef}
        onClick={toggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 10px', borderRadius: 'var(--r1)',
          border: active ? '1px solid var(--ac)' : '1px solid var(--bd)',
          background: active ? 'var(--ac-l)' : 'transparent',
          color: active ? 'var(--ac)' : 'var(--t2)',
          fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
        {active && (
          <span style={{
            minWidth: 15, height: 15, padding: '0 4px', borderRadius: 999,
            background: 'var(--ac)', color: '#fff', fontSize: 10, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{selected.length}</span>
        )}
        <span style={{ fontSize: 9, opacity: .5 }}>▾</span>
      </button>

      {open && (
        <div style={{ ...MENU_STYLE, top: pos.top, left: pos.left, maxHeight: 320, overflowY: 'auto' }}>
          {options.map(opt => (
            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', fontSize: 13, color: 'var(--t1)', cursor: 'pointer', transition: 'background .08s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => flip(opt.value)} style={{ accentColor: 'var(--ac)', width: 13, height: 13, cursor: 'pointer', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
            </label>
          ))}
          {options.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--t3)' }}>선택할 항목이 없습니다</div>
          )}
          {active && (
            <>
              <div style={{ height: 1, background: 'var(--bd)', margin: '3px 0' }} />
              <button onClick={() => { onChange([]); setOpen(false) }} style={{ width: '100%', padding: '6px 12px', fontSize: 12, color: 'var(--ac)', cursor: 'pointer', border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'var(--font)' }}>
                {label} 해제
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ── BottomNav (mobile) ── */

/**
 * The phone's whole navigation, so it is worth more than six characters and a
 * hairline.
 *
 * Three changes, all of them about the thing being legible at a glance while
 * a thumb is over it: drawn icons instead of borrowed glyphs (see NavIcons), a
 * soft pill behind the one you are on — the selected colour alone was doing all
 * the work, and colour is the first thing to go on a phone in daylight — and a
 * translucent bar so the content scrolling under it stays visible, which is what
 * every native bar on the device does.
 *
 * In flow rather than fixed: `position: fixed` here left a gap under the bar on
 * iOS while the address bar animated.
 */
function BottomNav({ view, onPick }: { view: ViewType; onPick: (v: ViewType) => void }) {
  const [pressed, setPressed] = React.useState<string | null>(null)
  const screen = useUiStore(s => s.screen)
  const setScreen = useUiStore(s => s.setScreen)

  // The view is remembered across devices, so somebody who left the desktop on
  // 보드 would arrive here with no tab lit and no way to tell where they are.
  React.useEffect(() => {
    if (!MOBILE_VIEWS.some(v => v.id === view)) onPick('t')
  }, [view, onPick])

  return (
    <nav style={{
      flexShrink: 0,
      height: 'calc(var(--bottom-nav-h) + var(--safe-b-nav))',
      paddingBottom: 'var(--safe-b-nav)',
      borderTop: '1px solid var(--bd)',
      // A whisper of a shadow, so the bar reads as sitting over the content
      // rather than as a white strip the content stopped short of.
      boxShadow: 'var(--sh-sm)',
      background: 'var(--bar-bg)',
      backdropFilter: 'saturate(180%) blur(20px)',
      WebkitBackdropFilter: 'saturate(180%) blur(20px)',
      display: 'flex',
      boxSizing: 'border-box',
    }}>
      {/* 오늘은 뷰가 아니라 화면입니다 — 옆의 넷은 업무를 보는 방법들이고,
          이건 하루를 계획하는 곳입니다. 그래도 폰에서 갈 수 있는 곳은 이 바가
          전부이므로 여기 자리를 하나 내줍니다. */}
      <Tab
        label="오늘"
        on={screen === 'today'}
        pressed={pressed === 'today'}
        setPressed={setPressed}
        id="today"
        onClick={() => { haptic('tap'); setScreen('today') }}
        icon={<Icon name="today" size={20} strokeWidth={screen === 'today' ? 2 : 1.7} />}
      />
      {MOBILE_VIEWS.map(v => {
        // 사이드바로 들어간 '캘린더'(범위 없는 화면)도 이 탭이 받습니다 —
        // 폰에서 아래 바는 지금 어디인지 말하는 유일한 자리입니다.
        const on = v.id === 'c'
          ? screen === 'calendar' || (screen === 'work' && view === 'c')
          : screen === 'work' && view === v.id
        return (
          <button
            key={v.id}
            onClick={() => { setScreen('work'); onPick(v.id) }}
            onPointerDown={() => setPressed(v.id)}
            onPointerUp={() => setPressed(null)}
            onPointerCancel={() => setPressed(null)}
            onPointerLeave={() => setPressed(null)}
            aria-current={on ? 'page' : undefined}
            style={{
              flex: 1, height: '100%',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 1,
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 0, WebkitTapHighlightColor: 'transparent',
              color: on ? 'var(--ac)' : 'var(--t3)',
              fontSize: 10, lineHeight: 1.2, fontWeight: on ? 600 : 400,
              fontFamily: 'var(--font)', letterSpacing: '-.01em',
              transition: 'color .12s',
            }}
          >
            <span style={{
              width: 32, height: 24, borderRadius: 999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: on ? 'var(--ac-l)' : 'transparent',
              transform: pressed === v.id ? 'scale(.9)' : 'scale(1)',
              transition: 'background .12s, transform .12s',
            }}>
              <NavIcon view={v.id} size={21} active={on} />
            </span>
            {v.label}
          </button>
        )
      })}
    </nav>
  )
}

/** 하단 바의 탭 한 장. 오늘과 뷰 탭들이 같은 모양이어야 해서 밖으로 냅니다. */
function Tab({ id, label, on, pressed, setPressed, onClick, icon }: {
  id: string
  label: string
  on: boolean
  pressed: boolean
  setPressed: (v: string | null) => void
  onClick: () => void
  icon: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      onPointerDown={() => setPressed(id)}
      onPointerUp={() => setPressed(null)}
      onPointerCancel={() => setPressed(null)}
      onPointerLeave={() => setPressed(null)}
      aria-current={on ? 'page' : undefined}
      style={{
        flex: 1, height: '100%',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 1,
        background: 'transparent', border: 'none', cursor: 'pointer',
        padding: 0, WebkitTapHighlightColor: 'transparent',
        color: on ? 'var(--ac)' : 'var(--t3)',
        fontSize: 10, lineHeight: 1.2, fontWeight: on ? 600 : 400,
        fontFamily: 'var(--font)', letterSpacing: '-.01em',
        transition: 'color .12s',
      }}
    >
      <span style={{
        width: 32, height: 24, borderRadius: 999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: on ? 'var(--ac-l)' : 'transparent',
        transform: pressed ? 'scale(.9)' : 'scale(1)',
        transition: 'background .12s, transform .12s',
      }}>
        {icon}
      </span>
      {label}
    </button>
  )
}
