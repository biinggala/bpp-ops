import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { useTaskStore } from '../../../store/taskStore'
import { useAuthStore } from '../../../store/authStore'
import { useProjectStore } from '../../../store/projectStore'
import { useSyncStore } from '../../../store/syncStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { useUiStore } from '../../../store/uiStore'
import { useMobile } from '../../../hooks/useMobile'
import { useDailyNote } from '../../../hooks/useDailyNote'
import { isAssignedTo, daysFrom, fmtYMD, addDays, toDate } from '../../../lib/utils'
import { haptic } from '../../../lib/haptics'
import { TaskRef, TASK_DND } from './TaskRef'
import { FileRef } from './FileRef'
import { MarkdownTasks } from './markdown'
import { DayTimeline } from './DayTimeline'
import { BlockTools } from './BlockTools'
import { LoadingChips } from '../../shared/Loading'
import type { Task } from '../../../types'
import { useShallow } from 'zustand/react/shallow'

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

/**
 * 빈 노트가 번갈아 하는 말.
 *
 * 초대 → 옆에 있는 것을 여기로 가져오는 법 → 안심 → 하나뿐인 조작법.
 * 넷 다 처음 온 사람에게 필요한데 한 줄에 다 넣으면 문단이 되고, 문단이 된
 * 안내는 안 읽힙니다.
 *
 * 가져오는 법이 기기마다 다릅니다 — 데스크톱에는 왼쪽에 '가져올 것'이
 * 세로로 서 있고 끌어다 놓지만, 폰에는 위에 가로 띠가 있고 눌러서 담습니다.
 * "왼쪽에서 끌어다 놓으세요"는 폰에서 없는 곳을 가리키는 말입니다.
 */
const HINTS = (mobile: boolean) => [
  '오늘 무엇부터 할까요?',
  mobile
    ? '위의 업무를 누르면 오늘 노트에 담깁니다'
    : '왼쪽의 업무를 끌어다 놓으면 오늘 할 일이 됩니다',
  '여기 적는 것은 나만 볼 수 있습니다',
  "'/'를 누르면 업무와 자료를 넣을 수 있습니다",
]
const HINT_MS = 4200

/**
 * 손잡이가 서는 자리.
 *
 * 글줄은 이만큼 안으로 들어가 있고, 날짜 제목도 같이 들어가야 합니다 — 제목이
 * 왼쪽으로 튀어나와 있으면 노트 전체가 한 칸 밀린 것처럼 보입니다. 한 군데서
 * 정해 두 곳이 같이 씁니다.
 */
const GUTTER = 46

