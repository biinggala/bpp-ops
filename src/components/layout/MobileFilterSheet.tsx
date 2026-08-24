import React, { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUiStore, type ListGroup } from '../../store/uiStore'
import { useProjectStore } from '../../store/projectStore'
import { useUserProfileStore } from '../../store/userProfileStore'
import { useAuthStore } from '../../store/authStore'
import { useScopedTasks } from '../../hooks/useScopedTasks'
import { authorizedEmails, isAuthorizedAssignee, assigneeKeyToEmail, parseAssignees } from '../../lib/utils'
import { haptic } from '../../lib/haptics'
import { STATUS_LIST, STATUS_COLORS } from '../../types'
import type { Status } from '../../types'
import { useShallow } from 'zustand/react/shallow'

/**
 * ── Filters on a phone ───────────────────────────────────────────────────────
 *
 * The desktop bar puts seven controls in a row, which a phone has no width for.
 * Every mobile tool that has solved this — ClickUp, Todoist, Linear, Asana —
 * lands in the same place: one button in the header, opening a sheet with
 * everything in it, and a count on the button so the state is visible without
 * opening anything.
 *
 * Choices apply as they are made rather than on a "적용" button. The list is
 * behind the sheet, not replaced by it, so the effect of a tap is visible the
 * moment it happens and there is nothing to confirm.
 */

const SORTS: { value: 'due_asc' | 'due_desc' | 'priority_desc' | 'name_asc' | 'default'; label: string }[] = [
  { value: 'due_asc', label: '마감 가까운 순' },
  { value: 'due_desc', label: '마감 먼 순' },
  { value: 'priority_desc', label: '우선순위 순' },
  { value: 'name_asc', label: '이름 순' },
  { value: 'default', label: '기본 순서' },
]

const GROUPS: { value: ListGroup; label: string }[] = [
  { value: 'project', label: '프로젝트' },
  { value: 'none', label: '없음' },
  { value: 'due', label: '마감일' },
  { value: 'priority', label: '우선순위' },
  { value: 'assignee', label: '담당자' },
  { value: 'status', label: '상태' },
  { value: 'tag', label: '태그' },
]

