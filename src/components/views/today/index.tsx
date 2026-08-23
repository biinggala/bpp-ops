import { useEffect, useMemo, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { useTaskStore } from '../../../store/taskStore'
import { useAuthStore } from '../../../store/authStore'
import { useProjectStore } from '../../../store/projectStore'
import { useUiStore } from '../../../store/uiStore'
import { useMobile } from '../../../hooks/useMobile'
import { useDailyNote } from '../../../hooks/useDailyNote'
import { isAssignedTo, daysFrom, fmtYMD, addDays, toDate } from '../../../lib/utils'
import { haptic } from '../../../lib/haptics'
import { TaskRef } from './TaskRef'
import type { Task } from '../../../types'

/**
 * ── 오늘 ─────────────────────────────────────────────────────────────────────
 *
 * 아침에 여는 화면.
 *
 * **왜 '내 할 일'로는 안 되는가.** 내 할 일은 목록입니다 — 나에게 배정된 것
 * 전부를 마감일 순으로 세워 놓은 것. 그건 재고이지 계획이 아닙니다. 스무 개가
 * 있을 때 "오늘 뭘 하지"는 스무 개를 보는 걸로 답이 안 나오고, 하루를 보내는
 * 동안 생기는 자잘한 것들("코디한테 답장", "커피 주문")은 애초에 그 목록에 낄
 * 자격이 없어서 갈 데가 없었습니다.
 *
 * 그래서 두 칸입니다. 왼쪽은 **재고에서 고르는 곳**, 오른쪽은 **고른 것과 그
 * 밖의 것들을 적는 곳**.
 *
 * 노트에는 일이 살지 않습니다. 오늘의 결정이 삽니다 — 자세한 건 TaskRef 참고.
 */

const TODAY = () => fmtYMD(new Date())

export function TodayView() {
  const isMobile = useMobile()
  const [date, setDate] = useState(TODAY)
  const { html, save, saving } = useDailyNote(date)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false, autolink: true, defaultProtocol: 'https',
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
        },
      }),
      Placeholder.configure({ placeholder: '오늘 무엇부터 할까요?' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TaskRef,
    ],
    content: '',
    editorProps: { attributes: { class: 'ProseMirror today-note' } },
    onUpdate: ({ editor }) => save(editor.getHTML()),
  }, [date])

  // 서버에서 온 내용. 내가 방금 친 것이 되돌아오는 경우는 훅이 걸러 냅니다.
  useEffect(() => {
    if (!editor || html === null) return
    if (editor.getHTML() === html) return
    editor.commands.setContent(html || '', { emitUpdate: false })
  }, [editor, html])

  const add = (task: Task) => {
    if (!editor) return
    haptic('tap')
    editor.chain().focus('end').insertTaskRef(task.id).run()
  }

  const inNote = useMemo(() => {
    const ids = new Set<string>()
    if (!html) return ids
    for (const m of html.matchAll(/data-task-id="([^"]+)"/g)) ids.add(m[1])
    return ids
  }, [html])

  const shift = (days: number) => setDate(d => fmtYMD(addDays(toDate(d), days)))
  const isToday = date === TODAY()

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', minHeight: 0, overflow: 'hidden' }}>
      {!isMobile && <PullRail onAdd={add} inNote={inNote} />}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          padding: isMobile ? '10px 16px 6px' : '14px 28px 8px',
        }}>
          <span style={{ fontSize: isMobile ? 16 : 18, fontWeight: 700, color: 'var(--t1)' }}>
            {dayLabel(date)}
          </span>
          {!isToday && (
            <button onClick={() => setDate(TODAY)} style={GHOST}>오늘로</button>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 11, color: 'var(--t3)', marginRight: 6, minWidth: 34, textAlign: 'right' }}>
              {saving ? '저장 중' : ''}
            </span>
            <button onClick={() => shift(-1)} style={GHOST} aria-label="어제">◀</button>
            <button onClick={() => shift(1)} style={GHOST} aria-label="내일">▶</button>
          </span>
        </div>

        {isMobile && <PullStrip onAdd={add} inNote={inNote} />}

        {/*
          아래 빈 곳을 눌러도 커서가 잡힙니다.

          마지막 줄이 업무 참조(원자 블록)면 그 뒤에 설 자리가 없어서, 노트가
          업무로 끝나는 순간 더 이상 아무것도 못 적게 됩니다 — 그럴 때만 문단을
          한 줄 만들어 줍니다. 매번 만들면 업무 다섯 개를 담을 때 빈 줄 네 개가
          따라 들어옵니다.
        */}
        <div
          onClick={e => {
            if (!editor || e.target !== e.currentTarget) return
            const last = editor.state.doc.lastChild
            if (last?.type.name === 'taskRef') editor.chain().focus('end').createParagraphNear().run()
            else editor.commands.focus('end')
          }}
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: isMobile ? '4px 16px 24px' : '4px 28px 40px' }}
        >
          <div style={{ maxWidth: 720 }}>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** 오늘 아침에 눈에 들어와야 하는 순서: 지난 것, 가까운 것, 날짜 없는 것. */
function useMine(): Task[] {
  const tasks = useTaskStore(s => s.tasks)
  const { memberKey, email } = useAuthStore()
  return useMemo(() => {
    const mine = tasks.filter(t => t.status !== '완료' && isAssignedTo(t.assignee, memberKey, email))
    return mine.sort((a, b) => {
      if (!a.due !== !b.due) return a.due ? -1 : 1
      if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due)
      return a.name.localeCompare(b.name)
    })
  }, [tasks, memberKey, email])
}