export function TodayView() {
  const isMobile = useMobile()
  const stored = useUiStore(s => s.noteDate)
  const openNote = useUiStore(s => s.openNote)
  const date = stored ?? TODAY()
  const setDate = (next: string | ((d: string) => string)) =>
    openNote(typeof next === 'function' ? next(date) : next)
  const { html, save, saving } = useDailyNote(date)
  /**
   * 지금 노트 안에 있는 업무들.
   *
   * 저장된 html을 훑지 않고 편집기의 문서에서 바로 읽습니다. 저장은 1.2초
   * 뒤에 나가므로, html을 보면 방금 담은 업무가 잠시 동안 '아직 안 담김'으로
   * 보입니다 — 왼쪽 칩이 눌렀는데 1초쯤 아무 반응이 없는 셈입니다.
   */
  /**
   * 지금 노트 안에 있는 업무들.
   *
   * 날짜를 넘기면 비웁니다 — 어제 노트에 담긴 업무 id가 남아 있으면, 왼쪽
   * '가져올 것'이 오늘은 안 담은 업무를 '이미 담김'으로 회색 처리합니다.
   */
  const [noteIds, setNoteIds] = useState<Set<string>>(() => new Set())
  const hintRef = useRef(0)
  /**
   * 안내문은 편집기가 만들어질 때 한 번 묶인 함수가 읽습니다. 그 함수는
   * 리렌더를 모르므로, 화면 크기가 바뀌었다는 사실은 ref로 건네야 합니다.
   */
  const mobileRef = useRef(isMobile)
  mobileRef.current = isMobile
  const [dropping, setDropping] = useState(false)
  const noteRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false, autolink: true, defaultProtocol: 'https',
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
        },
      }),
      // 안내문은 하나가 아니라 셋이 돌아갑니다 — HINTS 참고. 여기서는
      // 지금 차례인 것을 읽어 주기만 합니다.
      Placeholder.configure({ placeholder: () => HINTS(mobileRef.current)[hintRef.current] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TaskRef,
      FileRef,
      MarkdownTasks,
    ],
    content: '',
    editorProps: {
      attributes: { class: 'ProseMirror today-note' },
      /**
       * 왼쪽에서 끌어다 놓기.
       *
       * **좌표로 묻지 않고 줄들의 상자를 직접 잽니다.** `posAtCoords`는 편집
       * 가능한 곳만 답합니다 — 업무 줄은 contentEditable=false 라 그 위에
       * 떨어뜨리면 null이 오고, 그러면 문서 끝으로 밀려납니다. 업무 사이에
       * 놓으려던 게 매번 맨 아래에 생기던 이유입니다.
       *
       * 대신 최상위 줄들을 훑어 포인터에 가장 가까운 줄을 찾고, 그 줄의
       * 위 절반이면 앞에, 아래 절반이면 뒤에 놓습니다. 빈 줄이면 그 줄을
       * 대신합니다 — 빈 줄을 겨냥한 사람은 거기 넣고 싶은 것이지 그 옆에
       * 빈 줄을 하나 더 갖고 싶은 게 아닙니다.
       */
      handleDrop(view, event, _slice, moved) {
        if (moved) return false
        const ev = event as DragEvent
        const taskId = ev.dataTransfer?.getData(TASK_DND)
        if (!taskId) return false
        event.preventDefault()

        const doc = view.state.doc
        const node = view.state.schema.nodes.taskRef.create({ taskId })

        let near: { start: number; size: number; mid: number; empty: boolean } | null = null
        doc.forEach((child, offset) => {
          const dom = view.nodeDOM(offset)
          if (!(dom instanceof HTMLElement)) return
          const box = dom.getBoundingClientRect()
          const mid = box.top + box.height / 2
          if (!near || Math.abs(ev.clientY - mid) < Math.abs(ev.clientY - near.mid)) {
            near = {
              start: offset, size: child.nodeSize, mid,
              empty: child.type.name === 'paragraph' && child.content.size === 0,
            }
          }
        })

        const t = near as { start: number; size: number; mid: number; empty: boolean } | null
        if (!t) {
          view.dispatch(view.state.tr.insert(doc.content.size, node))
          return true
        }
        if (t.empty) {
          view.dispatch(view.state.tr.replaceWith(t.start, t.start + t.size, node))
          return true
        }
        view.dispatch(view.state.tr.insert(ev.clientY > t.mid ? t.start + t.size : t.start, node))
        return true
      },
    },
    onUpdate: ({ editor }) => { save(editor.getHTML()); setNoteIds(refIds(editor)) },
  }, [date])

  useEffect(() => { setNoteIds(new Set()) }, [date])

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

  /**
   * ── 빈 노트가 하는 말 ──────────────────────────────────────────────────────
   *
   * 한 줄에 세 가지를 적으면 아무도 안 읽습니다. 그래서 한 번에 하나씩,
   * 몇 초마다 갈아 끼웁니다 — 빈 화면은 어차피 아무 일도 안 일어나는
   * 자리라, 거기서 천천히 바뀌는 글자는 방해가 아니라 유일한 움직임입니다.
   *
   * 안내문 자리는 Placeholder 확장이 그립니다(::before). 그 글자를 바꾸려면
   * 장식을 다시 계산하게 해야 하는데, 타이머는 그럴 이유를 못 만듭니다 —
   * 그래서 아무것도 바꾸지 않는 트랜잭션을 한 번 던집니다.
   *
   * 사라졌다 나타나는 건 CSS가 합니다. 글자를 갈기 직전에 .hint-out을 붙여
   * 투명하게 만들고, 갈아 끼운 다음 떼어 냅니다(index.css).
   */
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    // 죽은 편집기부터 걸러냅니다. isEmpty는 문서를 읽으므로, 파괴된 편집기에
    // 물으면 그 자리에서 던집니다 — 순서가 바뀌어 있었습니다.
    let swap: number | null = null
    const timer = setInterval(() => {
      if (editor.isDestroyed) return
      // 뭔가 적기 시작하면 안내문은 이미 화면에 없습니다. 없는 글자를
      // 갈아 끼우느라 편집기를 건드릴 이유가 없습니다.
      if (!editor.isEmpty) return
      dom.classList.add('hint-out')
      swap = window.setTimeout(() => {
        swap = null
        if (editor.isDestroyed) return
        hintRef.current = (hintRef.current + 1) % HINTS(mobileRef.current).length
        editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
        dom.classList.remove('hint-out')
      }, 280)
    }, HINT_MS)
    // 안쪽 타이머도 같이 거둡니다. 날짜를 넘기는 순간이 이 280ms 안이면
    // 이미 없는 편집기를 건드리게 됩니다.
    return () => { clearInterval(timer); if (swap !== null) clearTimeout(swap) }
  }, [editor])

  const shift = (days: number) => setDate(d => fmtYMD(addDays(toDate(d), days)))
  const isToday = date === TODAY()

  /**
   * ── 시간 축을 보일까 ────────────────────────────────────────────────────────
   *
   * 처음엔 창 너비만 보고 1320px 아래에서는 숨겼습니다. 그게 틀렸습니다 —
   * 노트북 화면에서는 그 아래인 경우가 흔해서, 만들어 놓고 아무도 못 보는
   * 기능이 됐습니다. 자동으로 사라지는 것과 없는 것은 화면에서 구별되지
   * 않습니다.
   *
   * 그래서 **켜고 끄는 건 사람이** 합니다 — 툴바 오른쪽 끝의 칸 버튼(⌘⇧\),
   * 왼쪽 사이드바 버튼과 짝입니다. 너비는 정말로 못 그리는 폭에서만 개입합니다.
   */
  const tooNarrow = useMobile(1000)
  const dayRail = useUiStore(s => s.dayRail)
  const showRail = dayRail && !tooNarrow && !isMobile

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', minHeight: 0, overflow: 'hidden' }}>
      {!isMobile && <PullRail onAdd={add} inNote={noteIds} />}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          padding: isMobile ? '10px 16px 6px' : `14px 28px 8px ${28 + GUTTER}px`,
        }}>
          <span style={{ fontSize: isMobile ? 16 : 18, fontWeight: 700, color: 'var(--t1)' }}>
            {dayLabel(date)}
          </span>
          {!isToday && (
            <button onClick={() => openNote(null)} style={GHOST}>오늘로</button>
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
          ref={noteRef}
          style={{
            position: 'relative',
            flex: 1, minHeight: 0, overflowY: 'auto',
            padding: isMobile ? '4px 16px 24px' : '4px 28px 40px',
            // 끌고 오는 동안만. 놓을 곳이 어디까지인지 말해 줍니다.
            boxShadow: dropping ? 'inset 0 0 0 2px var(--ac)' : 'none',
            transition: 'box-shadow .12s',
          }}
        >
          {/* 손잡이가 설 자리를 왼쪽에 비워 둡니다. 폰에는 여백도 손도 없어서
              손잡이가 없고, 그래서 자리도 안 비웁니다. */}
          <div style={{ maxWidth: 720, marginLeft: isMobile ? 0 : GUTTER }}>
            <EditorContent editor={editor} />
          </div>

          {/*
            노트가 아직 안 왔습니다.
            html이 null인 동안 편집기는 빈 문서라, 어제 잔뜩 적어 둔 사람에게도
            '오늘 무엇부터 할까요?'가 먼저 뜹니다 — 빈 노트와 안 온 노트가
            화면에서 같습니다. 편집기는 그대로 두고(도착하면 채워집니다) 그
            위에 들어올 것의 모양만 덮습니다.
          */}
          {html === null && (
            <div style={{
              position: 'absolute', top: isMobile ? 4 : 4, left: isMobile ? 16 : 28 + GUTTER,
              right: 28, display: 'flex', flexDirection: 'column', gap: 12,
              pointerEvents: 'none', background: 'var(--bg)', paddingTop: 6,
            }}>
              {['64%', '48%', '72%', '38%'].map((w, i) => (
                <div key={i} className="bpp-skel" style={{ width: w, height: 13 }} />
              ))}
            </div>
          )}
          {!isMobile && <BlockTools editor={editor} boundary={noteRef} date={date} />}
        </div>
      </div>

      {/*
        노트가 '무엇을'이라면 이쪽은 '자리가 있나'입니다. 읽기만 하고,
        여기에 무언가를 놓는 동작은 없습니다 — DayTimeline 맨 위 주석 참고.
      */}
      {showRail && <DayTimeline date={date} />}
    </div>
  )
}

