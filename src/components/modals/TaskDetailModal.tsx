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
import { AssigneeAvatar } from '../shared/Avatar'
import { STATUS_LIST, PRIORITY_LIST } from '../../types'
import type { Task, Status, Priority } from '../../types'

const SIDEBAR_KEY = 'cringe_detail_sidebar_w'
const MIN_SIDEBAR = 200
const MAX_SIDEBAR = 480

const STATUS_STYLE: Record<Status, { bg: string; color: string }> = {
  '진행중': { bg: 'rgba(35,131,226,.15)', color: '#1869c9' },
  '대기':   { bg: 'rgba(120,117,114,.14)', color: '#5a5857' },
  '검토중': { bg: '#fef3c7',              color: '#b45309' },
  '완료':   { bg: '#d1fae5',              color: '#047857' },
}
const PRIORITY_STYLE: Record<Priority, { bg: string; color: string }> = {
  '높음': { bg: 'rgba(239,68,68,.13)',  color: '#dc2626' },
  '중간': { bg: 'rgba(245,158,11,.14)', color: '#b45309' },
  '낮음': { bg: 'rgba(59,130,246,.13)', color: '#1d4ed8' },
}

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
        style={{
          position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer',
          width: '100%', height: '100%', border: 'none',
        }}
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

/* ── Toolbar ── */