/**
 * 가져올 것.
 *
 * 잘라내지 않고 스크롤합니다. 아래쪽 페이드는 '여기까지가 전부'가 아니라 '아래
 * 더 있다'는 뜻이어야 합니다 — 가려 놓고 갈 수 없게 만들면 그건 거짓말입니다.
 */
function PullRail({ onAdd, inNote }: { onAdd: (t: Task) => void; inNote: Set<string> }) {
  const mine = useMine()
  const rest = mine.filter(t => !inNote.has(t.id))

  return (
    <div style={{
      width: 264, flexShrink: 0, borderRight: '1px solid var(--bd)',
      display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg2)',
    }}>
      <div style={{ padding: '14px 14px 8px', flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>가져올 것</div>
        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
          {rest.length ? `내 업무 ${rest.length}개 · 마감 가까운 순` : '남은 게 없습니다'}
        </div>
      </div>

      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 20px',
        // 마지막 몇 픽셀만 흐려집니다. 스크롤이 끝까지 가면 아무것도 안 가립니다.
        maskImage: 'linear-gradient(to bottom, #000 calc(100% - 28px), transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 28px), transparent)',
      }}>
        {rest.map(t => <PullRow key={t.id} task={t} onAdd={onAdd} />)}
      </div>
    </div>
  )
}

function PullRow({ task, onAdd }: { task: Task; onAdd: (t: Task) => void }) {
  const [hovered, setHovered] = useState(false)
  const projects = useProjectStore(s => s.projects)
  const openTaskDetail = useUiStore(s => s.openTaskDetail)
  const project = task.projectId ? projects.find(p => p.id === task.projectId) : undefined
  const diff = task.due ? daysFrom(task.due) : null
  const late = diff !== null && diff < 0

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 6px 6px 8px', borderRadius: 'var(--r2)',
        background: hovered ? 'var(--bg3)' : 'transparent',
      }}
    >
      <div onClick={() => openTaskDetail(task.id)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
        <div style={{ fontSize: 13, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.name || '(이름 없음)'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, fontSize: 11, color: 'var(--t3)' }}>
          {diff !== null && (
            <span style={{ fontWeight: 700, color: late ? 'var(--danger)' : diff <= 2 ? '#D9730D' : 'var(--t3)' }}>
              {late ? `D+${Math.abs(diff)}` : diff === 0 ? 'D-Day' : `D-${diff}`}
            </span>
          )}
          {project && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: project.color, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</span>
            </span>
          )}
        </div>
      </div>
      <button onClick={() => onAdd(task)} title="오늘 노트로" style={{
        flexShrink: 0, width: 22, height: 22, borderRadius: 'var(--r1)',
        border: 'none', cursor: 'pointer', fontFamily: 'var(--font)',
        background: hovered ? 'var(--ac)' : 'transparent',
        color: hovered ? '#fff' : 'var(--t3)', fontSize: 14, lineHeight: 1,
      }}>+</button>
    </div>
  )
}

/**
 * 폰의 '가져올 것'.
 *
 * 옆으로 넘기는 한 줄입니다. 손가락에는 드래그가 없으니 탭 하나로 들어가야
 * 하고, 240px짜리 세로 레일을 390pt 화면에 붙이면 노트가 사라집니다.
 */
function PullStrip({ onAdd, inNote }: { onAdd: (t: Task) => void; inNote: Set<string> }) {
  const mine = useMine()
  const rest = mine.filter(t => !inNote.has(t.id))
  if (!rest.length) return null

  return (
    <div style={{
      display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0,
      padding: '4px 16px 10px', borderBottom: '1px solid var(--bd)',
    }}>
      {rest.slice(0, 20).map(t => {
        const diff = t.due ? daysFrom(t.due) : null
        const late = diff !== null && diff < 0
        return (
          <button key={t.id} onClick={() => onAdd(t)} style={{
            flexShrink: 0, maxWidth: 200, display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
            border: '1px solid var(--bd2)', background: 'var(--bg)',
            fontFamily: 'var(--font)', fontSize: 12, color: 'var(--t1)',
          }}>
            <span style={{ fontSize: 13, lineHeight: 1, color: 'var(--ac)' }}>+</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
            {diff !== null && (
              <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: late ? 'var(--danger)' : 'var(--t3)' }}>
                {late ? `D+${Math.abs(diff)}` : diff === 0 ? 'D-Day' : `D-${diff}`}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function dayLabel(ymd: string): string {
  const d = toDate(ymd)
  const today = fmtYMD(new Date())
  const names = ['일', '월', '화', '수', '목', '금', '토']
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${names[d.getDay()]})`
  if (ymd === today) return `오늘 · ${base}`
  const diff = daysFrom(ymd)
  if (diff === -1) return `어제 · ${base}`
  if (diff === 1) return `내일 · ${base}`
  return base
}

const GHOST: React.CSSProperties = {
  padding: '3px 8px', borderRadius: 'var(--r1)', border: 'none',
  background: 'transparent', color: 'var(--t3)', cursor: 'pointer',
  fontFamily: 'var(--font)', fontSize: 12, lineHeight: 1.4,
}
