import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { MoreMenu } from '../shared/MoreMenu'
import { Tip } from '../shared/Tip'
import { Icon } from '../shared/Icon'
import { useToast } from '../shared/Toast'
import { taskLinkFor } from '../../lib/paths'
import { sanitizeHtml, safeHref } from '../../lib/sanitizeHtml'
import { askConfirm } from '../shared/Confirm'
import { useAuthStore } from '../../store/authStore'
import { usePresenceStore } from '../../store/presenceStore'
import { useSyncStore } from '../../store/syncStore'
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
import { AssigneePicker } from '../shared/AssigneePicker'
import { BadgeSelect } from '../shared/BadgeSelect'
import { SchedulePanel } from './SchedulePanel'
import { StatusPill, PriorityLabel } from '../shared/StatusPill'
import { useMenu, Menu, MenuList, MenuItem, CellTrigger, Dot } from '../shared/Menu'
import { PropCell, OptionPicker, STATUS_STYLE, PRIORITY_STYLE } from '../shared/PropRow'
import { STATUS_LIST, PRIORITY_LIST, NOTION, statusAccent } from '../../types'
import { ActivityList } from '../shared/ActivityList'
import { openExternal } from '../../lib/desktopLinks'
import type { Task, Status, Priority, TaskLink } from '../../types'
import {
  isComposing, daysFrom, parseAssignees, assigneeKeyToEmail,
  assigneeOptions as assigneeOptions_, invitableColleagues, type AssigneeOption,
} from '../../lib/utils'
import { useInviteAssign } from '../../hooks/useInviteAssign'
import { StatusMark } from '../shared/StatusMark'
import { useShallow } from 'zustand/react/shallow'
import { CopyClean } from '../shared/CopyClean'


/* ── Shared helpers ── */

/**
 * A click on a link inside the editor opens it, in a real browser.
 *
 * Returns true when it handled the click, so the caller does not also put the
 * cursor there. In the desktop shell a global capture-phase listener may have
 * taken the same click already — hence the `defaultPrevented` check, without
 * which one click would open two windows.
 */
function openLinkFrom(e: React.MouseEvent): boolean {
  const anchor = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null
  if (!anchor) return false
  if (!e.defaultPrevented) {
    e.preventDefault()
    void openExternal(anchor.href)
  }
  return true
}

/** One property in the grid: a quiet label above nothing, beside its control. */
/* ── AssetsPanel — the task's materials ── */

/**
 * The files a task is made of, attached from Drive rather than described by a
 * URL somebody typed. See DriveFiles.tsx for what "aligned" is taken to mean.
 */
/**
 * ── 이 업무로 가는 링크 ──────────────────────────────────────────────────────
 *
 * "그 업무 어디 있죠"에 답하려면 지금까지는 말로 길을 알려 줘야 했습니다 —
 * 프로젝트를 고르고, 마일스톤을 펴고, 목록에서 이름을 찾으라고. 주소 하나면
 * 끝날 일입니다. 슬랙에 붙여 넣으면 누른 사람 화면에 이 창이 열립니다.
 *
 * **권한은 이 링크가 주지 않습니다.** 초대 링크와 다릅니다 — 저건 코드를
 * 들고 있어서 들여보내 주지만, 이건 가리키기만 합니다. 그래서 아무에게나
 * 보내도 새는 것이 없고, 반대로 그 프로젝트 멤버가 아닌 사람은 눌러도 못
 * 봅니다. 그 경우엔 앱이 왜 못 보는지 말해 줍니다(AppPage).
 *
 * 누른 뒤에 글자가 바뀝니다. 복사는 화면에 아무 흔적도 안 남기는 동작이라,
 * 눌렸는지 아닌지를 말해 주지 않으면 두 번 세 번 누르게 됩니다.
 */
function ShareLink({ taskId }: { taskId: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Tip label={copied ? '복사했습니다' : '링크 복사'}>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(taskLinkFor(taskId))
            .then(() => {
              setCopied(true)
              useToast.getState().show('링크를 복사했습니다')
              setTimeout(() => setCopied(false), 2000)
            })
            .catch(() => useToast.getState().show('링크를 복사하지 못했습니다'))
        }}
        aria-label="업무 링크 복사"
        style={{
          width: 28, height: 28, borderRadius: 'var(--r1)', border: 'none',
          background: 'transparent', cursor: 'pointer', color: copied ? 'var(--ac)' : 'var(--t3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          transition: 'background .1s, color .1s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        <Icon name="link" size={15} />
      </button>
    </Tip>
  )
}