function ToolBtn({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: '3px 7px', borderRadius: 4, border: 'none', cursor: 'pointer',
        fontSize: 12, fontWeight: active ? 600 : 400, fontFamily: 'var(--font)',
        background: active ? 'var(--bg4)' : 'transparent',
        color: active ? 'var(--t1)' : 'var(--t2)',
        transition: 'background .08s, color .08s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg3)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = active ? 'var(--bg4)' : 'transparent' }}
    >
      {children}
    </button>
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
      <ToolBtn active={e.isActive('underline')} onClick={() => e.chain().focus().toggleUnderline().run()} title="밑줄 (⌘U)"><u>U</u></ToolBtn>
      <ToolBtn active={e.isActive('strike')} onClick={() => e.chain().focus().toggleStrike().run()} title="취소선"><s>S</s></ToolBtn>
      <ToolBtn active={e.isActive('highlight')} onClick={() => e.chain().focus().toggleHighlight().run()} title="형광펜">Highlight</ToolBtn>
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
      <ToolBtn active={e.isActive('code')} onClick={() => e.chain().focus().toggleCode().run()} title="인라인 코드">{`<>`}</ToolBtn>
      <ToolBtn active={e.isActive('codeBlock')} onClick={() => e.chain().focus().toggleCodeBlock().run()} title="코드 블록">```</ToolBtn>
      <ToolDivider />
      <ToolBtn active={false} onClick={() => e.chain().focus().undo().run()} title="실행취소 (⌘Z)">↩</ToolBtn>
      <ToolBtn active={false} onClick={() => e.chain().focus().redo().run()} title="다시실행 (⌘⇧Z)">↪</ToolBtn>
    </div>
  )
}

/* ── Main modal ── */

export function TaskDetailModal() {
  const { detailTaskId, closeTaskDetail } = useUiStore()
  const task = useTaskStore(s => s.tasks.find(t => t.id === detailTaskId))
  const { updateTask } = useTaskStore()
  const { uid } = useAuthStore()
  const { presences, setCurrentTask } = usePresenceStore()
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const profiles = useUserProfileStore(s => s.profiles)
  const allProjects = useProjectStore(s => s.projects)
  const projects = allProjects
  const milestones = useMilestoneStore(s => s.milestones)

  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const saveTimer = useRef<number | null>(null)

  const [sidebarW, setSidebarW] = useState<number>(() => {
    const v = parseInt(localStorage.getItem(SIDEBAR_KEY) || '0')
    return v >= MIN_SIDEBAR && v <= MAX_SIDEBAR ? v : 320
  })
  const resizingRef = useRef<{ startX: number; startW: number } | null>(null)

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
      resizingRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [sidebarW])

  // Register presence when this task is open
  useEffect(() => {
    if (!uid || !detailTaskId) return
    setCurrentTask(uid, detailTaskId)
    return () => { if (uid) setCurrentTask(uid, null) }
  }, [uid, detailTaskId])

  // Close on Escape
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

  // Build initial content: wrap plain text in <p> for tiptap
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

  // Who else is viewing
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
    return Object.values(profiles).map(p => ({ value: p.email, label: p.name }))
  }, [currentProject, profiles, getNameByEmail])

  const createdByName = task.createdBy ? getNameByEmail(task.createdBy) : null

  const upd = (patch: Partial<Task>) => updateTask(task.id, patch)

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) close() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)', padding: '20px' }}
    >
      <div style={{ width: '100%', maxWidth: 1080, height: '88vh', background: 'var(--bg)', borderRadius: 'var(--r4)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: 'var(--sh-lg)' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
          <button onClick={close} style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--t3)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t1)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}>✕</button>

          {/* Title */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {editingTitle ? (
              <input
                autoFocus
                value={titleValue}
                onChange={e => setTitleValue(e.target.value)}
                onBlur={() => { upd({ name: titleValue.trim() || task.name }); setEditingTitle(false) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { upd({ name: titleValue.trim() || task.name }); setEditingTitle(false) }
                  if (e.key === 'Escape') setEditingTitle(false)
                }}
                style={{ width: '100%', fontSize: 20, fontWeight: 700, border: 'none', outline: '2px solid var(--ac)', borderRadius: 4, padding: '2px 8px', fontFamily: 'var(--font)', color: 'var(--t1)' }}
              />
            ) : (
              <h2
                onClick={() => { setTitleValue(task.name); setEditingTitle(true) }}
                style={{ fontSize: 20, fontWeight: 700, color: 'var(--t1)', cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderBottom: '1px solid transparent', transition: 'border-color .1s' }}
                onMouseEnter={e => (e.currentTarget.style.borderBottomColor = 'var(--bd)')}
                onMouseLeave={e => (e.currentTarget.style.borderBottomColor = 'transparent')}
                title="클릭해서 이름 수정"
              >
                {task.name}
              </h2>
            )}
          </div>

          {/* Viewers */}
          {viewers.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--t3)' }}>함께 보는 중</span>
              <div style={{ display: 'flex', gap: -4 }}>
                {viewers.map((v, i) => (
                  <div key={i} title={`${v.name}님이 보고 있어요`} style={{ marginLeft: i === 0 ? 0 : -6 }}>
                    <AssigneeAvatar assigneeKey={v.memberKey} size={26} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Body ── */}
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
              <ColoredSelect
                value={task.status}
                options={STATUS_LIST as unknown as Status[]}
                styles={STATUS_STYLE}
                onChange={v => upd({ status: v })}
              />
            </PropRow>

            <PropRow label="우선순위">
              <ColoredSelect
                value={task.priority}
                options={PRIORITY_LIST as unknown as Priority[]}
                styles={PRIORITY_STYLE}
                onChange={v => upd({ priority: v })}
              />
            </PropRow>

            <PropRow label="시작일">
              <input type="date" value={task.start || ''} onChange={e => upd({ start: e.target.value })}
                style={{ border: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer', outline: 'none', color: 'var(--t2)', fontFamily: 'var(--font)', width: '100%' }} />
            </PropRow>

            <PropRow label="마감일">
              <input type="date" value={task.due || ''} onChange={e => upd({ due: e.target.value })}
                style={{ border: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer', outline: 'none', color: 'var(--t2)', fontFamily: 'var(--font)', width: '100%' }} />
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

            {createdByName && (
              <PropRow label="생성자">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AssigneeAvatar assigneeKey={task.createdBy!} size={20} />
                  <span style={{ fontSize: 12, color: 'var(--t2)' }}>{createdByName}</span>
                </div>
              </PropRow>
            )}

            {/* Context info */}
            <div style={{ marginTop: 'auto', paddingTop: 16 }}>
              {currentProject && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: currentProject.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--t3)' }}>{currentProject.name}</span>
                </div>
              )}
              {currentMilestone && (
                <div style={{ fontSize: 11, color: '#8b5cf6' }}>◆ {currentMilestone.name}</div>
              )}
            </div>

            {/* Save status */}
            <div style={{ paddingTop: 12, fontSize: 11, color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: 4 }}>
              {saveStatus === 'saving' ? (
                <><span style={{ animation: 'pulse 1s infinite', display: 'inline-block' }}>●</span> 저장 중...</>
              ) : (
                <><span style={{ color: '#10b981' }}>●</span> 저장됨</>
              )}
            </div>
          </div>

          {/* Resize handle */}
          <div
            onMouseDown={handleResizeStart}
            style={{
              width: 5, cursor: 'col-resize', flexShrink: 0, position: 'relative', zIndex: 1,
              background: 'transparent', transition: 'background .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--ac)'; e.currentTarget.style.opacity = '.35' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = '1' }}
          />

          {/* Editor area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            <EditorToolbar editor={editor} />
            <div
              onClick={() => editor?.commands.focus()}
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
