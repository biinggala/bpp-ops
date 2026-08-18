import React from 'react'
import { authorizedEmails, isAuthorizedAssignee, assigneeKeyToEmail, parseAssignees } from '../../lib/utils'
import { useUiStore } from '../../store/uiStore'
import { useProjectStore } from '../../store/projectStore'
import { useUserProfileStore } from '../../store/userProfileStore'
import { useAuthStore } from '../../store/authStore'
import { useAccessibleTasks } from '../../hooks/useAccessibleTasks'
import { useMobile } from '../../hooks/useMobile'
import { MEMBERS } from '../../types'
import type { ViewType, Status, MemberKey } from '../../types'
import { STATUS_LIST } from '../../types'

const VIEWS: { id: ViewType; label: string; icon: string }[] = [
  { id: 't', label: '리스트', icon: '≡' },
  { id: 'b', label: '보드', icon: '⊞' },
  { id: 'c', label: '캘린더', icon: '◪' },
  { id: 'g', label: '간트', icon: '▤' },
  { id: 's', label: '통계', icon: '◑' },
]

const SORT_OPTIONS = [
  { value: 'due_asc' as const, label: '마감 가까운 순' },
  { value: 'due_desc' as const, label: '마감 먼 순' },
  { value: 'default' as const, label: '기본 순서' },
]

export function ViewBar() {
  const { view, setView, filters, setFilters, resetFilters, showGCal, setShowGCal, hideCompleted, setHideCompleted } = useUiStore()
  const isMobile = useMobile()
  const accessibleTasks = useAccessibleTasks()
  const projects = useProjectStore(s => s.projects)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const email = useAuthStore(s => s.email)

  // Only show projects the current user is a member of (same rule as Sidebar);
  // archived ones are filtered out since they're absent from the active views.
  const accessibleProjects = React.useMemo(() =>
    projects.filter(p => !p.archived)
  , [projects, email])

  const allTagOptions = React.useMemo(() => {
    const s = new Set<string>()
    accessibleTasks.forEach(t => t.tags?.forEach(tag => s.add(tag)))
    return Array.from(s).sort()
  }, [accessibleTasks])

  // Assignee filter options — restricted to participants with project access.
  // Non-members are never listed even if assigned to a visible task. Keyed by
  // canonical email so each person appears once; the legacy MemberKey alias is
  // used as the filter value when present so legacy-assigned tasks still match.
  const allAssigneeOptions = React.useMemo(() => {
    const authorized = authorizedEmails(accessibleProjects, email)
    const emails = new Set<string>()
    accessibleProjects.forEach(p => p.memberEmails?.forEach(e => emails.add(e.toLowerCase())))
    accessibleTasks.forEach(t => {
      parseAssignees(t.assignee).forEach(k => {
        if (isAuthorizedAssignee(k, authorized)) emails.add(assigneeKeyToEmail(k))
      })
    })
    const byEmail = new Map<string, MemberKey>()
    ;(Object.keys(MEMBERS) as MemberKey[]).forEach(k => byEmail.set(MEMBERS[k].email.toLowerCase(), k))
    return Array.from(emails).sort().map(em => {
      const mk = byEmail.get(em)
      return { value: em, label: mk ? MEMBERS[mk].n : getNameByEmail(em) }
    })
  }, [accessibleTasks, accessibleProjects, email, getNameByEmail])

  const allProjectOptions = React.useMemo(() =>
    accessibleProjects.map(p => ({ value: p.id, label: p.name }))
  , [accessibleProjects])

  const hasFilters = filters.assignees.length > 0 || filters.statuses.length > 0 || filters.tags.length > 0 || filters.projects.length > 0 || hideCompleted
  const showFilters = view !== 's'
  // Sorting only means anything where rows are listed, and the calendar toggle
  // only where calendar entries are drawn. Showing either everywhere just makes
  // the bar longer than the decisions it offers.
  const showSort = view === 't' || view === 'b'
  const showGCalToggle = view === 'c'

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
              onClick={() => setView(v.id)}
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
    <div style={{
      height: 44,
      background: 'var(--bg)',
      borderBottom: '1px solid var(--bd)',
      padding: '0 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      flexShrink: 0,
      overflowX: 'auto',
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
          {allProjectOptions.length > 1 && (
            <MultiSelect
              label="프로젝트"
              options={allProjectOptions}
              selected={filters.projects}
              onChange={v => setFilters({ projects: v })}
            />
          )}
          {allAssigneeOptions.length > 0 && (
            <MultiSelect
              label="담당자"
              options={allAssigneeOptions}
              selected={filters.assignees}
              onChange={v => setFilters({ assignees: v })}
            />
          )}
          <MultiSelect
            label="상태"
            options={STATUS_LIST.map(s => ({ value: s, label: s }))}
            selected={filters.statuses}
            onChange={v => setFilters({ statuses: v as Status[] })}
          />
          {allTagOptions.length > 0 && (
            <MultiSelect
              label="태그"
              options={allTagOptions.map(t => ({ value: t, label: `#${t}` }))}
              selected={filters.tags}
              onChange={v => setFilters({ tags: v })}
            />
          )}
          {showGCalToggle && (
            <button
              onClick={() => setShowGCal(!showGCal)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 'var(--r1)',
                border: showGCal ? '1px solid rgba(68,131,97,.4)' : '1px solid var(--bd)',
                background: showGCal ? 'rgba(68,131,97,.12)' : 'transparent',
                color: showGCal ? '#448361' : 'var(--t3)',
                fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font)', whiteSpace: 'nowrap',
              }}
            >
              📅 일정
            </button>
          )}
          <button
            onClick={() => setHideCompleted(!hideCompleted)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 'var(--r1)',
              border: hideCompleted ? '1px solid var(--ac)' : '1px solid var(--bd)',
              background: hideCompleted ? 'var(--ac-l)' : 'transparent',
              color: hideCompleted ? 'var(--ac)' : 'var(--t2)',
              fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font)', whiteSpace: 'nowrap',
            }}
          >
            완료 숨기기
          </button>

          {/* Each dropdown clears only itself; with four set this is the only way
              back to an unfiltered view in one action. */}
          {hasFilters && (
            <button
              onClick={() => { resetFilters(); setHideCompleted(false) }}
              title="필터 모두 해제"
              style={{ padding: '3px 9px', borderRadius: 'var(--r1)', border: '1px solid var(--bd2)', background: 'transparent', color: 'var(--t2)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)', whiteSpace: 'nowrap' }}
            >
              필터 해제
            </button>
          )}
          {showSort && (
            <SingleSelect
              options={SORT_OPTIONS}
              value={filters.sort}
              onChange={v => setFilters({ sort: v })}
            />
          )}
        </div>
      )}
    </div>
  )
}

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

