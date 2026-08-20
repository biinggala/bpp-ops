import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTaskStore } from '../../../store/taskStore'
import { useUiStore } from '../../../store/uiStore'
import { useAuthStore } from '../../../store/authStore'
import { useProjectStore } from '../../../store/projectStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { useUserProfileStore } from '../../../store/userProfileStore'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useMobile } from '../../../hooks/useMobile'
import { haptic } from '../../../lib/haptics'
import { isComposing, parseAssignees } from '../../../lib/utils'
import { NOTION, STATUS_COLORS } from '../../../types'

/**
 * ── Putting work on a day ────────────────────────────────────────────────────
 *
 * Clicking a day in the month grid did nothing, so the calendar could only ever
 * report a plan someone had already made in the list. Two established moves
 * cover the gap, and they are different jobs:
 *
 * - **Google Calendar / Notion Calendar**: click an empty day, get one text
 *   field, type, Enter. Deliberately one field — a dialog asking for eight
 *   things is not a quick add.
 * - **Sunsama / Amie / Motion / ClickUp**: keep the undated work in a rail and
 *   drag it onto days. This is the weekly-planning ritual, and it is the more
 *   valuable half here: a team with a backlog is not short of tasks, it is
 *   short of decisions about when they happen.
 *
 * Both live in one popover rather than a permanent side rail. A month grid is
 * already starved of width, and the backlog is only interesting while you are
 * actually placing something — so it appears where you clicked, and leaves with
 * you. Dragging a chip from one day to another already worked; this adds the
 * two cases it could not reach: work that has no date yet, and work that does
 * not exist yet.
 */

const DOW = ['일', '월', '화', '수', '목', '금', '토']

export function DayPlanner({ date, anchor, onClose }: {
  date: string
  anchor: HTMLElement | null
  onClose: () => void
}) {
  const { addTask, updateTask } = useTaskStore()
  const { projectId, space } = useUiStore()
  const email = useAuthStore(s => s.email)
  const projects = useProjectStore(s => s.projects)
  const milestones = useMilestoneStore(s => s.milestones)
  const nameOf = useUserProfileStore(s => s.getNameByEmail)
  const tasks = useFilteredTasks()
  const isMobile = useMobile()

  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [pickedProject, setPickedProject] = useState<string | undefined>(projectId ?? undefined)
  const [showAll, setShowAll] = useState(false)

  const activeProjects = useMemo(() => projects.filter(p => !p.archived), [projects])

  /**
   * The backlog: work that exists and has no date at all.
   *
   * Subtasks are left out — they move with their parent, and a list mixing the
   * two reads as duplicates of the same job.
   */
  const undated = useMemo(
    () => tasks.filter(t => !t.due && !t.start && t.status !== '완료' && !t.parentId),
    [tasks],
  )
  const shown = showAll ? undated.slice(0, 20) : undated.slice(0, 5)

  const d = new Date(date + 'T00:00:00')
  const dayMilestones = milestones
    .filter(m => m.dueDate === date && (!projectId || m.projectId === projectId))
    .filter(m => activeProjects.some(p => p.id === m.projectId))

  // ── Placement ───────────────────────────────────────────────────────────────
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  useEffect(() => {
    if (isMobile) { setPos({ top: 0, left: 0 }); return }
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    const W = 300, H = 340
    setPos({
      top: Math.min(Math.max(8, r.top), Math.max(8, window.innerHeight - H - 8)),
      left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - W - 8)),
    })
  }, [anchor, isMobile])

  // Not on a phone: focusing the field throws the keyboard up over the backlog,
  // which is the half most people opened this for.
  useEffect(() => { if (!isMobile) inputRef.current?.focus() }, [isMobile])

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])

  const create = () => {
    const n = name.trim()
    if (!n) return
    addTask({
      type: '상위', cat: space ?? '', name: n, assignee: '',
      start: '', due: date, priority: '중간', status: '대기',
      progress: 0, memo: '', projectId: pickedProject,
      createdBy: email ?? undefined,
    })
    haptic('toggle')
    // Stays open and cleared: putting three things on a Thursday is one sitting,
    // not three trips.
    setName('')
    inputRef.current?.focus()
  }

  if (!pos) return null

  const label = `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`

  const shell: React.CSSProperties = isMobile
    ? {
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9100,
        background: 'var(--bg)', borderTop: '1px solid var(--bd)',
        borderRadius: '16px 16px 0 0', boxShadow: '0 -8px 32px rgba(0,0,0,.18)',
        padding: 14, paddingBottom: 'calc(14px + env(safe-area-inset-bottom, 0px))',
        boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '80vh',
      }
    : {
        position: 'fixed', top: pos.top, left: pos.left, width: 300, zIndex: 9100,
        background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)',
        boxShadow: 'var(--sh-md)', padding: 10, boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '70vh',
      }

  return createPortal(
    <>
    {/*
      A sheet on a phone needs something behind it to catch the tap that
      dismisses it. On a desktop the same layer earns its place differently: a
      document listener would close this and then let the click through to
      whatever it landed on, so clicking another day dismissed one planner and
      opened the next in a single motion — which reads as a popover that cannot
      be closed at all. The click that dismisses it stops here.
    */}
    <div
      onMouseDown={e => { e.stopPropagation(); onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9099,
        background: isMobile ? 'rgba(15,15,15,.32)' : 'transparent',
      }}
    />
    <div
      ref={panelRef}
      onClick={e => e.stopPropagation()}
      style={shell}
    >
      {isMobile && (
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--bd2)', margin: '-4px auto 0' }} />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{label}</span>
        {dayMilestones.map(m => (
          <span key={m.id} title={m.name} style={{ fontSize: 10, fontWeight: 600, color: NOTION.purple.text, background: NOTION.purple.bg, borderRadius: 4, padding: '1px 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
            ◆ {m.name}
          </span>
        ))}
      </div>

      {/* One field. Type, Enter, it is on the day. */}
      <input
        ref={inputRef}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); create() }
        }}
        placeholder="업무 이름 입력 후 Enter"
        style={{
          width: '100%', boxSizing: 'border-box',
          border: '1px solid var(--bd)', borderRadius: 'var(--r1)',
          padding: isMobile ? '10px 11px' : '6px 9px', fontSize: 16,
          background: 'var(--bg2)', color: 'var(--t1)',
          outline: 'none', fontFamily: 'var(--font)',
        }}
      />

      {/* Only asked when the answer is not already on screen. */}
      {!projectId && activeProjects.length > 0 && (
        <ProjectPicker
          projects={activeProjects}
          value={pickedProject}
          onChange={setPickedProject}
        />
      )}

      {undated.length > 0 && (
        <>
          <div style={{ height: 1, background: 'var(--bd)' }} />
          <div style={{ fontSize: 11, color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: 5 }}>
            날짜 없는 업무
            <span style={{ color: 'var(--t2)' }}>{undated.length}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10 }}>클릭하면 이 날로</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto', minHeight: 0, margin: '0 -4px', padding: '0 4px' }}>
            {shown.map(t => {
              const proj = projects.find(p => p.id === t.projectId)
              return (
                <div
                  key={t.id}
                  onClick={() => { haptic('toggle'); updateTask(t.id, { due: date }) }}
                  title={t.name}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: isMobile ? '11px 8px' : '5px 6px',
                    borderRadius: 'var(--r1)', cursor: 'pointer',
                    fontSize: isMobile ? 14 : 12, minWidth: 0, transition: 'background .07s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: proj?.color ?? STATUS_COLORS[t.status]?.text ?? 'var(--t3)' }} />
                  <span style={{ flex: 1, minWidth: 0, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.name}
                  </span>
                  {t.assignee && (
                    <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--t3)', maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {parseAssignees(t.assignee).map(a => nameOf(a)).join(', ')}
                    </span>
                  )}
                </div>
              )
            })}
            {!showAll && undated.length > shown.length && (
              <button
                onClick={() => setShowAll(true)}
                style={{ padding: '5px 6px', fontSize: 11, color: 'var(--t3)', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)' }}
              >
                +{undated.length - shown.length}건 더 보기
              </button>
            )}
          </div>
        </>
      )}
    </div>
    </>,
    document.body,
  )
}

