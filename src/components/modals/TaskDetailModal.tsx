import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { useAuthStore } from '../../store/authStore'
import { usePresenceStore } from '../../store/presenceStore'
import { useProjectStore } from '../../store/projectStore'
import { useMilestoneStore } from '../../store/milestoneStore'
import { useUserProfileStore } from '../../store/userProfileStore'
import { useMobile } from '../../hooks/useMobile'
import { AssigneeAvatar } from '../shared/Avatar'
import {
  FileRow, DriveSearch, UrlAdd, AttachTabs,
  useResolvedLinks, useProjectFolderId, driveIdOf, linkFromDriveFile,
} from '../shared/DriveFiles'
import { DateField } from '../shared/DatePicker'
import { STATUS_LIST, PRIORITY_LIST } from '../../types'
import type { Task, Status, Priority, TaskLink } from '../../types'
import { isComposing } from '../../lib/utils'

const SIDEBAR_KEY = 'cringe_detail_sidebar_w'
const MIN_SIDEBAR = 200
const MAX_SIDEBAR = 480

const STATUS_STYLE: Record<Status, { bg: string; color: string }> = {
  '진행중': { bg: 'rgba(35,131,226,.15)', color: '#487CA5' },
  '대기':   { bg: 'rgba(120,117,114,.14)', color: '#5a5857' },
  '검토중': { bg: '#fef3c7',              color: '#D9730D' },
  '완료':   { bg: '#d1fae5',              color: '#448361' },
}
const PRIORITY_STYLE: Record<Priority, { bg: string; color: string }> = {
  '높음': { bg: 'rgba(212,76,71,.13)',  color: '#D44C47' },
  '중간': { bg: 'rgba(217,115,13,.14)', color: '#D9730D' },
  '낮음': { bg: 'rgba(59,130,246,.13)', color: '#1d4ed8' },
}

/* ── Shared helpers ── */

function ColoredSelect<T extends string>({
  value, options, styles, onChange,
}: {
  value: T
  options: T[]
  styles: Record<T, { bg: string; color: string }>
  onChange: (v: T) => void
}) {
  const s = styles[value]
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <span style={{
        padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
        background: s.bg, color: s.color, pointerEvents: 'none', whiteSpace: 'nowrap',
      }}>{value}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value as T)}
        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%', border: 'none' }}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--bd)' }}>
      <span style={{ width: 72, fontSize: 12, color: 'var(--t3)', fontWeight: 500, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>{children}</div>
    </div>
  )
}

/* ── AssetsPanel — the task's materials ── */

/**
 * The files a task is made of, attached from Drive rather than described by a
 * URL somebody typed. See DriveFiles.tsx for what "aligned" is taken to mean.
 */
