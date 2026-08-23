import { useState, useEffect, useRef, useMemo } from 'react'
import { isComposing } from '../../lib/utils'
import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { useProjectStore } from '../../store/projectStore'
import { useMilestoneStore } from '../../store/milestoneStore'
import { useAccessibleTasks } from '../../hooks/useAccessibleTasks'
import { useAuthStore } from '../../store/authStore'
import { useUserProfileStore } from '../../store/userProfileStore'
import { useToast } from '../shared/Toast'
import { useMobile } from '../../hooks/useMobile'
import { DateField } from '../shared/DatePicker'
import { AssigneePicker } from '../shared/AssigneePicker'
import { BadgeSelect } from '../shared/BadgeSelect'
import { StatusPill, PriorityLabel } from '../shared/StatusPill'
import { PropCell, OptionPicker, STATUS_STYLE, PRIORITY_STYLE } from '../shared/PropRow'
import { STATUS_LIST, PRIORITY_LIST, getTagColor } from '../../types'
import type { Task, Status, Priority } from '../../types'

/**
 * ── 새 업무 ──────────────────────────────────────────────────────────────────
 *
 * **Why this still exists.** The list has an add row, and it is the faster way
 * in when you are already looking at the project. But it files into *that*
 * project, and the app now opens on 내 할 일 — which is not a project and has no
 * add row. The calendar, the gantt and 자료 have no row either. So this is the
 * one door that works from anywhere, and it is the only place a task can be
 * created without first choosing where you are standing.
 *
 * **What it is not, any more.** It used to be a form: fourteen fields, `<select>`
 * elements that matched nothing else in the app, a 진행률 slider on a task that
 * did not exist yet, and a 선행/후행 picker behind an `editing` branch that
 * nothing ever reached — 수정 has gone to the detail screen for a long time.
 *
 * What it is now is a name and the handful of facts worth stating at the moment
 * of writing it down: whose it is, when it is due, where it belongs. Everything
 * else is set on the task afterwards, in the detail screen, using the same
 * controls — which are literally the same components now (shared/PropRow), so
 * the two screens cannot drift apart again.
 */

const EMPTY: Omit<Task, 'id'> = {
  type: '상위', name: '', cat: '', assignee: '',
  start: '', due: '', priority: '중간', status: '대기', progress: 0, memo: '',
}