/**
 * ── 하위 업무 ────────────────────────────────────────────────────────────────
 *
 * 하위 업무는 만들 수는 있는데 **부모를 열면 안 보였습니다.** 목록에서 접힌
 * 채로 부모 아래 붙어 있고, 노트에서는 한 줄로 서 있고, 정작 "이 일이 어디까지
 * 왔나"를 물으러 여는 창에는 없었습니다.
 *
 * 여기서 하는 일은 셋뿐입니다 — 보기, 상태 바꾸기, 하나 더 만들기. 이름을
 * 고치거나 마감을 잡는 건 그 업무를 열어서 합니다. 한 창에서 두 업무를 다
 * 편집할 수 있게 하면 지금 무엇을 고치고 있는지가 흐려집니다.
 *
 * 새로 만드는 것은 부모의 프로젝트와 마일스톤을 물려받습니다. 하위 업무가
 * 부모와 다른 프로젝트에 있는 일은 없고, 있다면 그건 하위 업무가 아닙니다.
 */
function SubtaskPanel({ task }: { task: Task }) {
  const allTasks = useTaskStore(s => s.tasks)
  const addTask = useTaskStore(s => s.addTask)
  const updateTask = useTaskStore(s => s.updateTask)
  const openTaskDetail = useUiStore(s => s.openTaskDetail)
  const email = useAuthStore(s => s.email)
  const ready = useSyncStore(s => s.ready)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const parent = allTasks.find(t => t.id === task.parentId)
  const children = useMemo(
    () => allTasks.filter(t => t.parentId === task.id),
    [allTasks, task.id],
  )
  const done = children.filter(t => t.status === '완료').length

  const create = () => {
    const name = draft.trim()
    if (!name) { setAdding(false); setDraft(''); return }
    addTask({
      type: '세부', name, cat: task.cat ?? '',
      assignee: email ?? '', start: '', due: '',
      priority: '중간', status: '대기', progress: 0, memo: '',
      parentId: task.id,
      ...(task.projectId ? { projectId: task.projectId } : {}),
      ...(task.milestoneId ? { milestoneId: task.milestoneId } : {}),
      ...(email ? { createdBy: email } : {}),
    })
    setDraft('')   // 연달아 넣는 사람이 대부분입니다. 칸은 열어 둡니다.
  }

  const pct = children.length ? Math.round((done / children.length) * 100) : 0

  return (
    <div>
      {/*
        ── 위로 가는 문 ─────────────────────────────────────────────────────────
        내가 누군가의 하위라면 그것부터 말합니다. '이 일이 어디에 속하나'는
        '이 일 밑에 뭐가 있나'보다 먼저 궁금한 질문입니다.

        테두리만 있는 버튼이었는데, 그러면 아래 목록과 같은 무게로 앉아서
        둘 중 무엇이 이 창의 주인공인지 흐려졌습니다. 위로 가는 것은 **떠나는
        문**이라 화살표를 오른쪽 끝에 두고 배경을 옅게 깔았습니다 — 이 창의
        내용이 아니라 이 창의 바깥이라는 뜻입니다.
      */}
      {parent && (
        <button
          onClick={() => openTaskDetail(parent.id)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 12px', marginBottom: 18, borderRadius: 'var(--r2)',
            border: '1px solid var(--bd)', background: 'var(--bg2)',
            cursor: 'pointer', fontFamily: 'var(--font)', textAlign: 'left',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--bd2)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--bd)' }}
        >
          <span style={{ color: statusAccent(parent.status), display: 'flex', flexShrink: 0 }}>
            <StatusMark status={parent.status} size={14} />
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--t3)', letterSpacing: '.06em' }}>
              상위 업무
            </span>
            <span style={{
              display: 'block', fontSize: 13.5, color: 'var(--t1)', marginTop: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {parent.name || '이름 없음'}
            </span>
          </span>
          <span style={{ flexShrink: 0, color: 'var(--t3)', fontSize: 13 }}>→</span>
        </button>
      )}

      {/*
        머리줄에 진행이 같이 섭니다. '2/5'만으로는 눈이 계산을 해야 하고,
        막대는 계산 없이 읽힙니다. 둘 다 두는 이유는 막대가 정확하지 않고
        숫자가 한눈에 안 들어오기 때문입니다 — 서로의 약점을 메웁니다.
      */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: children.length ? 8 : 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>
          하위 업무
        </span>
        {children.length > 0 && (
          <>
            <span style={{
              flex: 1, maxWidth: 120, height: 4, borderRadius: 999,
              background: 'var(--bg3)', overflow: 'hidden',
            }}>
              <span style={{
                display: 'block', height: '100%', width: `${pct}%`,
                background: done === children.length ? '#448361' : 'var(--ac)',
                borderRadius: 999, transition: 'width .2s',
              }} />
            </span>
            <span style={{ fontSize: 11, color: 'var(--t3)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {done}/{children.length}
            </span>
          </>
        )}
      </div>

      {/* 아직 안 온 것과 없는 것. 하위 업무가 셋인 업무를 열었는데 몇 초 동안
          '+ 하위 업무 추가' 한 줄만 있으면, 그 사이에 사람은 없다고 믿습니다. */}
      {!ready && !children.length && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '2px 0 4px' }}>
          {['58%', '44%'].map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="bpp-skel" style={{ width: 14, height: 14, borderRadius: '50%', flexShrink: 0 }} />
              <span className="bpp-skel" style={{ width: w, height: 11 }} />
            </div>
          ))}
        </div>
      )}

      {children.map(child => (
        <SubtaskRow
          key={child.id}
          task={child}
          onOpen={() => openTaskDetail(child.id)}
          onToggle={() => updateTask(child.id, child.status === '완료'
            ? { status: '진행중', progress: 50 }
            : { status: '완료', progress: 100 })}
        />
      ))}

      {adding ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { create(); setAdding(false) }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); create() }
            if (e.key === 'Escape') { setDraft(''); setAdding(false) }
          }}
          placeholder="하위 업무 이름 · Enter로 계속"
          style={{
            width: '100%', boxSizing: 'border-box', marginTop: 4,
            padding: '6px 8px', borderRadius: 'var(--r1)',
            border: '1px solid var(--ac)', background: 'var(--bg)',
            color: 'var(--t1)', fontSize: 13, fontFamily: 'var(--font)', outline: 'none',
          }}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, marginTop: 4,
            padding: '5px 6px', borderRadius: 'var(--r1)',
            border: 'none', background: 'transparent',
            color: 'var(--t3)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'var(--font)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t2)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
        >
          + 하위 업무 추가
        </button>
      )}
    </div>
  )
}