export function MobileFilterSheet({ onClose }: { onClose: () => void }) {
  const {
    filters, setFilters, resetFilters,
    hideCompleted, setHideCompleted,
    listGroup, setListGroup,
    view, myTasksOnly, projectId,
  } = useUiStore(useShallow(s => ({ filters: s.filters, setFilters: s.setFilters, resetFilters: s.resetFilters, hideCompleted: s.hideCompleted, setHideCompleted: s.setHideCompleted, listGroup: s.listGroup, setListGroup: s.setListGroup, view: s.view, myTasksOnly: s.myTasksOnly, projectId: s.projectId })))
  const scoped = useScopedTasks()
  const projects = useProjectStore(s => s.projects)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const email = useAuthStore(s => s.email)

  const activeProjects = useMemo(() => projects.filter(p => !p.archived), [projects])

  const tagOptions = useMemo(() => {
    const set = new Set<string>()
    scoped.forEach(t => t.tags?.forEach(tag => set.add(tag)))
    return Array.from(set).sort()
  }, [scoped])

  const assigneeOptions = useMemo(() => {
    const authorized = authorizedEmails(activeProjects, email)
    const emails = new Set<string>()
    scoped.forEach(t => parseAssignees(t.assignee).forEach(k => {
      if (isAuthorizedAssignee(k, authorized)) emails.add(assigneeKeyToEmail(k))
    }))
    if (projectId) activeProjects.find(p => p.id === projectId)?.memberEmails?.forEach(e => emails.add(e.toLowerCase()))
    // 이름은 그 사람이 로그인할 때 스스로 써 둔 프로필에서 옵니다.
    return Array.from(emails).sort().map(em => ({ value: em, label: getNameByEmail(em) }))
  }, [scoped, activeProjects, projectId, email, getNameByEmail])

  // The same rules the desktop bar follows: a filter that cannot narrow
  // anything here is not offered. 담당자 inside 내 할 일 says nothing; 프로젝트
  // inside one project can only subtract everything.
  const showProjects = !projectId && activeProjects.length > 1
  const showAssignees = !myTasksOnly && assigneeOptions.length > 0
  const showList = view === 't'
  const showSort = view === 't' || view === 'b'
  const statusOptions = STATUS_LIST.filter(s => !(hideCompleted && s === '완료'))

  const toggle = <T,>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter(x => x !== v) : [...list, v]

  const anything =
    filters.projects.length + filters.assignees.length + filters.statuses.length + filters.tags.length > 0 ||
    !!filters.search.trim() || hideCompleted

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9099, background: 'rgba(15,15,15,.32)' }} />
      <div
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9100,
          background: 'var(--bg)', borderTop: '1px solid var(--bd)',
          borderRadius: '16px 16px 0 0', boxShadow: '0 -8px 32px rgba(0,0,0,.18)',
          maxHeight: '82vh', display: 'flex', flexDirection: 'column',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div style={{ padding: '10px 16px 6px', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--bd2)', margin: '0 auto 10px' }} />
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)', flex: 1 }}>보기 설정</span>
            {anything && (
              <button
                onClick={() => { haptic('warn'); resetFilters(); setHideCompleted(false) }}
                style={{ padding: '6px 10px', fontSize: 13, border: 'none', background: 'transparent', color: 'var(--ac)', fontFamily: 'var(--font)', cursor: 'pointer' }}
              >모두 해제</button>
            )}
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: '4px 16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {showList && (
            <Section label="그룹">
              <Chips
                options={GROUPS.map(g => ({ value: g.value, label: g.label }))}
                selected={[listGroup]}
                onPick={v => { haptic('toggle'); setListGroup(v as ListGroup) }}
              />
            </Section>
          )}

          {showSort && (
            <Section label="정렬">
              <Chips
                options={SORTS.map(o => ({ value: o.value, label: o.label }))}
                selected={[filters.sort]}
                onPick={v => { haptic('toggle'); setFilters({ sort: v as typeof filters.sort }) }}
              />
            </Section>
          )}

          {showProjects && (
            <Section label="프로젝트" count={filters.projects.length}>
              <Chips
                options={activeProjects.map(p => ({ value: p.id, label: p.name, dot: p.color }))}
                selected={filters.projects}
                onPick={v => { haptic('toggle'); setFilters({ projects: toggle(filters.projects, v) }) }}
              />
            </Section>
          )}

          {showAssignees && (
            <Section label="담당자" count={filters.assignees.length}>
              <Chips
                options={assigneeOptions}
                selected={filters.assignees}
                onPick={v => { haptic('toggle'); setFilters({ assignees: toggle(filters.assignees, v) }) }}
              />
            </Section>
          )}

          <Section label="상태" count={filters.statuses.length}>
            <Chips
              options={statusOptions.map(s => ({ value: s, label: s, dot: STATUS_COLORS[s].text }))}
              selected={filters.statuses}
              onPick={v => { haptic('toggle'); setFilters({ statuses: toggle(filters.statuses, v as Status) }) }}
            />
          </Section>

          {tagOptions.length > 0 && (
            <Section label="태그" count={filters.tags.length}>
              <Chips
                options={tagOptions.map(t => ({ value: t, label: `#${t}` }))}
                selected={filters.tags}
                onPick={v => { haptic('toggle'); setFilters({ tags: toggle(filters.tags, v) }) }}
              />
            </Section>
          )}

          <button
            onClick={() => { haptic('toggle'); setHideCompleted(!hideCompleted) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '12px 12px', borderRadius: 'var(--r2)',
              border: `1px solid ${hideCompleted ? 'var(--ac)' : 'var(--bd)'}`,
              background: hideCompleted ? 'var(--ac-l)' : 'transparent',
              color: hideCompleted ? 'var(--ac)' : 'var(--t1)',
              fontSize: 14, fontFamily: 'var(--font)', cursor: 'pointer',
            }}
          >
            <span style={{
              width: 18, height: 18, borderRadius: 4, flexShrink: 0,
              border: `1.5px solid ${hideCompleted ? 'var(--ac)' : 'var(--bd2)'}`,
              background: hideCompleted ? 'var(--ac)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 11, fontWeight: 700,
            }}>{hideCompleted ? '✓' : ''}</span>
            완료 숨기기
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}