export function TaskModal() {
  const { isTaskModalOpen, newTaskParentId, newTaskMilestoneId, newTaskProjectId, closeTaskModal, projectId: uiProjectId } = useUiStore()
  const { tasks, addTask } = useTaskStore()
  const projects = useProjectStore(s => s.projects)
  const milestones = useMilestoneStore(s => s.milestones)
  const email = useAuthStore(s => s.email)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const isMobile = useMobile()

  const [form, setForm] = useState<Omit<Task, 'id'>>(EMPTY)
  /** Extra projects to file a copy of this new task into. */
  const [alsoProjects, setAlsoProjects] = useState<string[]>([])
  /** 메모와 태그는 접혀 있습니다 — 대부분의 새 업무에는 이름과 담당자뿐입니다. */
  const [more, setMore] = useState(false)

  const parentTask = newTaskParentId ? tasks.find(t => t.id === newTaskParentId) : null

  // Fallback: union of all accessible project members (never exposes global profiles)
  const accessibleMemberEmails = useMemo(() => {
    const s = new Set<string>()
    projects.forEach(p => p.memberEmails?.forEach(e => s.add(e)))
    return Array.from(s)
  }, [projects])

  const assigneeOptions = useMemo(() => {
    const selected = projects.find(p => p.id === form.projectId)
    const emails = selected?.memberEmails?.length ? selected.memberEmails : accessibleMemberEmails
    return emails.map(e => ({ value: e, label: getNameByEmail(e) }))
  }, [form.projectId, projects, accessibleMemberEmails, getNameByEmail])

  const projectMilestones = useMemo(
    () => milestones
      .filter(m => m.projectId === form.projectId)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [milestones, form.projectId],
  )

  const dateContext = useMemo(() => ({
    projectId: form.projectId ?? undefined,
    milestoneId: form.milestoneId ?? undefined,
    assignee: form.assignee,
  }), [form.projectId, form.milestoneId, form.assignee])

  useEffect(() => {
    if (!isTaskModalOpen) return
    // A previous row's extra projects must not follow the next one in.
    setAlsoProjects([])
    setMore(false)
    const defaultProjectId = parentTask?.projectId ?? newTaskProjectId ?? uiProjectId ?? undefined
    const defaultMilestoneId = parentTask?.milestoneId ?? newTaskMilestoneId ?? undefined
    setForm({
      ...EMPTY,
      cat: parentTask?.cat ?? '',
      type: newTaskParentId ? '세부' : EMPTY.type,
      ...(newTaskParentId ? { parentId: newTaskParentId } : {}),
      ...(defaultProjectId ? { projectId: defaultProjectId } : {}),
      ...(defaultMilestoneId ? { milestoneId: defaultMilestoneId } : {}),
    })
  }, [isTaskModalOpen, newTaskParentId, newTaskMilestoneId, newTaskProjectId])

  if (!isTaskModalOpen) return null

  const upd = <K extends keyof Omit<Task, 'id'>>(k: K, v: Omit<Task, 'id'>[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const ready = !!form.name.trim()

  const submit = () => {
    if (!ready) return
    addTask({ ...form, createdBy: email ?? undefined })
    // One copy per extra project. A single record cannot sit in two projects —
    // it lives at its project's path and access is that project's membership —
    // and copies are what people are after anyway: 스텝 취합 for 승원 and for
    // 릴서, each finishing on its own schedule. The milestone does not travel;
    // it belongs to the project it was picked in.
    for (const pid of alsoProjects) {
      addTask({ ...form, projectId: pid, milestoneId: undefined, createdBy: email ?? undefined })
    }
    if (alsoProjects.length) {
      useToast.getState().show(`${alsoProjects.length + 1}개 프로젝트에 추가했습니다`)
    }
    closeTaskModal()
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) closeTaskModal() }}
      onKeyDown={e => { if (e.key === 'Escape') closeTaskModal() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,.45)', zIndex: 100, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 24 }}
    >
      <div style={{
        background: 'var(--bg)', borderRadius: isMobile ? 'var(--r4) var(--r4) 0 0' : 'var(--r4)',
        width: '100%', maxWidth: isMobile ? undefined : 520,
        maxHeight: isMobile ? '92vh' : '86vh',
        display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
        border: '1px solid var(--bd)', boxShadow: 'var(--sh-lg)', overflow: 'hidden',
      }}>

        {/* The name is the header. A modal whose first line is the word "새 업무"
            spends its most valuable row saying what the button that opened it
            already said. */}
        <div style={{ padding: isMobile ? '18px 20px 12px' : '20px 24px 14px', flexShrink: 0 }}>
          {parentTask && (
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ↳ {parentTask.name} 의 하위 업무
            </div>
          )}
          <input
            autoFocus
            value={form.name}
            onChange={e => upd('name', e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) submit() }}
            placeholder="무엇을 해야 하나요?"
            style={{
              width: '100%', border: 'none', outline: 'none', background: 'transparent',
              fontSize: isMobile ? 17 : 19, fontWeight: 600, color: 'var(--t1)',
              fontFamily: 'var(--font)', padding: 0, lineHeight: 1.35,
            }}
          />
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: isMobile ? '0 20px 16px' : '0 24px 18px' }}>
          {/* The same rows, in the same order, drawn by the same components as
              the detail screen. One column here — the modal is half as wide. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', rowGap: 2 }}>
            <PropCell label="프로젝트">
              <OptionPicker
                value={form.projectId}
                empty="없음"
                options={projects.filter(p => !p.archived).map(p => ({ value: p.id, label: p.name, dot: p.color }))}
                onChange={v => { upd('projectId', v); upd('milestoneId', undefined); setAlsoProjects([]) }}
              />
            </PropCell>

            {projectMilestones.length > 0 && (
              <PropCell label="마일스톤">
                <OptionPicker
                  value={form.milestoneId}
                  empty="없음"
                  options={projectMilestones.map(m => ({ value: m.id, label: m.name, sub: m.dueDate }))}
                  onChange={v => upd('milestoneId', v)}
                />
              </PropCell>
            )}

            <PropCell label="담당자">
              <AssigneePicker assignee={form.assignee} options={assigneeOptions} onChange={v => upd('assignee', v)} />
            </PropCell>

            <PropCell label="마감일">
              <DateField value={form.due} context={dateContext} onChange={v => upd('due', v)} placeholder="—" format="full" style={{ fontSize: 13 }} />
            </PropCell>

            <PropCell label="시작일">
              <DateField value={form.start} context={dateContext} onChange={v => upd('start', v)} placeholder="—" format="full" style={{ fontSize: 13 }} />
            </PropCell>

            <PropCell label="상태">
              <BadgeSelect value={form.status} options={STATUS_LIST as Status[]} styleMap={STATUS_STYLE} renderValue={v => <StatusPill status={v} />} onChange={v => upd('status', v as Status)} />
            </PropCell>

            <PropCell label="우선순위">
              <BadgeSelect value={form.priority} options={PRIORITY_LIST as Priority[]} styleMap={PRIORITY_STYLE} renderValue={v => <PriorityLabel priority={v} />} onChange={v => upd('priority', v as Priority)} />
            </PropCell>
          </div>

          {/* Only once a project is chosen: 'the same task, in these too'. */}
          {form.projectId && projects.filter(p => !p.archived).length > 1 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--bd)' }}>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 7 }}>
                같은 업무를 다른 프로젝트에도
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {projects.filter(p => !p.archived && p.id !== form.projectId).map(p => {
                  const on = alsoProjects.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setAlsoProjects(prev => on ? prev.filter(id => id !== p.id) : [...prev, p.id])}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '4px 9px', borderRadius: 999, cursor: 'pointer',
                        fontFamily: 'var(--font)', fontSize: 12,
                        color: on ? '#fff' : 'var(--t2)',
                        background: on ? 'var(--ac)' : 'transparent',
                        border: `1px solid ${on ? 'var(--ac)' : 'var(--bd2)'}`,
                      }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: on ? '#fff' : p.color }} />
                      {p.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Folded away, because most new tasks are a name and a person. */}
          {more ? (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <textarea
                rows={3}
                value={form.memo}
                onChange={e => upd('memo', e.target.value)}
                placeholder="메모..."
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '8px 10px', resize: 'vertical',
                  border: '1px solid var(--bd)', borderRadius: 'var(--r2)', background: 'var(--bg)',
                  fontSize: 13, lineHeight: 1.65, color: 'var(--t1)', outline: 'none', fontFamily: 'var(--font)',
                }}
              />
              <TagInput value={form.tags ?? []} onChange={tags => upd('tags', tags)} />
            </div>
          ) : (
            <button
              onClick={() => setMore(true)}
              style={{
                marginTop: 10, padding: 0, border: 'none', background: 'transparent',
                fontSize: 12, color: 'var(--t3)', cursor: 'pointer', fontFamily: 'var(--font)',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--t2)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--t3)')}
            >+ 메모·태그</button>
          )}
        </div>

        <div style={{
          padding: isMobile ? '12px 20px calc(env(safe-area-inset-bottom, 0px) + 12px)' : '12px 24px',
          borderTop: '1px solid var(--bd)', background: 'var(--bg2)',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        }}>
          {!isMobile && (
            <span style={{ fontSize: 11, color: 'var(--t3)', marginRight: 'auto' }}>
              ⏎ 추가 · esc 취소
            </span>
          )}
          <button
            onClick={closeTaskModal}
            style={{ marginLeft: isMobile ? 'auto' : undefined, padding: '7px 14px', borderRadius: 'var(--r2)', border: '1px solid var(--bd)', background: 'var(--bg)', fontSize: 13, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)' }}
          >취소</button>
          <button
            onClick={submit}
            disabled={!ready}
            style={{
              padding: '7px 18px', borderRadius: 'var(--r2)', border: 'none',
              background: ready ? 'var(--ac)' : 'var(--bd2)', color: '#fff',
              fontSize: 13, fontWeight: 500, cursor: ready ? 'pointer' : 'not-allowed',
              fontFamily: 'var(--font)', transition: 'background .12s',
            }}
          >추가</button>
        </div>
      </div>
    </div>
  )
}

function TagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const accessibleTasks = useAccessibleTasks()
  const allTags = useMemo(() => {
    const s = new Set<string>()
    accessibleTasks.forEach(t => t.tags?.forEach(tag => s.add(tag)))
    return Array.from(s).sort()
  }, [accessibleTasks])

  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const filtered = allTags.filter(t =>
    t.toLowerCase().includes(input.toLowerCase()) && !value.includes(t)
  )

  const add = (tag: string) => {
    const t = tag.trim().toLowerCase().replace(/\s+/g, '-')
    if (t && !value.includes(t)) onChange([...value, t])
    setInput('')
  }

  const remove = (tag: string) => onChange(value.filter(t => t !== tag))

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        onClick={() => { setOpen(true); (ref.current?.querySelector('input') as HTMLInputElement)?.focus() }}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '5px 8px', border: '1px solid var(--bd)', borderRadius: 'var(--r2)', background: 'var(--bg)', minHeight: 36, cursor: 'text', alignItems: 'center' }}
      >
        {value.map(tag => {
          const c = getTagColor(tag)
          return (
            <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 3, fontSize: 11, fontWeight: 500, background: c.bg, color: c.text }}>
              #{tag}
              <span onClick={e => { e.stopPropagation(); remove(tag) }} style={{ cursor: 'pointer', fontSize: 13, lineHeight: 1, opacity: .6, fontFamily: 'var(--font)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '.6'}
              >×</span>
            </span>
          )
        })}
        <input
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); e.stopPropagation(); if (input.trim()) add(input) }
            if (e.key === 'Backspace' && !input && value.length) remove(value[value.length - 1])
            if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
          }}
          placeholder={value.length ? '' : '태그 추가... (Enter로 생성)'}
          style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12, color: 'var(--t1)', fontFamily: 'var(--font)', minWidth: 100, flex: 1 }}
        />
      </div>

      {open && (filtered.length > 0 || (input.trim() && !allTags.includes(input.trim().toLowerCase()))) && (
        <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)', zIndex: 300, padding: '4px 0', maxHeight: 180, overflowY: 'auto' }}>
          {filtered.map(tag => {
            const c = getTagColor(tag)
            return (
              <div key={tag} onMouseDown={e => { e.preventDefault(); add(tag) }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 12, transition: 'background .07s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 11, background: c.bg, color: c.text, fontWeight: 500 }}>#{tag}</span>
              </div>
            )
          })}
          {input.trim() && !allTags.includes(input.trim().toLowerCase().replace(/\s+/g, '-')) && (
            <div onMouseDown={e => { e.preventDefault(); add(input) }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--ac)', transition: 'background .07s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ fontSize: 11, fontWeight: 500 }}>+</span>
              "#{input.trim()}" 새 태그 생성
            </div>
          )}
        </div>
      )}
    </div>
  )
}
