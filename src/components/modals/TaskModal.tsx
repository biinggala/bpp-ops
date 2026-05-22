import { useState, useEffect } from 'react'
import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { useSpaceStore } from '../../store/spaceStore'
import { useProjectStore } from '../../store/projectStore'
import { useMilestoneStore } from '../../store/milestoneStore'
import { STATUS_LIST, PRIORITY_LIST } from '../../types'
import type { Task } from '../../types'

const EMPTY: Omit<Task, 'id'> = {
  type: '세부', name: '', cat: '', assignee: '',
  start: '', due: '', priority: '중간', status: '대기', progress: 0, memo: '',
}

export function TaskModal() {
  const { isTaskModalOpen, editTaskId, newTaskParentId, newTaskMilestoneId, closeTaskModal, space, projectId: uiProjectId } = useUiStore()
  const { tasks, addTask, updateTask } = useTaskStore()
  const spaces = useSpaceStore(s => s.spaces)
  const projects = useProjectStore(s => s.projects)
  const milestones = useMilestoneStore(s => s.milestones)
  const [form, setForm] = useState<Omit<Task, 'id'>>(EMPTY)

  const editing = editTaskId ? tasks.find(t => t.id === editTaskId) : null
  const parentTask = newTaskParentId ? tasks.find(t => t.id === newTaskParentId) : null

  useEffect(() => {
    if (!isTaskModalOpen) return
    if (editing) {
      setForm({ ...editing })
    } else {
      const defaultCat = parentTask?.cat ?? space ?? spaces[0]?.name ?? ''
      const defaultProjectId = parentTask?.projectId ?? uiProjectId ?? undefined
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
    else addTask(form)
    closeTaskModal()
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) closeTaskModal() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}
    >
      <div style={{ background: 'var(--bg)', borderRadius: 'var(--r4)', width: 560, maxHeight: '88vh', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.18), 0 0 0 1px var(--bd)', display: 'flex', flexDirection: 'column' }}>

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
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="유형">
              <select style={inputStyle} value={form.type} onChange={e => upd('type', e.target.value as Task['type'])}>
                <option value="상위">상위</option>
                <option value="세부">세부</option>
              </select>
            </Field>

            <Field label="스페이스">
              {spaces.length > 0 ? (
                <select style={inputStyle} value={form.cat} onChange={e => upd('cat', e.target.value)}>
                  <option value="">선택 안 함</option>
                  {spaces.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              ) : (
                <div style={{ ...inputStyle, color: 'var(--t3)' }}>사이드바에서 스페이스를 먼저 추가하세요</div>
              )}
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
            <div style={{ display: 'flex', gap: 6 }}>
              {(['YL', 'SJ', 'HC'] as const).map(key => {
                const on = form.assignee.includes(key)
                const label = { YL: '이연주', SJ: '정세운', HC: '최희건' }[key]
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      const keys = form.assignee.split(',').filter(Boolean)
                      upd('assignee', on ? keys.filter(k => k !== key).join(',') : [...keys, key].join(','))
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