function AssetsPanel({ links, projectId, onChange }: {
  links: TaskLink[]
  projectId?: string
  onChange: (links: TaskLink[]) => void
}) {
  const [adding, setAdding] = useState(false)
  const [mode, setMode] = useState<'drive' | 'url'>('drive')
  const folderId = useProjectFolderId(projectId)
  const resolved = useResolvedLinks(links)
  const attachedIds = React.useMemo(
    () => new Set(links.map(driveIdOf).filter((v): v is string => !!v)),
    [links],
  )

  const add = (link: TaskLink) => onChange([...links, link])
  const remove = (id: string) => onChange(links.filter(l => l.id !== id))

  return (
    <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 12, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>자료</span>
        <button
          onClick={() => setAdding(a => !a)}
          title={adding ? '닫기' : '자료 추가'}
          style={{ width: 20, height: 20, borderRadius: 3, border: 'none', background: 'transparent', cursor: 'pointer', color: adding ? 'var(--ac)' : 'var(--t3)', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, fontFamily: 'var(--font)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t1)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = adding ? 'var(--ac)' : 'var(--t3)' }}
        >{adding ? '\u00d7' : '+'}</button>
      </div>

      {links.length === 0 && !adding && (
        <div style={{ fontSize: 12, color: 'var(--t3)' }}>자료 없음</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {links.map(l => (
          <FileRow key={l.id} link={l} file={resolved.get(driveIdOf(l) ?? '')} onRemove={() => remove(l.id)} />
        ))}
      </div>

      {adding && (
        <div style={{
          marginTop: 8, padding: 4, borderRadius: 'var(--r3)',
          border: '1px solid var(--bd)', background: 'var(--bg)',
          display: 'flex', flexDirection: 'column', maxHeight: 300, overflow: 'hidden',
        }}>
          <AttachTabs mode={mode} onChange={setMode} />
          {mode === 'drive'
            ? <DriveSearch folderId={folderId} attachedIds={attachedIds} onPick={f => add(linkFromDriveFile(f))} onClose={() => setAdding(false)} />
            : <UrlAdd onAdd={add} />}
        </div>
      )}
    </div>
  )
}

/* ── Editor Toolbar ── */

function ToolBtn({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} style={{
      padding: '3px 7px', borderRadius: 4, border: 'none', cursor: 'pointer',
      fontSize: 12, fontWeight: active ? 600 : 400, fontFamily: 'var(--font)',
      background: active ? 'var(--bg4)' : 'transparent',
      color: active ? 'var(--t1)' : 'var(--t2)',
    }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg3)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = active ? 'var(--bg4)' : 'transparent' }}
    >{children}</button>
  )
}

function ToolDivider() {
  return <div style={{ width: 1, height: 16, background: 'var(--bd2)', margin: '0 3px' }} />
}

function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> | null }) {
  if (!editor) return null
  const e = editor
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 1, padding: '6px 16px', borderBottom: '1px solid var(--bd)', background: 'var(--bg2)', flexWrap: 'wrap', flexShrink: 0 }}>
      <ToolBtn active={e.isActive('bold')} onClick={() => e.chain().focus().toggleBold().run()} title="굵게 (⌘B)"><b>B</b></ToolBtn>
      <ToolBtn active={e.isActive('italic')} onClick={() => e.chain().focus().toggleItalic().run()} title="기울임 (⌘I)"><i>I</i></ToolBtn>
      <ToolBtn active={e.isActive('strike')} onClick={() => e.chain().focus().toggleStrike().run()} title="취소선"><s>S</s></ToolBtn>
      <ToolBtn active={e.isActive('highlight')} onClick={() => e.chain().focus().toggleHighlight().run()} title="형광펜">Mark</ToolBtn>
      <ToolDivider />
      <ToolBtn active={e.isActive('heading', { level: 1 })} onClick={() => e.chain().focus().toggleHeading({ level: 1 }).run()} title="제목 1">H1</ToolBtn>
      <ToolBtn active={e.isActive('heading', { level: 2 })} onClick={() => e.chain().focus().toggleHeading({ level: 2 }).run()} title="제목 2">H2</ToolBtn>
      <ToolBtn active={e.isActive('heading', { level: 3 })} onClick={() => e.chain().focus().toggleHeading({ level: 3 }).run()} title="제목 3">H3</ToolBtn>
      <ToolDivider />
      <ToolBtn active={e.isActive('bulletList')} onClick={() => e.chain().focus().toggleBulletList().run()} title="글머리 목록">• List</ToolBtn>
      <ToolBtn active={e.isActive('orderedList')} onClick={() => e.chain().focus().toggleOrderedList().run()} title="번호 목록">1. List</ToolBtn>
      <ToolBtn active={e.isActive('taskList')} onClick={() => e.chain().focus().toggleTaskList().run()} title="체크리스트">☑ Todo</ToolBtn>
      <ToolDivider />
      <ToolBtn active={e.isActive('blockquote')} onClick={() => e.chain().focus().toggleBlockquote().run()} title="인용">&ldquo;</ToolBtn>
      <ToolBtn active={e.isActive('codeBlock')} onClick={() => e.chain().focus().toggleCodeBlock().run()} title="코드 블록">```</ToolBtn>
      <ToolDivider />
      <ToolBtn active={false} onClick={() => e.chain().focus().undo().run()} title="실행취소 (⌘Z)">↩</ToolBtn>
      <ToolBtn active={false} onClick={() => e.chain().focus().redo().run()} title="다시실행 (⌘⇧Z)">↪</ToolBtn>
    </div>
  )
}

/* ── Mobile icons ── */

const IcStatus = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="10" r="8" stroke="var(--ac)" strokeWidth="1.5"/>
    <path d="M10 2a8 8 0 0 1 0 16z" fill="var(--ac)"/>
  </svg>
)
const IcUser = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="7" r="3.5" stroke="var(--t3)" strokeWidth="1.5"/>
    <path d="M3 18c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="var(--t3)" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IcFlag = ({ color }: { color?: string }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M5 2v16M5 2h10l-3 5 3 5H5" stroke={color || 'var(--t3)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const IcCalendar = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <rect x="2" y="4" width="16" height="14" rx="2" stroke="var(--t3)" strokeWidth="1.5"/>
    <path d="M6 2v3M14 2v3M2 9h16" stroke="var(--t3)" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IcDiamond = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M10 3L17 10L10 17L3 10L10 3Z" stroke="#9065B0" strokeWidth="1.5"/>
  </svg>
)
const IcProgress = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="10" r="8" stroke="var(--t3)" strokeWidth="1.5"/>
    <path d="M10 2a8 8 0 0 1 0 8z" fill="var(--t3)"/>
  </svg>
)
const IcDoc = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <rect x="4" y="2" width="12" height="16" rx="2" stroke="var(--t3)" strokeWidth="1.5"/>
    <path d="M7 7h6M7 10h6M7 13h4" stroke="var(--t3)" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)

/* ── Mobile prop row ── */

function MobilePropRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: '1px solid var(--bd)' }}>
      <div style={{ width: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--t1)' }}>{children}</div>
      </div>
    </div>
  )
}

/* ── Mobile Task Detail ── */

type MobileProps = {
  task: Task
  onClose: () => void
  editor: ReturnType<typeof useEditor> | null
  saveStatus: 'saved' | 'saving'
  upd: (patch: Partial<Task>) => void
  milestones: { id: string; projectId: string; name: string; dueDate: string }[]
  projects: { id: string; name: string; color: string; memberEmails?: string[] }[]
  assigneeOptions: { value: string; label: string }[]
}

function MobileTaskDetail({ task, onClose, editor, saveStatus, upd, milestones, projects, assigneeOptions }: MobileProps) {
  const [tab, setTab] = useState<'details' | 'activity'>('details')
  const [notesOpen, setNotesOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(task.name)
  const titleRef = useRef<HTMLTextAreaElement>(null)

  const currentProject = projects.find(p => p.id === task.projectId)
  const currentMilestone = milestones.find(m => m.id === task.milestoneId)
  const taskMilestones = milestones.filter(m => m.projectId === task.projectId)

  const statusStyle = STATUS_STYLE[task.status]
  const priorityStyle = task.priority ? PRIORITY_STYLE[task.priority] : null

  const formatDate = (d: string | undefined) => {
    if (!d) return ''
    const [, m, day] = d.split('-')
    return `${Number(m)}/${Number(day)}`
  }

  const datesLabel = (() => {
    if (task.start && task.due) return `${formatDate(task.start)} - ${formatDate(task.due)}`
    if (task.due) return `~ ${formatDate(task.due)}`
    if (task.start) return `${formatDate(task.start)} ~`
    return '없음'
  })()

  const hasMemo = task.memo && task.memo !== '<p></p>' && task.memo.trim() !== ''

  // Auto-resize title textarea
  useEffect(() => {
    if (editingTitle && titleRef.current) {
      titleRef.current.style.height = 'auto'
      titleRef.current.style.height = titleRef.current.scrollHeight + 'px'
      titleRef.current.focus()
      titleRef.current.select()
    }
  }, [editingTitle])

  return (
    <>
      {/* Main mobile detail view */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'var(--bg)', display: 'flex', flexDirection: 'column',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}>
        {/* Header bar */}
        <div style={{ height: 52, display: 'flex', alignItems: 'center', padding: '0 8px 0 4px', gap: 4, flexShrink: 0 }}>
          <button
            onClick={onClose}
            style={{ width: 44, height: 44, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--t2)', fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10 }}
          >
            ‹
          </button>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 11, color: saveStatus === 'saving' ? 'var(--ac)' : 'var(--t3)', paddingRight: 8 }}>
            {saveStatus === 'saving' ? '저장 중...' : '저장됨'}
          </div>
        </div>

        {/* Title area */}
        <div style={{ padding: '4px 20px 16px', flexShrink: 0 }}>
          {currentProject && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 12, color: 'var(--t3)' }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: currentProject.color, flexShrink: 0 }} />
              <span>{currentProject.name}</span>
              {currentMilestone && (
                <><span style={{ opacity: .4 }}>/</span><span style={{ color: '#9065B0' }}>◆ {currentMilestone.name}</span></>
              )}
            </div>
          )}
          {editingTitle ? (
            <textarea
              ref={titleRef}
              value={titleValue}
              onChange={e => {
                setTitleValue(e.target.value)
                e.currentTarget.style.height = 'auto'
                e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px'
              }}
              onBlur={() => { upd({ name: titleValue.trim() || task.name }); setEditingTitle(false) }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); upd({ name: titleValue.trim() || task.name }); setEditingTitle(false) }
                if (e.key === 'Escape') setEditingTitle(false)
              }}
              style={{
                width: '100%', fontSize: 22, fontWeight: 700, lineHeight: 1.3,
                border: 'none', outline: 'none', background: 'transparent',
                color: 'var(--t1)', fontFamily: 'var(--font)', resize: 'none', overflow: 'hidden',
                boxSizing: 'border-box', padding: 0,
              }}
              rows={1}
            />
          ) : (
            <h1
              onClick={() => { setTitleValue(task.name); setEditingTitle(true) }}
              style={{ fontSize: 22, fontWeight: 700, color: 'var(--t1)', lineHeight: 1.3, cursor: 'text', margin: 0 }}
            >
              {task.name}
            </h1>
          )}
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
          {(['details', 'activity'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, height: 44, border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: 14, fontWeight: tab === t ? 600 : 400,
              color: tab === t ? 'var(--t1)' : 'var(--t3)',
              fontFamily: 'var(--font)',
              borderBottom: tab === t ? '2px solid var(--ac)' : '2px solid transparent',
              transition: 'color .1s, border-color .1s',
            }}>
              {t === 'details' ? 'Details' : 'Activity'}
            </button>
          ))}
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>

          {tab === 'details' && (
            <>
              {/* Status */}
              <MobilePropRow icon={<IcStatus />} label="Status">
                <div style={{ position: 'relative', display: 'inline-flex' }}>
                  <span style={{ padding: '3px 12px', borderRadius: 12, fontSize: 13, fontWeight: 600, background: statusStyle.bg, color: statusStyle.color }}>
                    {task.status}
                  </span>
                  <select value={task.status} onChange={e => upd({ status: e.target.value as Status })}
                    style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%', border: 'none' }}>
                    {STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </MobilePropRow>

              {/* Assignees */}
              <MobilePropRow icon={<IcUser />} label="Assignees">
                <select value={task.assignee} onChange={e => upd({ assignee: e.target.value })}
                  style={{ border: 'none', background: 'transparent', fontSize: 14, cursor: 'pointer', outline: 'none', color: task.assignee ? 'var(--t1)' : 'var(--t3)', fontFamily: 'var(--font)', padding: 0, margin: 0, appearance: 'none', WebkitAppearance: 'none' }}>
                  <option value="">미배정</option>
                  {assigneeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </MobilePropRow>

              {/* Priority */}
              <MobilePropRow icon={<IcFlag color={priorityStyle?.color} />} label="Priority">
                {priorityStyle ? (
                  <div style={{ position: 'relative', display: 'inline-flex' }}>
                    <span style={{ padding: '3px 12px', borderRadius: 12, fontSize: 13, fontWeight: 600, background: priorityStyle.bg, color: priorityStyle.color }}>
                      {task.priority}
                    </span>
                    <select value={task.priority} onChange={e => upd({ priority: e.target.value as Priority })}
                      style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%', border: 'none' }}>
                      {PRIORITY_LIST.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                ) : (
                  <select value="" onChange={e => upd({ priority: e.target.value as Priority })}
                    style={{ border: 'none', background: 'transparent', fontSize: 14, cursor: 'pointer', outline: 'none', color: 'var(--t3)', fontFamily: 'var(--font)', padding: 0, appearance: 'none', WebkitAppearance: 'none' }}>
                    <option value="">없음</option>
                    {PRIORITY_LIST.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                )}
              </MobilePropRow>

              {/* Dates */}
              <MobilePropRow icon={<IcCalendar />} label="Dates">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <DateField value={task.start || ''} context={{ taskId: task.id, projectId: task.projectId, milestoneId: task.milestoneId, parentId: task.parentId, assignee: task.assignee, blockedBy: task.blockedBy }}
                    onChange={v => upd({ start: v || undefined })} placeholder="시작일" format="full" style={{ fontSize: 14 }} />
                  <span style={{ color: 'var(--t3)', fontSize: 12 }}>—</span>
                  <DateField value={task.due || ''} context={{ taskId: task.id, projectId: task.projectId, milestoneId: task.milestoneId, parentId: task.parentId, assignee: task.assignee, blockedBy: task.blockedBy }}
                    onChange={v => upd({ due: v || undefined })} placeholder="마감일" format="full" style={{ fontSize: 14 }} />
                </div>
              </MobilePropRow>

              {/* Milestone */}
              {currentProject && (
                <MobilePropRow icon={<IcDiamond />} label="Milestone">
                  <select value={task.milestoneId || ''} onChange={e => upd({ milestoneId: e.target.value || undefined })}
                    style={{ border: 'none', background: 'transparent', fontSize: 14, cursor: 'pointer', outline: 'none', color: task.milestoneId ? '#9065B0' : 'var(--t3)', fontFamily: 'var(--font)', padding: 0, appearance: 'none', WebkitAppearance: 'none' }}>
                    <option value="">없음</option>
                    {taskMilestones.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </MobilePropRow>
              )}

              {/* Progress */}
              <MobilePropRow icon={<IcProgress />} label="Progress">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                  <input type="range" min={0} max={100} step={5} value={task.progress}
                    onChange={e => upd({ progress: Number(e.target.value) })}
                    style={{ flex: 1, accentColor: 'var(--ac)', cursor: 'pointer' }} />
                  <span style={{ fontSize: 13, color: 'var(--t2)', minWidth: 36 }}>{task.progress}%</span>
                </div>
              </MobilePropRow>

              {/* Notes section */}
              <div style={{ height: 8, background: 'var(--bg2)', borderTop: '1px solid var(--bd)', borderBottom: '1px solid var(--bd)' }} />

              <div
                onClick={() => setNotesOpen(true)}
                style={{ display: 'flex', gap: 14, padding: '16px 20px', cursor: 'text', minHeight: 80 }}
              >
                <div style={{ width: 32, display: 'flex', justifyContent: 'center', flexShrink: 0, paddingTop: 2 }}>
                  <IcDoc />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>Notes</div>
                  {hasMemo ? (
                    <div
                      dangerouslySetInnerHTML={{ __html: task.memo! }}
                      className="task-editor-area"
                      style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--t1)', pointerEvents: 'none', overflow: 'hidden' }}
                    />
                  ) : (
                    <span style={{ fontSize: 14, color: 'var(--t3)' }}>내용 없음 — 탭하여 편집</span>
                  )}
                </div>
              </div>

              {/* Assets */}
              <div style={{ padding: '0 20px 24px', borderTop: '1px solid var(--bd)' }}>
                <AssetsPanel links={task.links ?? []} projectId={task.projectId} onChange={links => upd({ links })} />
              </div>
            </>
          )}

          {tab === 'activity' && (
            <div style={{ padding: '24px 20px' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', color: 'var(--t3)' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--bd2)', marginTop: 7, flexShrink: 0 }} />
                <span style={{ fontSize: 14 }}>태스크가 생성됐습니다.</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full-screen notes editor overlay */}
      {notesOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 201,
          background: 'var(--bg)', display: 'flex', flexDirection: 'column',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}>
          {/* Editor header */}
          <div style={{ height: 52, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
            <button
              onClick={() => setNotesOpen(false)}
              style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: 'var(--ac)', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#fff', fontFamily: 'var(--font)', flexShrink: 0 }}
            >
              완료
            </button>
            <span style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 600, color: 'var(--t1)' }}>메모</span>
            <span style={{ fontSize: 11, color: saveStatus === 'saving' ? 'var(--ac)' : '#10b981', minWidth: 44, textAlign: 'right' }}>
              {saveStatus === 'saving' ? '저장 중' : '저장됨'}
            </span>
          </div>

          <EditorToolbar editor={editor} />

          <div
            onClick={() => editor?.commands.focus()}
            style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '20px', cursor: 'text' }}
            className="task-editor-area"
          >
            <EditorContent editor={editor} />
          </div>
        </div>
      )}
    </>
  )
}

/* ── Main modal (shared, desktop + mobile) ── */

export function TaskDetailModal() {
  const { detailTaskId, closeTaskDetail } = useUiStore()
  const task = useTaskStore(s => s.tasks.find(t => t.id === detailTaskId))
  const { updateTask } = useTaskStore()
  const { uid, email: userEmail } = useAuthStore()
  const { presences, setCurrentTask } = usePresenceStore()
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const allProjects = useProjectStore(s => s.projects)
  // Only projects the current user is a member of
  const projects = allProjects.filter(p =>
    true
  )
  const milestones = useMilestoneStore(s => s.milestones)
  const isMobile = useMobile()

  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const saveTimer = useRef<number | null>(null)

  const [sidebarW, setSidebarW] = useState<number>(() => {
    const v = parseInt(localStorage.getItem(SIDEBAR_KEY) || '0')
    return v >= MIN_SIDEBAR && v <= MAX_SIDEBAR ? v : 320
  })

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarW
    let latestW = startW
    const onMove = (ev: MouseEvent) => {
      latestW = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startW + ev.clientX - startX))
      setSidebarW(latestW)
    }
    const onUp = () => {
      localStorage.setItem(SIDEBAR_KEY, String(latestW))
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [sidebarW])

  useEffect(() => {
    if (!uid || !detailTaskId) return
    setCurrentTask(uid, detailTaskId)
    return () => { if (uid) setCurrentTask(uid, null) }
  }, [uid, detailTaskId])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editingTitle) closeTaskDetail() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [editingTitle, closeTaskDetail])

  const debouncedSave = useCallback((html: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('saving')
    saveTimer.current = window.setTimeout(() => {
      if (task) updateTask(task.id, { memo: html })
      setSaveStatus('saved')
    }, 700)
  }, [task, updateTask])

  const initContent = task?.memo || ''
  const editorContent = initContent.startsWith('<') ? initContent : initContent ? `<p>${initContent}</p>` : ''

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: '내용을 자유롭게 작성하세요...' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight,
    ],
    content: editorContent,
    onUpdate: ({ editor }) => debouncedSave(editor.getHTML()),
  }, [detailTaskId])

  if (!detailTaskId || !task) return null

  const close = () => { closeTaskDetail(); setEditingTitle(false) }

  const viewers = Object.entries(presences)
    .filter(([pUid, p]) => p != null && pUid !== uid && p.currentTask === task.id && p.online)
    .map(([, p]) => p)

  const taskMilestones = milestones.filter(m => m.projectId === task.projectId)
  const currentProject = projects.find(p => p.id === task.projectId)
  const currentMilestone = milestones.find(m => m.id === task.milestoneId)

  const assigneeOptions = useMemo(() => {
    const memberEmails = currentProject?.memberEmails ?? []
    if (memberEmails.length > 0) {
      return memberEmails.map(e => ({ value: e, label: getNameByEmail(e) }))
    }
    // Fallback: union of all accessible project members
    const s = new Set<string>()
    projects.forEach(p => p.memberEmails?.forEach(e => s.add(e)))
    return Array.from(s).map(e => ({ value: e, label: getNameByEmail(e) }))
  }, [currentProject, projects, getNameByEmail])

  const upd = (patch: Partial<Task>) => updateTask(task.id, patch)

  /* ── Mobile view ── */
  if (isMobile) {
    return (
      <MobileTaskDetail
        task={task}
        onClose={close}
        editor={editor}
        saveStatus={saveStatus}
        upd={upd}
        milestones={milestones}
        projects={projects}
        assigneeOptions={assigneeOptions}
      />
    )
  }

  /* ── Desktop view ── */
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) close() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)', padding: '20px' }}
    >
      <div style={{ width: '100%', maxWidth: 1080, height: '88vh', background: 'var(--bg)', borderRadius: 'var(--r4)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: 'var(--sh-lg)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
          <button onClick={close} style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--t3)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t1)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}>✕</button>

          <div style={{ flex: 1, minWidth: 0 }}>
            {editingTitle ? (
              <input autoFocus value={titleValue}
                onChange={e => setTitleValue(e.target.value)}
                onBlur={() => { upd({ name: titleValue.trim() || task.name }); setEditingTitle(false) }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !isComposing(e)) { upd({ name: titleValue.trim() || task.name }); setEditingTitle(false) }
                  if (e.key === 'Escape') setEditingTitle(false)
                }}
                style={{ width: '100%', fontSize: 20, fontWeight: 700, border: 'none', outline: '2px solid var(--ac)', borderRadius: 4, padding: '2px 8px', fontFamily: 'var(--font)', color: 'var(--t1)' }}
              />
            ) : (
              <h2 onClick={() => { setTitleValue(task.name); setEditingTitle(true) }}
                style={{ fontSize: 20, fontWeight: 700, color: 'var(--t1)', cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderBottom: '1px solid transparent', transition: 'border-color .1s' }}
                onMouseEnter={e => (e.currentTarget.style.borderBottomColor = 'var(--bd)')}
                onMouseLeave={e => (e.currentTarget.style.borderBottomColor = 'transparent')}
                title="클릭해서 이름 수정"
              >{task.name}</h2>
            )}
          </div>

          {viewers.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--t3)' }}>함께 보는 중</span>
              <div style={{ display: 'flex' }}>
                {viewers.map((v, i) => (
                  <div key={i} title={`${v.name}님이 보고 있어요`} style={{ marginLeft: i === 0 ? 0 : -6 }}>
                    <AssigneeAvatar assigneeKey={v.memberKey} size={26} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Properties panel */}
          <div style={{ width: sidebarW, borderRight: '1px solid var(--bd)', padding: '16px 20px', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>속성</div>

            <PropRow label="담당자">
              <select value={task.assignee} onChange={e => upd({ assignee: e.target.value })}
                style={{ border: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer', outline: 'none', color: 'var(--t1)', fontFamily: 'var(--font)', width: '100%' }}>
                <option value="">미배정</option>
                {assigneeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </PropRow>

            <PropRow label="상태">
              <ColoredSelect value={task.status} options={STATUS_LIST as unknown as Status[]} styles={STATUS_STYLE} onChange={v => upd({ status: v })} />
            </PropRow>

            <PropRow label="우선순위">
              <ColoredSelect value={task.priority} options={PRIORITY_LIST as unknown as Priority[]} styles={PRIORITY_STYLE} onChange={v => upd({ priority: v })} />
            </PropRow>

            <PropRow label="시작일">
              <DateField value={task.start || ''} context={{ taskId: task.id, projectId: task.projectId, milestoneId: task.milestoneId, parentId: task.parentId, assignee: task.assignee, blockedBy: task.blockedBy }}
                onChange={v => upd({ start: v })} placeholder="—" format="full" style={{ fontSize: 13 }} />
            </PropRow>

            <PropRow label="마감일">
              <DateField value={task.due || ''} context={{ taskId: task.id, projectId: task.projectId, milestoneId: task.milestoneId, parentId: task.parentId, assignee: task.assignee, blockedBy: task.blockedBy }}
                onChange={v => upd({ due: v })} placeholder="—" format="full" style={{ fontSize: 13 }} />
            </PropRow>

            <PropRow label="진행률">
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="range" min={0} max={100} step={5} value={task.progress}
                  onChange={e => upd({ progress: Number(e.target.value) })}
                  style={{ flex: 1, accentColor: 'var(--ac)', cursor: 'pointer' }} />
                <span style={{ fontSize: 12, color: 'var(--t2)', minWidth: 32, textAlign: 'right' }}>{task.progress}%</span>
              </div>
            </PropRow>

            <PropRow label="프로젝트">
              <select value={task.projectId || ''} onChange={e => upd({ projectId: e.target.value || undefined })}
                style={{ border: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer', outline: 'none', color: 'var(--t2)', fontFamily: 'var(--font)', width: '100%' }}>
                <option value="">없음</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </PropRow>

            {currentProject && (
              <PropRow label="마일스톤">
                <select value={task.milestoneId || ''} onChange={e => upd({ milestoneId: e.target.value || undefined })}
                  style={{ border: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer', outline: 'none', color: 'var(--t2)', fontFamily: 'var(--font)', width: '100%' }}>
                  <option value="">없음</option>
                  {taskMilestones.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </PropRow>
            )}

            <AssetsPanel links={task.links ?? []} projectId={task.projectId} onChange={links => upd({ links })} />

            <div style={{ marginTop: 'auto', paddingTop: 16 }}>
              {currentProject && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: currentProject.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--t3)' }}>{currentProject.name}</span>
                </div>
              )}
              {currentMilestone && (
                <div style={{ fontSize: 11, color: '#9065B0' }}>◆ {currentMilestone.name}</div>
              )}
            </div>

            <div style={{ paddingTop: 12, fontSize: 11, color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: 4 }}>
              {saveStatus === 'saving' ? (
                <><span style={{ animation: 'pulse 1s infinite', display: 'inline-block' }}>●</span> 저장 중...</>
              ) : (
                <><span style={{ color: '#10b981' }}>●</span> 저장됨</>
              )}
            </div>
          </div>

          {/* Resize handle */}
          <div onMouseDown={handleResizeStart}
            style={{ width: 5, cursor: 'col-resize', flexShrink: 0, position: 'relative', zIndex: 1, background: 'transparent', transition: 'background .15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--ac)'; e.currentTarget.style.opacity = '.35' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = '1' }}
          />

          {/* Editor */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            <EditorToolbar editor={editor} />
            <div onClick={() => editor?.commands.focus()}
              style={{ flex: 1, overflowY: 'auto', padding: '28px 40px', cursor: 'text' }}
              className="task-editor-area"
            >
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
