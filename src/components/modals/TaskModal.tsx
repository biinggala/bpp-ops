import { useState, useEffect, useRef, useMemo } from 'react'
import { isComposing } from '../../lib/utils'
import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { useProjectStore } from '../../store/projectStore'
import { useMilestoneStore } from '../../store/milestoneStore'
import { useAccessibleTasks } from '../../hooks/useAccessibleTasks'
import { useAuthStore } from '../../store/authStore'
import { useUserProfileStore } from '../../store/userProfileStore'
import { useMobile } from '../../hooks/useMobile'
import { STATUS_LIST, PRIORITY_LIST, getTagColor } from '../../types'
import type { Task } from '../../types'

const EMPTY: Omit<Task, 'id'> = {
  type: '상위', name: '', cat: '', assignee: '',
  start: '', due: '', priority: '중간', status: '대기', progress: 0, memo: '',
}

export function TaskModal() {
  const { isTaskModalOpen, editTaskId, newTaskParentId, newTaskMilestoneId, newTaskProjectId, closeTaskModal, projectId: uiProjectId } = useUiStore()
  const { tasks, addTask, updateTask } = useTaskStore()
  const allProjects = useProjectStore(s => s.projects)
  const milestones = useMilestoneStore(s => s.milestones)
  const email = useAuthStore(s => s.email)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const isMobile = useMobile()

  const projects = allProjects.filter(p =>
    true
  )
  const [form, setForm] = useState<Omit<Task, 'id'>>(EMPTY)

  // Fallback: union of all accessible project members (never exposes global profiles)
  const accessibleMemberEmails = useMemo(() => {
    const s = new Set<string>()
    projects.forEach(p => p.memberEmails?.forEach(e => s.add(e)))
    return Array.from(s)
  }, [projects])

  const assigneeOptions = useMemo(() => {
    const selectedProject = projects.find(p => p.id === form.projectId)
    const memberEmails = selectedProject?.memberEmails ?? []
    if (memberEmails.length > 0) {
      return memberEmails.map(e => ({ value: e, label: getNameByEmail(e) }))
    }
    return accessibleMemberEmails.map(e => ({ value: e, label: getNameByEmail(e) }))
  }, [form.projectId, projects, accessibleMemberEmails, getNameByEmail])

  const editing = editTaskId ? tasks.find(t => t.id === editTaskId) : null
  const parentTask = newTaskParentId ? tasks.find(t => t.id === newTaskParentId) : null

  useEffect(() => {
    if (!isTaskModalOpen) return
    if (editing) {
      setForm({ ...editing })
    } else {
      const defaultCat = parentTask?.cat ?? ''
      const defaultProjectId = parentTask?.projectId ?? newTaskProjectId ?? uiProjectId ?? undefined
      const defaultMilestoneId = parentTask?.milestoneId ?? newTaskMilestoneId ?? undefined
      setForm({
        ...EMPTY,
        cat: defaultCat,
        type: newTaskParentId ? '세부' : EMPTY.type,
        ...(newTaskParentId ? { parentId: newTaskParentId } : {}),
        ...(defaultProjectId ? { projectId: defaultProjectId } : {}),
        ...(defaultMilestoneId ? { milestoneId: defaultMilestoneId } : {}),
      })
    }
  }, [isTaskModalOpen, editTaskId])

  if (!isTaskModalOpen) return null

  const upd = <K extends keyof Omit<Task, 'id'>>(k: K, v: Omit<Task, 'id'>[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const submit = () => {
    if (!form.name.trim()) return
    if (editing) updateTask(editing.id, form)
    else addTask({ ...form, createdBy: email ?? undefined })
    closeTaskModal()
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) closeTaskModal() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}
    >
      <div style={{
        background: 'var(--bg)', borderRadius: isMobile ? 0 : 'var(--r4)',
        width: isMobile ? '100%' : 560, maxHeight: isMobile ? '100%' : '88vh',
        height: isMobile ? '100%' : undefined,
        overflow: 'auto', display: 'flex', flexDirection: 'column',
        boxShadow: isMobile ? 'none' : '0 24px 64px rgba(0,0,0,.18), 0 0 0 1px var(--bd)',
      }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)' }}>
              {editing ? '업무 수정' : parentTask ? '하위 업무 추가' : '새 업무'}
            </div>
            {parentTask && !editing && (
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
                ↳ {parentTask.name}
              </div>
            )}
          </div>
          <CloseBtn onClick={closeTaskModal} />
        </div>

        {/* Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="업무명">
            <input
              autoFocus
              style={inputStyle}
              value={form.name}
              onChange={e => upd('name', e.target.value)}
              placeholder="업무명을 입력하세요"
              onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) submit() }}
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="유형">
              <select style={inputStyle} value={form.type} onChange={e => upd('type', e.target.value as Task['type'])}>
                <option value="상위">상위</option>
                <option value="세부">세부</option>
              </select>
            </Field>

            <Field label="프로젝트">
              <select
                style={inputStyle}
                value={form.projectId ?? ''}
                onChange={e => {
                  upd('projectId', e.target.value || undefined)
                  upd('milestoneId', undefined)
                }}
              >
                <option value="">선택 안 함</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>

            {form.projectId && milestones.some(m => m.projectId === form.projectId) && (
              <Field label="마일스톤">
                <select
                  style={inputStyle}
                  value={form.milestoneId ?? ''}
                  onChange={e => upd('milestoneId', e.target.value || undefined)}
                >
                  <option value="">선택 안 함</option>
                  {milestones
                    .filter(m => m.projectId === form.projectId)
                    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                    .map(m => <option key={m.id} value={m.id}>◆ {m.name}  ({m.dueDate})</option>)
                  }
                </select>
              </Field>
            )}

            <Field label="상태">
              <select style={inputStyle} value={form.status} onChange={e => upd('status', e.target.value as Task['status'])}>
                {STATUS_LIST.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>

            <Field label="우선순위">
              <select style={inputStyle} value={form.priority} onChange={e => upd('priority', e.target.value as Task['priority'])}>
                {PRIORITY_LIST.map(p => <option key={p}>{p}</option>)}
              </select>
            </Field>

            <Field label="시작일">
              <input style={inputStyle} type="date" value={form.start} onChange={e => upd('start', e.target.value)} />
            </Field>

            <Field label="마감일">
              <input style={inputStyle} type="date" value={form.due} onChange={e => upd('due', e.target.value)} />
            </Field>
          </div>

          <Field label="담당자">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {assigneeOptions.map(({ value, label }) => {
                const on = form.assignee.split(',').map(s => s.trim()).includes(value)
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      const keys = form.assignee.split(',').map(s => s.trim()).filter(Boolean)
                      upd('assignee', on ? keys.filter(k => k !== value).join(',') : [...keys, value].join(','))
                    }}
                    style={{ padding: '5px 14px', borderRadius: 'var(--r2)', fontSize: 12, fontWeight: 500, cursor: 'pointer', border: `1px solid ${on ? 'var(--ac)' : 'var(--bd)'}`, background: on ? 'var(--ac)' : 'transparent', color: on ? '#fff' : 'var(--t2)', transition: 'all .1s', fontFamily: 'var(--font)' }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label={`진행률  ${form.progress}%`}>
            <input
              type="range" min={0} max={100} step={5}
              value={form.progress}
              onChange={e => upd('progress', Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--ac)' }}
            />
          </Field>

          <Field label="메모">
            <textarea
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.65 }}
              rows={3}
              value={form.memo}
              onChange={e => upd('memo', e.target.value)}
              placeholder="메모..."
            />
          </Field>

          <Field label="태그">
            <TagInput
              value={form.tags ?? []}
              onChange={tags => upd('tags', tags)}
            />
          </Field>

          {editing && (
            <>
              <Field label="선행 태스크 (Blocked by)">
                <DependencyPicker
                  type="blockedBy"
                  taskId={editing.id}
                  selected={form.blockedBy ?? []}
                  onChange={ids => upd('blockedBy', ids)}
                />
              </Field>
              <Field label="후행 태스크 (Blocking)">
                <DependencyPicker
                  type="blocking"
                  taskId={editing.id}
                  selected={form.blocking ?? []}
                  onChange={ids => upd('blocking', ids)}
                />
              </Field>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--bd)', display: 'flex', gap: 8, justifyContent: 'flex-end', position: 'sticky', bottom: 0, background: 'var(--bg)' }}>
          <button onClick={closeTaskModal} style={{ padding: '6px 14px', borderRadius: 'var(--r2)', border: '1px solid var(--bd)', background: 'transparent', fontSize: 13, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)' }}>
            취소
          </button>
          <button
            onClick={submit}
            style={{ padding: '6px 16px', borderRadius: 'var(--r2)', border: 'none', background: 'var(--ac)', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font)' }}
          >
            {editing ? '저장' : '추가'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--t3)', letterSpacing: '.03em' }}>{label}</div>
      {children}
    </div>
  )
}

function CloseBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ marginLeft: 'auto', width: 26, height: 26, borderRadius: 'var(--r1)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--t3)', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, fontFamily: 'var(--font)' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t1)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
    >
      ×
    </button>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px',
  border: '1px solid var(--bd)', borderRadius: 'var(--r2)',
  fontSize: 13, outline: 'none', color: 'var(--t1)',
  background: 'var(--bg)', fontFamily: 'var(--font)',
  transition: 'border-color .1s',
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
        style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '5px 8px', border: '1px solid var(--bd)', borderRadius: 'var(--r2)', background: 'var(--bg)', minHeight: 38, cursor: 'text', alignItems: 'center' }}
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
            if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); if (input.trim()) add(input) }
            if (e.key === 'Backspace' && !input && value.length) remove(value[value.length - 1])
            if (e.key === 'Escape') setOpen(false)
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

// ── DependencyPicker ──────────────────────────────────────────────────────────

function DependencyPicker({ taskId, type, selected, onChange }: {
  taskId: string
  type: 'blocking' | 'blockedBy'
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const accessibleTasks = useAccessibleTasks()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const candidates = accessibleTasks.filter(t =>
    t.id !== taskId &&
    !selected.includes(t.id) &&
    (query === '' || t.name.toLowerCase().includes(query.toLowerCase()))
  )

  const selectedTasks = accessibleTasks.filter(t => selected.includes(t.id))

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const add = (id: string) => { onChange([...selected, id]); setQuery('') }
  const remove = (id: string) => onChange(selected.filter(s => s !== id))

  const depColor = type === 'blockedBy' ? '#ef4444' : '#f59e0b'
  const depIcon = type === 'blockedBy' ? '⛔' : '⚡'

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {selectedTasks.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {selectedTasks.map(t => (
            <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 'var(--r2)', fontSize: 11, background: depColor + '14', border: `1px solid ${depColor}30`, color: depColor }}>
              {depIcon} {t.name}
              <span onClick={() => remove(t.id)} style={{ cursor: 'pointer', fontSize: 13, opacity: .6 }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '.6'}
              >×</span>
            </span>
          ))}
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="태스크 검색..."
          style={{ ...inputStyle, fontSize: 12 }}
        />
        {open && candidates.length > 0 && (
          <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)', zIndex: 300, padding: '4px 0', maxHeight: 200, overflowY: 'auto' }}>
            {candidates.slice(0, 20).map(t => (
              <div key={t.id} onMouseDown={e => { e.preventDefault(); add(t.id) }}
                style={{ padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--t1)', transition: 'background .07s', display: 'flex', alignItems: 'center', gap: 8 }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.cat || '—'}</span>
                {t.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
