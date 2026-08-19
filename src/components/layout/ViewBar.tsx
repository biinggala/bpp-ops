import React from 'react'
import { authorizedEmails, isAuthorizedAssignee, assigneeKeyToEmail, parseAssignees } from '../../lib/utils'
import { useUiStore } from '../../store/uiStore'
import { useProjectStore } from '../../store/projectStore'
import { useUserProfileStore } from '../../store/userProfileStore'
import { useAuthStore } from '../../store/authStore'
import { useScopedTasks } from '../../hooks/useScopedTasks'
import { useMobile } from '../../hooks/useMobile'
import { haptic } from '../../lib/haptics'
import { MEMBERS, STATUS_COLORS } from '../../types'
import type { ViewType, Status, MemberKey } from '../../types'
import { STATUS_LIST } from '../../types'

const VIEWS: { id: ViewType; label: string; icon: string }[] = [
  { id: 't', label: '리스트', icon: '≡' },
  { id: 'b', label: '보드', icon: '⊞' },
  { id: 'c', label: '캘린더', icon: '◪' },
  { id: 'g', label: '간트', icon: '▤' },
  { id: 's', label: '통계', icon: '◑' },
  { id: 'f', label: '자료', icon: '🗂' },
]

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
]

export function ViewBar() {
  const {
    view, setView, filters, setFilters, resetFilters,
    hideCompleted, setHideCompleted,
    listGroup, setListGroup, myTasksOnly, projectId,
  } = useUiStore()
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

  // Assignee options — restricted to participants with project access. Keyed by
  // canonical email so each person appears once even when some tasks use their
  // legacy MemberKey.
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
    const byEmail = new Map<string, MemberKey>()
    ;(Object.keys(MEMBERS) as MemberKey[]).forEach(k => byEmail.set(MEMBERS[k].email.toLowerCase(), k))
    return Array.from(emails).sort().map(em => {
      const mk = byEmail.get(em)
      return { value: em, label: mk ? MEMBERS[mk].n : getNameByEmail(em) }
    })
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
  const showSort = view === 't' || view === 'b'
  const showGroup = view === 't'
  // The files view answers a different question and has its own search box: a
  // status or assignee filter has nothing to say about a 계약서.
  const showFilters = view !== 'f'

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
  if (isMobile) {
    return (
      <nav style={{
        flexShrink: 0,
        height: 'calc(var(--bottom-nav-h) + var(--safe-b))',
        paddingBottom: 'var(--safe-b)',
        background: 'var(--bg)', borderTop: '1px solid var(--bd)',
        display: 'flex',
        boxSizing: 'border-box',
      }}>
        {VIEWS.map(v => (
          <button
            key={v.id}
            onClick={() => { haptic('tap'); setView(v.id) }}
            style={{
              flex: 1, height: '100%',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 3,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: view === v.id ? 'var(--ac)' : 'var(--t3)',
              fontSize: 10, fontWeight: view === v.id ? 600 : 400,
              fontFamily: 'var(--font)',
              transition: 'color .1s',
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>{v.icon}</span>
            {v.label}
          </button>
        ))}
      </nav>
    )
  }

  return (
    <div style={{ background: 'var(--bg)', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
      <div style={{
        height: 44, padding: '0 20px',
        display: 'flex', alignItems: 'center', gap: 2, overflowX: 'auto',
      }}>
        {VIEWS.map((v, i) => (
          <React.Fragment key={v.id}>
            {(i === 3 || i === 4) && <Divider />}
            <ViewTab active={view === v.id} onClick={() => setView(v.id)}>
              {v.label}
            </ViewTab>
          </React.Fragment>
        ))}

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

function ViewTab({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', padding: '4px 12px',
        borderRadius: 'var(--r1)', fontSize: 14, fontWeight: active ? 500 : 400,
        cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
        background: 'transparent', fontFamily: 'var(--font)',
        color: active ? 'var(--ac)' : 'var(--t2)',
        borderBottom: active ? '2px solid var(--ac)' : '2px solid transparent',
        transition: 'color .1s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--t1)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--t2)' }}
    >
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