function SubtaskRow({ task, onOpen, onToggle }: {
  task: Task; onOpen: () => void; onToggle: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const done = task.status === '완료'
  const diff = task.due ? daysFrom(task.due, new Date()) : null
  const late = diff !== null && diff < 0 && !done

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 6px', margin: '1px -6px', borderRadius: 'var(--r1)',
        background: hovered ? 'var(--bg3)' : 'transparent',
      }}
    >
      <button
        onClick={onToggle}
        aria-label={done ? '완료 해제' : '완료로'}
        style={{
          width: 20, height: 20, flexShrink: 0, borderRadius: '50%', border: 'none',
          background: 'transparent', cursor: 'pointer', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: statusAccent(task.status),
        }}
      >
        <StatusMark status={task.status} size={14} />
      </button>

      <span
        onClick={onOpen}
        style={{
          flex: 1, minWidth: 0, fontSize: 13.5, cursor: 'pointer',
          color: done ? 'var(--t3)' : 'var(--t1)',
          textDecoration: done ? 'line-through' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {task.name || '(이름 없음)'}
      </span>

      {diff !== null && !done && (
        <span style={{
          flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--r1)',
          background: late ? 'var(--danger-l)' : 'var(--bg3)',
          color: late ? 'var(--danger)' : 'var(--t3)',
        }}>
          {late ? `D+${Math.abs(diff)}` : diff === 0 ? 'D-Day' : `D-${diff}`}
        </span>
      )}
    </div>
  )
}

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

  /**
   * Attaching closes the picker.
   *
   * It used to stay open, which made the panel read as a form with something
   * still pending — and clicking away then *looked* like confirming it, while
   * the same click in the calendar cancels a draft event. One gesture, two
   * meanings, in one app.
   *
   * There was never anything pending: the file is attached the instant it is
   * picked, and it appears in the list above. Closing says exactly that, and
   * the question of what an outside click means stops being asked.
   */
  const add = (link: TaskLink) => { onChange([...links, link]); setAdding(false) }
  const remove = (id: string) => onChange(links.filter(l => l.id !== id))

  // And an untouched picker closes on an outside click, like every menu in the
  // app. Nothing is lost — nothing was entered.
  const addBox = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!adding) return
    const h = (e: MouseEvent) => {
      if (addBox.current && !addBox.current.contains(e.target as Node)) setAdding(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [adding])

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
          <FileRow
            key={l.id} link={l} file={resolved.get(driveIdOf(l) ?? '')}
            onRemove={() => remove(l.id)}
            onNote={note => onChange(links.map(x => {
              if (x.id !== l.id) return x
              // Firebase rejects undefined, so an emptied note is dropped.
              const { note: _old, ...rest } = x
              return note ? { ...rest, note } : rest
            }))}
          />
        ))}
      </div>

      {adding && (
        <div ref={addBox} style={{
          marginTop: 8, padding: 4, borderRadius: 'var(--r3)',
          border: '1px solid var(--bd)', background: 'var(--bg)',
          display: 'flex', flexDirection: 'column', maxHeight: 300, overflow: 'hidden',
        }}>
          <AttachTabs mode={mode} onChange={setMode} />
          {mode === 'drive'
            ? <DriveSearch folderId={folderId} attachedIds={attachedIds} onPick={(f, tab) => add(linkFromDriveFile(f, tab))} onClose={() => setAdding(false)} />
            : <UrlAdd onAdd={add} />}
        </div>
      )}
    </div>
  )
}

