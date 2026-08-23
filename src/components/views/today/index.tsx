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
import { TaskRef, TASK_DND } from './TaskRef'
import { MarkdownTasks } from './markdown'
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
  /**
   * 지금 노트 안에 있는 업무들.
   *
   * 저장된 html을 훑지 않고 편집기의 문서에서 바로 읽습니다. 저장은 1.2초
   * 뒤에 나가므로, html을 보면 방금 담은 업무가 잠시 동안 '아직 안 담김'으로
   * 보입니다 — 왼쪽 칩이 눌렀는데 1초쯤 아무 반응이 없는 셈입니다.
   */
  const [noteIds, setNoteIds] = useState<Set<string>>(() => new Set())
  const [dropping, setDropping] = useState(false)

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
      MarkdownTasks,
    ],
    content: '',
    editorProps: {
      attributes: { class: 'ProseMirror today-note' },
      /**
       * 왼쪽에서 끌어다 놓기.
       *
       * 떨어뜨린 자리가 문단 한가운데일 수 있는데, 업무 줄은 블록이라 문단
       * 안에 못 들어갑니다. 그래서 그 문단 **뒤에** 놓습니다 — 문단을 반으로
       * 쪼개는 것보다 예측 가능합니다.
       */
      handleDrop(view, event, _slice, moved) {
        if (moved) return false
        const dt = (event as DragEvent).dataTransfer
        const taskId = dt?.getData(TASK_DND)
        if (!taskId) return false
        event.preventDefault()
        const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })
        const doc = view.state.doc
        const node = view.state.schema.nodes.taskRef.create({ taskId })
        let pos = doc.content.size
        if (at) {
          const $p = doc.resolve(at.pos)
          pos = $p.depth > 0 ? $p.after(1) : at.pos
        }
        view.dispatch(view.state.tr.insert(pos, node))
        return true
      },
    },
    onUpdate: ({ editor }) => { save(editor.getHTML()); setNoteIds(refIds(editor)) },
  }, [date])

  // 서버에서 온 내용. 내가 방금 친 것이 되돌아오는 경우는 훅이 걸러 냅니다.
  useEffect(() => {
    if (!editor || html === null) return
    if (editor.getHTML() === html) return
    editor.commands.setContent(html || '', { emitUpdate: false })
    setNoteIds(refIds(editor))
  }, [editor, html])

  const add = (task: Task) => {
    if (!editor || noteIds.has(task.id)) return
    haptic('tap')
    editor.chain().focus('end').insertTaskRef(task.id).run()
  }

  const shift = (days: number) => setDate(d => fmtYMD(addDays(toDate(d), days)))
  const isToday = date === TODAY()

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', minHeight: 0, overflow: 'hidden' }}>
      {!isMobile && <PullRail onAdd={add} inNote={noteIds} />}

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

        {isMobile && <PullStrip onAdd={add} inNote={noteIds} />}

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
          onDragOver={e => { if (e.dataTransfer.types.includes(TASK_DND)) { e.preventDefault(); setDropping(true) } }}
          onDragLeave={e => { if (e.target === e.currentTarget) setDropping(false) }}
          onDrop={() => setDropping(false)}
          style={{
            flex: 1, minHeight: 0, overflowY: 'auto',
            padding: isMobile ? '4px 16px 24px' : '4px 28px 40px',
            // 끌고 오는 동안만. 놓을 곳이 어디까지인지 말해 줍니다.
            boxShadow: dropping ? 'inset 0 0 0 2px var(--ac)' : 'none',
            transition: 'box-shadow .12s',
          }}
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
  const taken = mine.filter(t => inNote.has(t.id)).length

  return (
    <div style={{
      width: 264, flexShrink: 0, borderRight: '1px solid var(--bd)',
      display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg2)',
    }}>
      <div style={{ padding: '14px 14px 8px', flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>가져올 것</div>
        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
          {mine.length
            ? `내 업무 ${mine.length}개${taken ? ` · 오늘 ${taken}개` : ' · 마감 가까운 순'}`
            : '남은 게 없습니다'}
        </div>
      </div>

      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 20px',
        // 마지막 몇 픽셀만 흐려집니다. 스크롤이 끝까지 가면 아무것도 안 가립니다.
        maskImage: 'linear-gradient(to bottom, #000 calc(100% - 28px), transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 28px), transparent)',
      }}>
        {mine.map(t => <PullRow key={t.id} task={t} onAdd={onAdd} taken={inNote.has(t.id)} />)}
      </div>
    </div>
  )
}