/** Which project a quick-added task lands in, asked only in the all-projects view. */
function ProjectPicker({ projects, value, onChange }: {
  projects: { id: string; name: string; color: string }[]
  value: string | undefined
  onChange: (v: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const current = projects.find(p => p.id === value)
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5, width: '100%',
          padding: '4px 8px', borderRadius: 'var(--r1)',
          border: '1px solid var(--bd)', background: 'transparent',
          fontSize: 12, color: current ? 'var(--t1)' : 'var(--t3)',
          cursor: 'pointer', fontFamily: 'var(--font)',
        }}
      >
        {current && <span style={{ width: 7, height: 7, borderRadius: '50%', background: current.color, flexShrink: 0 }} />}
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current?.name ?? '프로젝트 미배정'}
        </span>
        <span style={{ fontSize: 9, opacity: .5 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 3, zIndex: 1,
          background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)',
          boxShadow: 'var(--sh-md)', padding: 4, maxHeight: 200, overflowY: 'auto',
        }}>
          <Opt onClick={() => { onChange(undefined); setOpen(false) }} active={!value}>프로젝트 미배정</Opt>
          {projects.map(p => (
            <Opt key={p.id} onClick={() => { onChange(p.id); setOpen(false) }} active={p.id === value} dot={p.color}>
              {p.name}
            </Opt>
          ))}
        </div>
      )}
    </div>
  )
}

function Opt({ children, onClick, active, dot }: {
  children: React.ReactNode; onClick: () => void; active: boolean; dot?: string
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 7px',
        borderRadius: 'var(--r1)', fontSize: 12, cursor: 'pointer',
        color: 'var(--t1)', fontWeight: active ? 500 : 400,
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
      {active && <span style={{ fontSize: 10, color: 'var(--ac)' }}>✓</span>}
    </div>
  )
}