function SingleSelect<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [pos, setPos] = React.useState({ top: 0, left: 0 })
  const ref = React.useRef<HTMLDivElement>(null)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const current = options.find(o => o.value === value)

  React.useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(o => !o)
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }}>
      <button
        ref={btnRef}
        onClick={handleOpen}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 10px', borderRadius: 'var(--r1)',
          border: '1px solid var(--bd)', background: 'transparent',
          color: 'var(--t2)', fontSize: 13, cursor: 'pointer',
          fontFamily: 'var(--font)', whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)'; e.currentTarget.style.borderColor = 'var(--bd2)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--t2)'; e.currentTarget.style.borderColor = 'var(--bd)' }}
      >
        {current?.label ?? '정렬'}
        <span style={{ fontSize: 9, opacity: .5 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'fixed', top: pos.top, left: pos.left,
          background: 'var(--bg)', border: '1px solid var(--bd)',
          borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)',
          zIndex: 9000, minWidth: 140, padding: '4px 0',
        }}>
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
              {opt.value === value && <span style={{ fontSize: 10, color: 'var(--ac)' }}>✓</span>}
              {opt.value !== value && <span style={{ width: 10 }} />}
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
  const [open, setOpen] = React.useState(false)
  const [pos, setPos] = React.useState({ top: 0, left: 0 })
  const ref = React.useRef<HTMLDivElement>(null)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const active = selected.length > 0

  React.useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const toggle = (v: T) =>
    onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v])

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(o => !o)
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }}>
      <button
        ref={btnRef}
        onClick={handleOpen}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 10px', borderRadius: 'var(--r1)',
          border: active ? '1px solid var(--ac)' : '1px solid var(--bd)',
          background: active ? 'var(--ac-l)' : 'transparent',
          color: active ? 'var(--ac)' : 'var(--t2)',
          fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font)',
          whiteSpace: 'nowrap',
        }}
      >
        {active ? `${label} (${selected.length})` : label}
        <span style={{ fontSize: 9, opacity: .5 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'fixed', top: pos.top, left: pos.left,
          background: 'var(--bg)', border: '1px solid var(--bd)',
          borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)',
          zIndex: 9000, minWidth: 160, padding: '4px 0',
        }}>
          {options.map(opt => (
            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', fontSize: 13, color: 'var(--t1)', cursor: 'pointer', transition: 'background .08s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)} style={{ accentColor: 'var(--ac)', width: 13, height: 13, cursor: 'pointer', flexShrink: 0 }} />
              {opt.label}
            </label>
          ))}
          {selected.length > 0 && (
            <>
              <div style={{ height: 1, background: 'var(--bd)', margin: '3px 0' }} />
              <button onClick={() => { onChange([]); setOpen(false) }} style={{ width: '100%', padding: '6px 12px', fontSize: 12, color: 'var(--ac)', cursor: 'pointer', border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'var(--font)' }}>
                전체 해제
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
