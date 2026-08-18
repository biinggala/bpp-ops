import React, { useState, useMemo } from 'react'
import { isComposing } from '../../../lib/utils'
import { useProjectStore } from '../../../store/projectStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { useTaskStore } from '../../../store/taskStore'
import { useUiStore } from '../../../store/uiStore'
import type { Project, Milestone, Task } from '../../../types'

const MEMBER_LABELS: Record<string, string> = { YL: '이연주', SJ: '정세운', HC: '최희건' }

function today(): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d
}

function daysFrom(date: string, base: Date): number {
  return Math.round((new Date(date).setHours(0, 0, 0, 0) - base.getTime()) / 86400000)
}

export function ProjectView() {
  const { projects } = useProjectStore()
  const { milestones, addMilestone, updateMilestone, deleteMilestone } = useMilestoneStore()
  const tasks = useTaskStore(s => s.tasks)
  const { openTaskModal, setProject } = useUiStore()
  const now = useMemo(today, [])

  if (projects.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--t3)' }}>
        <div style={{ fontSize: 28, opacity: .4 }}>◈</div>
        <div style={{ fontSize: 14 }}>아직 프로젝트가 없습니다</div>
        <div style={{ fontSize: 12 }}>사이드바에서 프로젝트를 추가하세요</div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24, background: 'var(--bg)' }}>
      <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {projects.map(project => {
          const projectTasks = tasks.filter(t => t.projectId === project.id && !t.parentId)
          const projectMilestones = milestones
            .filter(m => m.projectId === project.id)
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
          const completed = projectTasks.filter(t => t.status === '완료').length
          const progress = projectTasks.length ? Math.round(completed / projectTasks.length * 100) : 0

          const bottleneck = projectTasks.filter(t => {
            if (t.status === '완료') return false
            const overdue = t.due ? daysFrom(t.due, now) < 0 : false
            const closeMilestone = t.milestoneId
              ? (() => {
                  const ms = projectMilestones.find(m => m.id === t.milestoneId)
                  if (!ms) return false
                  const d = daysFrom(ms.dueDate, now)
                  return d >= 0 && d <= 7
                })()
              : false
            return overdue || closeMilestone
          })

          return (
            <ProjectCard
              key={project.id}
              project={project}
              milestones={projectMilestones}
              tasks={projectTasks}
              completed={completed}
              progress={progress}
              bottleneck={bottleneck}
              now={now}
              onAddMilestone={(name, dueDate) => addMilestone(project.id, name, dueDate)}
              onUpdateMilestone={updateMilestone}
              onDeleteMilestone={deleteMilestone}
              onAddTask={() => { setProject(project.id); openTaskModal() }}
            />
          )
        })}
      </div>
    </div>
  )
}