function CheckRow({ on, onToggle, children }: {
  on: boolean; onToggle: () => void; children: React.ReactNode
}) {
  const c = 'var(--ac)'
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '12px 12px', borderRadius: 'var(--r2)',
        border: `1px solid ${on ? c : 'var(--bd)'}`,
        background: on ? 'var(--ac-l)' : 'transparent',
        color: on ? c : 'var(--t1)',
        fontSize: 14, fontFamily: 'var(--font)', cursor: 'pointer',
      }}
    >
      <span style={{
        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
        border: `1.5px solid ${on ? c : 'var(--bd2)'}`,
        background: on ? c : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 11, fontWeight: 700,
      }}>{on ? '✓' : ''}</span>
      {children}
    </button>
  )
}

function Section({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t3)', letterSpacing: '.03em' }}>{label}</span>
        {!!count && (
          <span style={{ minWidth: 16, height: 16, padding: '0 5px', borderRadius: 999, background: 'var(--ac)', color: '#fff', fontSize: 10, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{count}</span>
        )}
      </div>
      {children}
    </div>
  )
}

/**
 * Wrapping chips rather than a list of rows.
 *
 * A phone has one column, and six statuses as six full-width rows is most of a
 * screen for something that fits on two lines. Chips also make the chosen ones
 * legible as a set at a glance, which is the question being asked.
 */
function Chips({ options, selected, onPick }: {
  options: { value: string; label: string; dot?: string }[]
  selected: string[]
  onPick: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(o => {
        const on = selected.includes(o.value)
        return (
          <button
            key={o.value}
            onClick={() => onPick(o.value)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              // 34px tall: comfortably tappable without turning the sheet into
              // a scroll marathon.
              minHeight: 34, padding: '0 12px', borderRadius: 999,
              border: `1px solid ${on ? 'var(--ac)' : 'var(--bd)'}`,
              background: on ? 'var(--ac-l)' : 'transparent',
              color: on ? 'var(--ac)' : 'var(--t2)',
              fontSize: 13, fontWeight: on ? 500 : 400,
              fontFamily: 'var(--font)', cursor: 'pointer',
              maxWidth: '100%',
            }}
          >
            {o.dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: o.dot, flexShrink: 0 }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Whether anything is narrowing the view, for the badge on the button. */
export function useActiveFilterCount(): number {
  const { filters, hideCompleted } = useUiStore(useShallow(s => ({ filters: s.filters, hideCompleted: s.hideCompleted })))
  return (
    filters.projects.length + filters.assignees.length +
    filters.statuses.length + filters.tags.length +
    (filters.search.trim() ? 1 : 0) + (hideCompleted ? 1 : 0)
  )
}

export function MobileFilterButton() {
  const [open, setOpen] = useState(false)
  const count = useActiveFilterCount()
  return (
    <>
      <button
        onClick={() => { haptic('tap'); setOpen(true) }}
        aria-label="보기 설정"
        style={{
          position: 'relative', width: 36, height: 36,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: count ? 'var(--ac-l)' : 'transparent',
          border: `1px solid ${count ? 'var(--ac)' : 'var(--bd)'}`,
          borderRadius: 'var(--r2)', cursor: 'pointer', flexShrink: 0,
          color: count ? 'var(--ac)' : 'var(--t3)', fontSize: 15,
        }}
      >
        ⚙
        {count > 0 && (
          <span style={{
            position: 'absolute', top: -5, right: -5,
            minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999,
            background: 'var(--ac)', color: '#fff', fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{count}</span>
        )}
      </button>
      {open && <MobileFilterSheet onClose={() => setOpen(false)} />}
    </>
  )
}