/** 오늘 아침에 눈에 들어와야 하는 순서: 지난 것, 가까운 것, 날짜 없는 것. */
function useMine(): Task[] {
  const tasks = useTaskStore(s => s.tasks)
  const { memberKey, email } = useAuthStore(useShallow(s => ({ memberKey: s.memberKey, email: s.email })))
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
/**
 * 묶는 방법.
 *
 * 기본은 마감순입니다 — 아침에 답해야 하는 질문이 '뭐가 급하지'니까요. 다만
 * 그냥 죽 늘어놓으면 스무 개째부터 지금 보는 게 이번 주인지 다음 달인지
 * 모르게 되므로, 얇은 머리글로 끊습니다.
 *
 * 프로젝트별은 다른 질문에 답합니다: '오늘은 프렌즈룸만 볼래'. 프로젝트가
 * 여남은 개 되는 사람에게는 이쪽이 더 자주 필요합니다.
 */
type RailGroup = 'due' | 'project'

const RAIL_KEY = 'today_rail_group'

function loadRailGroup(): RailGroup {
  try { return localStorage.getItem(RAIL_KEY) === 'project' ? 'project' : 'due' } catch { return 'due' }
}

/** 마감이 언제냐를 사람이 쓰는 말로. */
function dueBucket(due: string | undefined): { key: string; label: string; tone?: string } {
  if (!due) return { key: 'none', label: '날짜 없음' }
  const d = daysFrom(due)
  if (d < 0) return { key: 'late', label: '지남', tone: 'var(--danger)' }
  if (d === 0) return { key: 'today', label: '오늘', tone: '#D9730D' }
  if (d <= 7) return { key: 'week', label: '이번 주' }
  if (d <= 30) return { key: 'month', label: '이번 달' }
  return { key: 'later', label: '나중' }
}

function PullRail({ onAdd, inNote }: { onAdd: (t: Task) => void; inNote: Set<string> }) {
  const mine = useMine()
  const projects = useProjectStore(s => s.projects)
  const ready = useSyncStore(s => s.ready)
  const [group, setGroup] = useState<RailGroup>(loadRailGroup)
  /**
   * 아래가 더 있는지.
   *
   * 페이드를 늘 걸어 두면 끝까지 내려도 마지막 줄이 흐린 채로 남습니다 —
   * 더 있다는 신호여야 할 것이 '여기는 못 간다'는 말이 됩니다.
   */
  const [more, setMore] = useState(false)

  const taken = mine.filter(t => inNote.has(t.id)).length

  const sections = useMemo(() => {
    if (group === 'project') {
      const by = new Map<string, { label: string; dot?: string; tasks: Task[] }>()
      for (const t of mine) {
        const p = t.projectId ? projects.find(pr => pr.id === t.projectId) : undefined
        const key = p?.id ?? '__none__'
        if (!by.has(key)) by.set(key, { label: p?.name ?? '프로젝트 없음', dot: p?.color, tasks: [] })
        by.get(key)!.tasks.push(t)
      }
      // 남은 게 많은 프로젝트가 위로. 오늘 신경 쓸 게 많은 쪽입니다.
      return [...by.values()].sort((a, b) => b.tasks.length - a.tasks.length)
    }
    const by = new Map<string, { label: string; tone?: string; tasks: Task[] }>()
    for (const t of mine) {
      const b = dueBucket(t.due)
      if (!by.has(b.key)) by.set(b.key, { label: b.label, tone: b.tone, tasks: [] })
      by.get(b.key)!.tasks.push(t)
    }
    return [...by.values()]
  }, [mine, group, projects])

  const pick = (g: RailGroup) => {
    setGroup(g)
    try { localStorage.setItem(RAIL_KEY, g) } catch { /* private mode */ }
  }

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4)
  }

  return (
    <div style={{
      width: 264, flexShrink: 0, borderRight: '1px solid var(--bd)',
      display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg2)',
    }}>
      <div style={{ padding: '14px 12px 8px', flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>가져올 것</div>
        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
          {!ready
            ? '불러오는 중…'
            : mine.length
              ? `내 업무 ${mine.length}개${taken ? ` · 오늘 ${taken}개` : ''}`
              : '남은 게 없습니다'}
        </div>
        {ready && mine.length > 0 && (
          <div style={{ display: 'flex', gap: 2, marginTop: 8, padding: 2, borderRadius: 'var(--r2)', background: 'var(--bg3)' }}>
            <RailTab on={group === 'due'} onClick={() => pick('due')}>마감순</RailTab>
            <RailTab on={group === 'project'} onClick={() => pick('project')}>프로젝트별</RailTab>
          </div>
        )}
      </div>

      <div
        ref={el => { if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4) }}
        onScroll={onScroll}
        style={{
          flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 20px',
          maskImage: more ? 'linear-gradient(to bottom, #000 calc(100% - 26px), transparent)' : 'none',
          WebkitMaskImage: more ? 'linear-gradient(to bottom, #000 calc(100% - 26px), transparent)' : 'none',
        }}
      >
        {/* 아직 안 온 것을 '남은 게 없습니다'라고 하면, 오늘 할 일이 없다는
            아주 반가운 거짓말이 됩니다. */}
        {!ready && <LoadingChips />}
        {ready && sections.map(sec => (
          <div key={sec.label}>
            {/* 스크롤해도 붙어 있습니다. 열 개째 줄에서 지금 보는 게 어느
                프로젝트인지 모르면 묶어 놓은 값이 없습니다. */}
            <div style={{
              position: 'sticky', top: 0, zIndex: 1,
              display: 'flex', alignItems: 'center', gap: 5,
              margin: '8px -8px 2px', padding: '5px 14px',
              background: 'var(--bg2)',
              borderTop: '1px solid var(--bd)',
              fontSize: 11, fontWeight: 700,
              color: ('tone' in sec && sec.tone) ? sec.tone : 'var(--t2)',
            }}>
              {'dot' in sec && sec.dot && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: sec.dot, flexShrink: 0 }} />
              )}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sec.label}</span>
              {/* 아래 줄들의 `+`와 같은 22px 상자에 가운데로. 머리글은 오른쪽
                  끝에 붙이고 `+`는 제 상자 안에 가운데 있어서, 둘이 11px씩
                  어긋난 채로 세로로 늘어서 있었습니다. */}
              <span style={{ marginLeft: 'auto', opacity: .7, letterSpacing: 0, width: 22, textAlign: 'center', flexShrink: 0 }}>
                {sec.tasks.length}
              </span>
            </div>
            {sec.tasks.map(t => (
              <PullRow key={t.id} task={t} onAdd={onAdd} taken={inNote.has(t.id)} grouping={group} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function RailTab({ children, on, onClick }: { children: React.ReactNode; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '4px 0', borderRadius: 'var(--r1)', border: 'none', cursor: 'pointer',
      fontFamily: 'var(--font)', fontSize: 11, fontWeight: on ? 600 : 400,
      color: on ? 'var(--t1)' : 'var(--t3)',
      background: on ? 'var(--bg)' : 'transparent',
      transition: 'background .1s, color .1s',
    }}>{children}</button>
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
function PullRow({ task, onAdd, taken, grouping }: {
  task: Task; onAdd: (t: Task) => void; taken: boolean; grouping: RailGroup
}) {
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const projects = useProjectStore(s => s.projects)
  const milestones = useMilestoneStore(s => s.milestones)
  const openTaskDetail = useUiStore(s => s.openTaskDetail)
  const diff = task.due ? daysFrom(task.due) : null
  const late = diff !== null && diff < 0 && !taken

  /**
   * 줄이 말해야 하는 건 **머리글이 안 말한 것**입니다.
   *
   * 프로젝트별로 묶어 놓고 줄마다 프로젝트 이름을 또 적으면, 스무 줄에 같은
   * 이름이 스무 번 나오면서 정작 그 줄들을 구분해 주는 건 아무것도 없습니다.
   * 그 안에서 다른 건 마일스톤이고요. 마감순으로 묶었을 때는 반대로 프로젝트가
   * 그 줄을 구분해 줍니다.
   */
  const mark = grouping === 'project'
    ? (() => {
        const m = task.milestoneId ? milestones.find(ms => ms.id === task.milestoneId) : undefined
        return m ? { label: m.name, dot: undefined, diamond: true } : null
      })()
    : (() => {
        const p = task.projectId ? projects.find(pr => pr.id === task.projectId) : undefined
        return p ? { label: p.name, dot: p.color, diamond: false } : null
      })()

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
          {/* 담긴 줄에도 마감과 프로젝트는 그대로 둡니다. 그 자리에 '오늘
              목록에 있음'을 넣었더니 이미 흐림과 ✓가 하고 있는 말을 한 번 더
              하면서, 정작 필요한 정보를 밀어냈습니다. */}
          {diff !== null && (
            <span style={{ fontWeight: 700, color: late ? 'var(--danger)' : diff <= 2 && !taken ? '#D9730D' : 'var(--t3)' }}>
              {late ? `D+${Math.abs(diff)}` : diff === 0 ? 'D-Day' : `D-${diff}`}
            </span>
          )}
          {mark && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              {mark.diamond
                ? <span style={{ color: '#9065B0', fontSize: 9, flexShrink: 0 }}>◆</span>
                : <span style={{ width: 5, height: 5, borderRadius: '50%', background: mark.dot, flexShrink: 0 }} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mark.label}</span>
            </span>
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
      {mine.map(t => {
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