/**
 * 목록의 한 줄.
 *
 * **담은 것도 목록에 남습니다.** 사라지게 했더니 누른 순간 줄이 없어져서, 방금
 * 뭘 담았는지가 화면에서 지워지고 아래 줄들이 위로 튀어 올랐습니다. 남겨 두고
 * 흐리게 + 체크로 표시하면 '이건 오늘 것'이라는 사실이 목록에도 남습니다.
 *
 * 끌어다 놓기도 됩니다. 손이 하려는 일을 손이 하게 두는 편이 낫고, `+`는 그게
 * 안 되는 곳(폰)과 그걸 모르는 사람을 위해 남습니다.
 */
function PullRow({ task, onAdd, taken }: { task: Task; onAdd: (t: Task) => void; taken: boolean }) {
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const projects = useProjectStore(s => s.projects)
  const openTaskDetail = useUiStore(s => s.openTaskDetail)
  const project = task.projectId ? projects.find(p => p.id === task.projectId) : undefined
  const diff = task.due ? daysFrom(task.due) : null
  const late = diff !== null && diff < 0 && !taken

  return (
    <div
      draggable={!taken}
      onDragStart={e => {
        e.dataTransfer.setData(TASK_DND, task.id)
        e.dataTransfer.effectAllowed = 'copy'
        setDragging(true)
      }}
      onDragEnd={() => setDragging(false)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 6px 6px 8px', borderRadius: 'var(--r2)',
        cursor: taken ? 'default' : 'grab',
        opacity: dragging ? .4 : taken ? .5 : 1,
        background: taken ? 'var(--ac-l)' : hovered ? 'var(--bg3)' : 'transparent',
        transition: 'opacity .12s, background .1s',
      }}
    >
      <div onClick={() => openTaskDetail(task.id)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
        <div style={{
          fontSize: 13, color: taken ? 'var(--t2)' : 'var(--t1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {task.name || '(이름 없음)'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, fontSize: 11, color: 'var(--t3)' }}>
          {taken ? (
            <span style={{ color: 'var(--ac)', fontWeight: 600 }}>오늘 목록에 있음</span>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      {taken ? (
        <span style={{ flexShrink: 0, width: 22, textAlign: 'center', color: 'var(--ac)', fontSize: 13 }}>✓</span>
      ) : (
        <button onClick={() => onAdd(task)} title="오늘 노트로" style={{
          flexShrink: 0, width: 22, height: 22, borderRadius: 'var(--r1)',
          border: 'none', cursor: 'pointer', fontFamily: 'var(--font)',
          background: hovered ? 'var(--ac)' : 'transparent',
          color: hovered ? '#fff' : 'var(--t3)', fontSize: 14, lineHeight: 1,
        }}>+</button>
      )}
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
  if (!mine.length) return null

  return (
    <div style={{
      display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0,
      padding: '4px 16px 10px', borderBottom: '1px solid var(--bd)',
    }}>
      {mine.slice(0, 20).map(t => {
        const taken = inNote.has(t.id)
        const diff = t.due ? daysFrom(t.due) : null
        const late = diff !== null && diff < 0 && !taken
        return (
          <button key={t.id} onClick={() => onAdd(t)} disabled={taken} style={{
            flexShrink: 0, maxWidth: 200, display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 10px', borderRadius: 999,
            cursor: taken ? 'default' : 'pointer',
            border: `1px solid ${taken ? 'var(--ac)' : 'var(--bd2)'}`,
            background: taken ? 'var(--ac-l)' : 'var(--bg)',
            fontFamily: 'var(--font)', fontSize: 12,
            color: taken ? 'var(--ac)' : 'var(--t1)',
          }}>
            <span style={{ fontSize: 13, lineHeight: 1, color: 'var(--ac)' }}>{taken ? '✓' : '+'}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
            {diff !== null && !taken && (
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

/** 문서 안의 업무 참조 id들. */
function refIds(editor: { state: { doc: { descendants: (f: (n: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void } } }): Set<string> {
  const ids = new Set<string>()
  editor.state.doc.descendants(n => {
    if (n.type.name === 'taskRef' && typeof n.attrs.taskId === 'string') ids.add(n.attrs.taskId)
  })
  return ids
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