/**
 * A single-choice property, on the app's own menu.
 *
 * 프로젝트 and 마일스톤 were native `<select>`s here — the operating system's
 * picker, opened from inside a panel where everything else opens the app's.
 * The colour dot also does real work: it is how a project is recognised
 * everywhere else in the app, and a list of bare names is not.
 */
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

/**
 * The link control.
 *
 * An address has to be typed somewhere, and `prompt()` is one of the browser
 * dialogs the desktop webview swallows without drawing anything — the same trap
 * `confirm()` set for the delete buttons. So the field is part of the toolbar:
 * it opens under the caret, it is a real input, and it works in both shells.
 */
function LinkButton({ editor }: { editor: NonNullable<ReturnType<typeof useEditor>> }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const active = editor.isActive('link')

  const commit = () => {
    const value = url.trim()
    if (!value) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      // 스킴처럼 생긴 것을 전부 받아 주고 있었습니다 — `javascript:alert(1)`도
      // 그대로 링크가 됐고, 그건 누르는 순간 코드입니다. http·https·mailto만.
      const raw = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`
      const href = safeHref(raw)
      if (!href) { setUrl(''); setOpen(false); return }
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
    setOpen(false); setUrl('')
  }

  return (
    <div style={{ position: 'relative', display: 'flex' }}>
      <ToolBtn
        active={active}
        title={active ? '링크 편집 · 지우기' : '링크 넣기'}
        onClick={() => {
          if (open) { setOpen(false); return }
          setUrl(active ? (editor.getAttributes('link').href ?? '') : '')
          setOpen(true)
        }}
      ><Icon name="link" size={14} /></ToolBtn>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 10,
          display: 'flex', gap: 4, padding: 6, borderRadius: 'var(--r2)',
          background: 'var(--bg)', border: '1px solid var(--bd)', boxShadow: 'var(--sh-lg)',
        }}>
          <input
            autoFocus
            value={url}
            onChange={ev => setUrl(ev.target.value)}
            onKeyDown={ev => {
              if (ev.key === 'Enter' && !isComposing(ev)) { ev.preventDefault(); commit() }
              if (ev.key === 'Escape') { ev.stopPropagation(); setOpen(false) }
            }}
            placeholder="https://…"
            style={{
              width: 240, padding: '5px 8px', borderRadius: 'var(--r1)',
              border: '1px solid var(--bd)', background: 'var(--bg)',
              fontSize: 12, color: 'var(--t1)', outline: 'none', fontFamily: 'var(--font)',
            }}
          />
          {/* Empty and confirm is how a link is removed — one control, and the
              placeholder says what the field wants. */}
          <ToolBtn active onClick={commit} title="적용">확인</ToolBtn>
        </div>
      )}
    </div>
  )
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
      <LinkButton editor={e} />
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
    <path d="M10 3L17 10L10 17L3 10L10 3Z" stroke={NOTION.purple.text} strokeWidth="1.5"/>
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
  assigneeOptions: AssigneeOption[]
  invitable: { value: string; label: string }[]
  onInvite: (email: string) => void
}

function MobileTaskDetail({ task, onClose, editor, saveStatus, upd, milestones, projects, assigneeOptions, invitable, onInvite }: MobileProps) {
  const [tab, setTab] = useState<'details' | 'activity'>('details')
  const [notesOpen, setNotesOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(task.name)
  const titleRef = useRef<HTMLTextAreaElement>(null)

  const currentProject = projects.find(p => p.id === task.projectId)
  const currentMilestone = milestones.find(m => m.id === task.milestoneId)
  const taskMilestones = milestones.filter(m => m.projectId === task.projectId)

  const priorityStyle = task.priority ? PRIORITY_STYLE[task.priority] : null

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
                <><span style={{ opacity: .4 }}>/</span><span style={{ color: NOTION.purple.text }}>◆ {currentMilestone.name}</span></>
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
              <MobilePropRow icon={<IcStatus />} label="상태">
                <BadgeSelect value={task.status} options={STATUS_LIST as Status[]} styleMap={STATUS_STYLE} renderValue={v => <StatusPill status={v} />} onChange={v => upd({ status: v as Status })} />
              </MobilePropRow>

              {/* Assignees — the multi-select, same as everywhere else. */}
              <MobilePropRow icon={<IcUser />} label="담당자">
                <AssigneePicker
                  assignee={task.assignee}
                  options={assigneeOptions}
                  onChange={v => upd({ assignee: v })}
                  invitable={invitable}
                  onInvite={onInvite}
                />
              </MobilePropRow>

              {/* Priority */}
              <MobilePropRow icon={<IcFlag color={priorityStyle?.color} />} label="우선순위">
                <BadgeSelect value={task.priority} options={PRIORITY_LIST as Priority[]} styleMap={PRIORITY_STYLE} renderValue={v => <PriorityLabel priority={v} />} onChange={v => upd({ priority: v as Priority })} />
              </MobilePropRow>

              {/* Dates */}
              <MobilePropRow icon={<IcCalendar />} label="기간">
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
                <MobilePropRow icon={<IcDiamond />} label="마일스톤">
                  <OptionPicker
                    value={task.milestoneId}
                    empty="없음"
                    options={taskMilestones.map(m => ({ value: m.id, label: m.name, dot: NOTION.purple.text, sub: m.dueDate }))}
                    onChange={v => upd({ milestoneId: v })}
                  />
                </MobilePropRow>
              )}

              {/* Progress */}
              <MobilePropRow icon={<IcProgress />} label="진행률">
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
                      // 남이 쓴 HTML입니다. 그대로 그리면 그 사람이 심은
                      // 코드가 이 사람 권한으로 돕니다 — lib/sanitizeHtml.
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(task.memo!) }}
                      className="task-editor-area"
                      style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--t1)', pointerEvents: 'none', overflow: 'hidden' }}
                    />
                  ) : (
                    <span style={{ fontSize: 14, color: 'var(--t3)' }}>내용 없음 — 탭하여 편집</span>
                  )}
                </div>
              </div>

              {/* Assets, then the events they are for */}
              <div style={{ padding: '16px 20px 24px', borderTop: '1px solid var(--bd)' }}>
                <SubtaskPanel task={task} />
              </div>

              <div style={{ padding: '0 20px 24px', borderTop: '1px solid var(--bd)' }}>
                <AssetsPanel links={task.links ?? []} projectId={task.projectId} onChange={links => upd({ links })} />
                <SchedulePanel task={task} memberEmails={currentProject?.memberEmails ?? []} />
              </div>
            </>
          )}

          {tab === 'activity' && (
            <div style={{ padding: '20px' }}>
              <ActivityList key={task.id} taskId={task.id} projectId={task.projectId} />
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
            <span style={{ fontSize: 11, color: saveStatus === 'saving' ? 'var(--ac)' : NOTION.green.text, minWidth: 44, textAlign: 'right' }}>
              {saveStatus === 'saving' ? '저장 중' : '저장됨'}
            </span>
          </div>

          <EditorToolbar editor={editor} />

          <div
            onClick={e => { if (!openLinkFrom(e)) editor?.commands.focus() }}
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
  const { detailTaskId, closeTaskDetail } = useUiStore(useShallow(s => ({ detailTaskId: s.detailTaskId, closeTaskDetail: s.closeTaskDetail })))
  const task = useTaskStore(s => s.tasks.find(t => t.id === detailTaskId))
  const { updateTask, deleteTask } = useTaskStore(useShallow(s => ({ updateTask: s.updateTask, deleteTask: s.deleteTask })))
  const allTasks = useTaskStore(st => st.tasks)
  const { uid, myEmail } = useAuthStore(useShallow(s => ({ uid: s.uid, myEmail: s.email })))
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
      // Link ships inside StarterKit v3. Two things have to be said about it.
      //
      // `openOnClick` calls `window.open`, and a webview opens nothing at all —
      // silently, as ever. So it is off, and the click is handled below by the
      // one function in this app that knows how to reach a real browser.
      //
      // `autolink` is what turns a pasted or typed address into a link without
      // anybody reaching for a toolbar.
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
        },
      }),
      Placeholder.configure({ placeholder: '내용을 자유롭게 작성하세요...' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      // 밖으로 복사할 때 줄 사이가 벌어지고 불릿이 사라지던 것.
      CopyClean,
      Highlight,
    ],
    content: editorContent,
    // 파괴된 편집기의 schema는 null이라 getHTML()이 그 자리에서 던집니다.
    // 다른 업무를 골라 편집기가 새로 만들어지는 순간이 그 자리입니다.
    onUpdate: ({ editor }) => { if (!editor.isDestroyed) debouncedSave(editor.getHTML()) },
  }, [detailTaskId])

  if (!detailTaskId || !task) return null

  const close = () => { closeTaskDetail(); setEditingTitle(false) }

  const viewers = Object.entries(presences)
    .filter(([pUid, p]) => p != null && pUid !== uid && p.currentTask === task.id && p.online)
    .map(([, p]) => p)

  const taskMilestones = milestones.filter(m => m.projectId === task.projectId)
  const currentProject = projects.find(p => p.id === task.projectId)
  const currentMilestone = milestones.find(m => m.id === task.milestoneId)

  // 고를 수 있는 사람은 그 업무를 읽을 수 있는 사람뿐입니다. 프로젝트가
  // 없으면 그 업무는 personalTasks/$uid에 살고, 그건 나만 읽습니다.
  const assigneeOptions = useMemo(
    () => assigneeOptions_(task.projectId, projects, myEmail, getNameByEmail),
    [task.projectId, projects, myEmail, getNameByEmail],
  )
  // 목록에 없는 동료는 초대해서 맡깁니다 — hooks/useInviteAssign.
  const invitable = useMemo(
    () => invitableColleagues(task.projectId, projects, myEmail, getNameByEmail),
    [task.projectId, projects, myEmail, getNameByEmail],
  )
  const inviteAssign = useInviteAssign()
  const onInvite = useCallback((mail: string) => {
    if (!task.projectId) return
    void inviteAssign(task.projectId, mail, who =>
      updateTask(task.id, { assignee: [...parseAssignees(task.assignee), who].join(',') }))
  }, [task.projectId, task.id, task.assignee, inviteAssign, updateTask])

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
        invitable={invitable}
        onInvite={onInvite}
      />
    )
  }

  /* ── Desktop view ── */
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) close() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)', padding: '20px' }}
    >
      <div style={{ width: '100%', maxWidth: 880, height: '88vh', background: 'var(--bg)', borderRadius: 'var(--r4)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: 'var(--sh-lg)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
          <button onClick={close} style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--t3)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t1)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}>✕</button>

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Where this sits, above its name — the same line the mobile panel
                has always shown, and the same breadcrumb the flat list puts
                under a row. A task opened from a search or a calendar arrives
                with no surrounding context at all otherwise. */}
            {currentProject && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--t3)', marginBottom: 3, minWidth: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: currentProject.color, flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentProject.name}</span>
                {currentMilestone && (
                  <>
                    <span style={{ opacity: .4, flexShrink: 0 }}>›</span>
                    <span style={{ color: NOTION.purple.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>◆ {currentMilestone.name}</span>
                  </>
                )}
              </div>
            )}
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

          <div style={{ fontSize: 11, color: saveStatus === 'saving' ? 'var(--ac)' : 'var(--t3)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: saveStatus === 'saving' ? 'var(--ac)' : NOTION.green.text }}>●</span>
            {saveStatus === 'saving' ? '저장 중' : '저장됨'}
          </div>

          {viewers.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--t3)' }}>함께 보는 중</span>
              <div style={{ display: 'flex' }}>
                {viewers.map((v, i) => (
                  <div key={i} title={`${v.name}님이 보고 있어요`} style={{ marginLeft: i === 0 ? 0 : -6 }}>
                    <AssigneeAvatar assigneeKey={v.who} size={26} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/*
            ── 삭제 ──────────────────────────────────────────────────────────
            메뉴 뒤에 두고, 누르면 무엇이 지워지는지 이름과 하위 업무 수까지
            말한 다음 한 번 더 묻습니다. 앱의 다른 삭제(업무 우클릭, 마일스톤,
            회의실)가 전부 이 모양이고, docs/desktop-updates.md에 규칙으로도
            적혀 있습니다 — 파괴적인 버튼은 hover에 두지 않고, 메뉴 뒤에 두고,
            필요하면 확인을 받는다.

            '삭제를 두 번 누르기'는 안 씁니다. 같은 자리를 두 번 누르는 건
            더블클릭 한 번으로 뚫리고, 무엇보다 **무엇이 지워지는지 말하지
            않습니다.** 하위 업무 세 개가 같이 사라지는 걸 모르고 누르는
            일이 그 방식에서는 막히지 않습니다.
          */}
          {/* 3점 버튼 옆. 공유는 자주 하는 일이라 메뉴 안에 넣지 않습니다. */}
          <ShareLink taskId={task.id} />
          <MoreMenu items={[{
            label: '업무 삭제',
            icon: 'trash',
            danger: true,
            onSelect: async () => {
              const children = allTasks.filter(t => t.parentId === task.id)
              const ok = await askConfirm({
                message: `"${task.name || '이름 없음'}" 업무를 삭제할까요?`,
                detail: children.length ? `하위 업무 ${children.length}개도 함께 삭제됩니다.` : undefined,
              })
              if (!ok) return
              children.forEach(c => deleteTask(c.id))
              deleteTask(task.id)
              close()
            },
          }]} />
        </div>

        {/* Body — one column, scrolled as a whole */}
        <div style={{ flex: 1, overflowY: 'auto' }}>

          {/* Properties. Two columns of short rows rather than one tall stack:
              eight rows down the side of a wide modal is a lot of vertical
              travel for facts that each fit in half a line. */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            columnGap: 28, rowGap: 2, padding: '16px 28px 18px',
          }}>
            <PropCell label="상태">
              <BadgeSelect value={task.status} options={STATUS_LIST as Status[]} styleMap={STATUS_STYLE} renderValue={v => <StatusPill status={v} />} onChange={v => upd({ status: v as Status })} />
            </PropCell>

            <PropCell label="담당자">
              <AssigneePicker
                  assignee={task.assignee}
                  options={assigneeOptions}
                  onChange={v => upd({ assignee: v })}
                  invitable={invitable}
                  onInvite={onInvite}
                />
            </PropCell>

            <PropCell label="시작일">
              <DateField value={task.start || ''} context={{ taskId: task.id, projectId: task.projectId, milestoneId: task.milestoneId, parentId: task.parentId, assignee: task.assignee, blockedBy: task.blockedBy }}
                onChange={v => upd({ start: v })} placeholder="—" format="full" style={{ fontSize: 13 }} />
            </PropCell>

            <PropCell label="마감일">
              <DateField value={task.due || ''} context={{ taskId: task.id, projectId: task.projectId, milestoneId: task.milestoneId, parentId: task.parentId, assignee: task.assignee, blockedBy: task.blockedBy }}
                onChange={v => upd({ due: v })} placeholder="—" format="full" style={{ fontSize: 13 }} />
            </PropCell>

            <PropCell label="우선순위">
              <BadgeSelect value={task.priority} options={PRIORITY_LIST as Priority[]} styleMap={PRIORITY_STYLE} renderValue={v => <PriorityLabel priority={v} />} onChange={v => upd({ priority: v as Priority })} />
            </PropCell>

            <PropCell label="진행률">
              <input type="range" min={0} max={100} step={5} value={task.progress}
                onChange={e => upd({ progress: Number(e.target.value) })}
                style={{ flex: 1, minWidth: 0, accentColor: 'var(--ac)', cursor: 'pointer' }} />
              <span style={{ fontSize: 12, color: 'var(--t2)', minWidth: 34, textAlign: 'right' }}>{task.progress}%</span>
            </PropCell>

            <PropCell label="프로젝트">
              <OptionPicker
                value={task.projectId}
                empty="없음"
                options={projects.map(p => ({ value: p.id, label: p.name, dot: p.color }))}
                onChange={v => upd({ projectId: v })}
              />
            </PropCell>

            {currentProject && (
              <PropCell label="마일스톤">
                <OptionPicker
                  value={task.milestoneId}
                  empty="없음"
                  options={taskMilestones.map(m => ({ value: m.id, label: m.name, dot: NOTION.purple.text, sub: m.dueDate }))}
                  onChange={v => upd({ milestoneId: v })}
                />
              </PropCell>
            )}
          </div>

          {/* The document. Full width now, but the text itself is capped —
              fifteen-pixel type across 840px is a line nobody's eye tracks
              back from. */}
          <div style={{ borderTop: '1px solid var(--bd)' }}>
            <div style={{ position: 'sticky', top: 0, zIndex: 3 }}>
              <EditorToolbar editor={editor} />
            </div>
            <div
              onClick={e => { if (!openLinkFrom(e)) editor?.commands.focus() }}
              style={{ padding: '20px 28px 8px', cursor: 'text', minHeight: 260 }}
              className="task-editor-area"
            >
              <div style={{ maxWidth: 720 }}>
                <EditorContent editor={editor} />
              </div>
            </div>
          </div>

          {/* Both panels draw their own heading, so they get the rule and the
              padding and nothing else — a second title above theirs would be
              the same word twice. */}
          <div style={{ borderTop: '1px solid var(--bd)', padding: '18px 28px' }}>
            <SubtaskPanel task={task} />
          </div>

          <div style={{ borderTop: '1px solid var(--bd)', padding: '18px 28px' }}>
            <AssetsPanel links={task.links ?? []} projectId={task.projectId} onChange={links => upd({ links })} />
          </div>

          <div style={{ borderTop: '1px solid var(--bd)', padding: '18px 28px' }}>
            <SchedulePanel task={task} memberEmails={currentProject?.memberEmails ?? []} />
          </div>

          {/* Last, and quiet. It answers a question that gets asked after the
              fact — who moved this — rather than one anybody opens the task
              for. */}
          <div style={{ borderTop: '1px solid var(--bd)', padding: '18px 28px 28px' }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: 'var(--t3)',
              textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12,
            }}>활동</div>
            <ActivityList key={task.id} taskId={task.id} projectId={task.projectId} compact />
          </div>
        </div>
      </div>
    </div>
  )
}