function ProjectCard({
  project, milestones, tasks, completed, progress, bottleneck, now,
  onAddMilestone, onUpdateMilestone, onDeleteMilestone, onAddTask,
}: {
  project: Project; milestones: Milestone[]; tasks: Task[]
  completed: number; progress: number; bottleneck: Task[]; now: Date
  onAddMilestone: (name: string, dueDate: string) => void
  onUpdateMilestone: (id: string, patch: Partial<Omit<Milestone, 'id'>>) => void
  onDeleteMilestone: (id: string) => void
  onAddTask: () => void
}) {
  const [addingMs, setAddingMs] = useState(false)
  const [msName, setMsName] = useState('')
  const [msDue, setMsDue] = useState('')
  const [showBottleneck, setShowBottleneck] = useState(true)

  const dueInfo = project.dueDate
    ? (() => {
        const diff = daysFrom(project.dueDate, now)
        return { diff: Math.abs(diff), overdue: diff < 0 }
      })()
    : null

  const handleAddMs = () => {
    if (msName.trim() && msDue) onAddMilestone(msName.trim(), msDue)
    setMsName(''); setMsDue(''); setAddingMs(false)
  }

  return (
    <div style={{ background: 'var(--bg2)', borderRadius: 'var(--r4)', border: '1px solid var(--bd)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: project.color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)' }}>{project.name}</span>
            {project.clientName && (
              <span style={{ fontSize: 12, color: 'var(--t3)' }}>{project.clientName}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--t3)' }}>{completed}/{tasks.length} 완료</span>
          {dueInfo && (
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 'var(--r1)',
              background: dueInfo.overdue ? 'rgba(212,76,71,.1)' : 'rgba(139,92,246,.1)',
              color: dueInfo.overdue ? '#D44C47' : '#9065B0',
            }}>
              {dueInfo.overdue ? `D+${dueInfo.diff}` : `D-${dueInfo.diff}`}
            </span>
          )}
          <button
            onClick={onAddTask}
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            + 업무
          </button>
        </div>
      </div>

      {/* Progress */}
      <div style={{ padding: '10px 18px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 5, background: 'var(--bd)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: project.color, borderRadius: 3, transition: 'width .3s' }} />
        </div>
        <span style={{ fontSize: 11, color: 'var(--t3)', width: 32, textAlign: 'right', flexShrink: 0 }}>{progress}%</span>
      </div>

      {/* Milestones */}
      <div style={{ padding: '10px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 500 }}>마일스톤</span>
          {milestones.map(m => (
            <EditableMilestoneChip
              key={m.id}
              milestone={m}
              now={now}
              onUpdate={(patch) => onUpdateMilestone(m.id, patch)}
              onDelete={() => onDeleteMilestone(m.id)}
            />
          ))}

          {addingMs ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                autoFocus
                placeholder="마일스톤 이름"
                value={msName}
                onChange={e => setMsName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) handleAddMs(); if (e.key === 'Escape') setAddingMs(false) }}
                style={{ padding: '3px 7px', fontSize: 11, border: '1px solid var(--bd)', borderRadius: 'var(--r1)', background: 'var(--bg)', color: 'var(--t1)', outline: 'none', width: 130, fontFamily: 'var(--font)' }}
              />
              <input
                type="date"
                value={msDue}
                onChange={e => setMsDue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) handleAddMs(); if (e.key === 'Escape') setAddingMs(false) }}
                style={{ padding: '3px 7px', fontSize: 11, border: '1px solid var(--bd)', borderRadius: 'var(--r1)', background: 'var(--bg)', color: 'var(--t1)', outline: 'none', colorScheme: 'dark', fontFamily: 'var(--font)' }}
              />
              <button onClick={handleAddMs} style={{ padding: '3px 8px', fontSize: 11, borderRadius: 'var(--r1)', border: 'none', background: 'var(--ac)', color: '#fff', cursor: 'pointer', fontFamily: 'var(--font)' }}>추가</button>
              <button onClick={() => setAddingMs(false)} style={{ padding: '3px 8px', fontSize: 11, borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)' }}>취소</button>
            </div>
          ) : (
            <button
              onClick={() => setAddingMs(true)}
              style={{ padding: '3px 8px', fontSize: 11, borderRadius: 'var(--r2)', border: '1px dashed var(--bd)', background: 'transparent', color: 'var(--t3)', cursor: 'pointer', fontFamily: 'var(--font)' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--t2)'; e.currentTarget.style.borderColor = 'var(--bd2, var(--t3))' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.borderColor = 'var(--bd)' }}
            >
              + 마일스톤
            </button>
          )}
        </div>
      </div>

      {/* Bottleneck */}
      {bottleneck.length > 0 && (
        <div style={{ borderTop: '1px solid var(--bd)' }}>
          <button
            onClick={() => setShowBottleneck(v => !v)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font)' }}
          >
            <span style={{ fontSize: 10 }}>⚠</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#D44C47' }}>병목 태스크 ({bottleneck.length})</span>
            <span style={{ fontSize: 9, color: 'var(--t3)', marginLeft: 'auto' }}>{showBottleneck ? '▾' : '▸'}</span>
          </button>
          {showBottleneck && (
            <div style={{ padding: '0 18px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {bottleneck.map(t => {
                const overdue = t.due ? daysFrom(t.due, now) < 0 : false
                const ms = t.milestoneId ? milestones.find(m => m.id === t.milestoneId) : null
                const assignees = t.assignee.split(',').filter(Boolean)
                return (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 'var(--r2)', background: 'rgba(212,76,71,.05)', border: '1px solid rgba(212,76,71,.12)' }}>
                    <span style={{ fontSize: 10, color: '#D44C47', flexShrink: 0 }}>⚠</span>
                    <span style={{ flex: 1, fontSize: 12, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                    {overdue && t.due && (
                      <span style={{ fontSize: 10, color: '#D44C47', flexShrink: 0 }}>
                        {Math.abs(daysFrom(t.due, now))}일 초과
                      </span>
                    )}
                    {ms && !overdue && (
                      <span style={{ fontSize: 10, color: '#D9730D', flexShrink: 0 }}>◆ {ms.name}</span>
                    )}
                    {assignees.length > 0 && (
                      <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>
                        {assignees.map(k => MEMBER_LABELS[k] ?? k).join(' · ')}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── EditableMilestoneChip ────────────────────────────────────────────────────

function EditableMilestoneChip({ milestone, now, onUpdate, onDelete }: {
  milestone: Milestone; now: Date
  onUpdate: (patch: Partial<Omit<Milestone, 'id'>>) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [tempName, setTempName] = useState(milestone.name)
  const [tempDate, setTempDate] = useState(milestone.dueDate)

  const diff = daysFrom(milestone.dueDate, now)
  const overdue = diff < 0
  const close = diff >= 0 && diff <= 7
  const accent = overdue ? '#D44C47' : close ? '#D9730D' : 'var(--t2)'
  const bg = overdue ? 'rgba(212,76,71,.08)' : close ? 'rgba(217,115,13,.08)' : 'var(--bg3)'
  const border = overdue ? 'rgba(212,76,71,.2)' : close ? 'rgba(217,115,13,.2)' : 'var(--bd)'

  const save = () => {
    if (tempName.trim()) onUpdate({ name: tempName.trim() })
    if (tempDate) onUpdate({ dueDate: tempDate })
    setEditing(false)
  }
  const cancel = () => { setTempName(milestone.name); setTempDate(milestone.dueDate); setEditing(false) }

  const inp: React.CSSProperties = {
    padding: '2px 6px', fontSize: 11, border: '1px solid var(--bd)',
    borderRadius: 'var(--r1)', background: 'var(--bg)', color: 'var(--t1)',
    outline: 'none', fontFamily: 'var(--font)',
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input
          autoFocus
          value={tempName}
          onChange={e => setTempName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) save(); if (e.key === 'Escape') cancel() }}
          style={{ ...inp, width: 120 }}
        />
        <input
          type="date"
          value={tempDate}
          onChange={e => setTempDate(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) save(); if (e.key === 'Escape') cancel() }}
          style={{ ...inp, colorScheme: 'dark' }}
        />
        <button onClick={save} style={{ padding: '2px 7px', fontSize: 11, borderRadius: 'var(--r1)', border: 'none', background: 'var(--ac)', color: '#fff', cursor: 'pointer', fontFamily: 'var(--font)' }}>✓</button>
        <button onClick={cancel} style={{ padding: '2px 7px', fontSize: 11, borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)' }}>✕</button>
      </div>
    )
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 'var(--r2)', fontSize: 11, background: bg, border: `1px solid ${border}`, color: accent }}
    >
      <span style={{ fontSize: 8 }}>◆</span>
      <span>{milestone.name}</span>
      <span style={{ opacity: .65 }}>{overdue ? `D+${Math.abs(diff)}` : `D-${diff}`}</span>
      {hovered && (
        <button
          onClick={() => { setTempName(milestone.name); setTempDate(milestone.dueDate); setEditing(true) }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: .55, fontSize: 11, padding: 0, lineHeight: 1, fontFamily: 'var(--font)' }}
          onMouseEnter={e => e.currentTarget.style.opacity = '1'}
          onMouseLeave={e => e.currentTarget.style.opacity = '.55'}
        >✎</button>
      )}
      <button
        onClick={onDelete}
        style={{ marginLeft: hovered ? 0 : 2, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: .45, fontSize: 13, padding: 0, lineHeight: 1, fontFamily: 'var(--font)' }}
        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
        onMouseLeave={e => e.currentTarget.style.opacity = '.45'}
      >×</button>
    </div>
  )
}
