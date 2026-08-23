import { useCallback, useEffect, useRef, useState } from 'react'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { Icon } from '../../shared/Icon'
import { haptic } from '../../../lib/haptics'

/**
 * ── 블록 손잡이와 슬래시 메뉴 ────────────────────────────────────────────────
 *
 * 노션에서 사람들이 실제로 쓰는 두 가지입니다.
 *
 * **왼쪽 손잡이** — 줄에 마우스를 올리면 왼쪽 여백에 나타납니다. `⠿`를 끌면
 * 그 줄이 통째로 움직이고, 누르면 그 줄로 할 수 있는 일이 뜹니다. `+`는 아래에
 * 새 줄을 만들고 바로 슬래시 메뉴를 엽니다 — 슬래시를 쳐야 한다는 걸 모르는
 * 사람에게는 그게 유일한 입구입니다.
 *
 * **슬래시 메뉴** — 빈 줄에서 `/`를 치면 뜹니다. 뒤에 글자를 이어 치면 좁혀지고,
 * Enter로 고릅니다.
 *
 * 손잡이는 여백에 삽니다(왼쪽 바깥). 글줄 안에 두면 모든 줄이 한 칸씩 밀리고,
 * 그건 손잡이가 없는 동안에도 계속 치르는 값입니다.
 */

interface Slot { pos: number; top: number; left: number; height: number }

/** 커서가 놓인 최상위 블록의 위치. 문단 안 어디를 가리켜도 그 문단을 줍니다. */
function blockAt(editor: Editor, x: number, y: number): number | null {
  const found = editor.view.posAtCoords({ left: x, top: y })
  if (!found) return null
  const $p = editor.state.doc.resolve(found.pos)
  return $p.depth > 0 ? $p.before(1) : null
}

export function BlockTools({ editor, boundary }: {
  editor: Editor | null
  /** 손잡이의 좌표 기준이 되는 상자 — 노트가 스크롤해도 같이 움직입니다. */
  boundary: React.RefObject<HTMLElement | null>
}) {
  const [slot, setSlot] = useState<Slot | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; pos: number } | null>(null)
  const [slash, setSlash] = useState<{ x: number; y: number; from: number } | null>(null)

  /** 어느 줄 위에 있는지. 좌표는 기준 상자 안쪽으로 옮겨 둡니다. */
  const track = useCallback((e: React.MouseEvent) => {
    if (!editor || menu || slash) return
    const host = boundary.current
    if (!host) return
    const pos = blockAt(editor, e.clientX, e.clientY)
    if (pos === null) { setSlot(null); return }
    const dom = editor.view.nodeDOM(pos)
    if (!(dom instanceof HTMLElement)) { setSlot(null); return }
    const box = dom.getBoundingClientRect()
    const base = host.getBoundingClientRect()
    setSlot({
      pos,
      top: box.top - base.top + host.scrollTop,
      left: box.left - base.left,
      height: box.height,
    })
  }, [editor, boundary, menu, slash])

  /**
   * 줄 끌기.
   *
   * 프로즈미러가 이미 블록을 끌 줄 압니다 — 필요한 건 '이 블록이 선택됐다'고
   * 말해 주고 끌기 상태를 넘겨주는 것뿐입니다. 놓는 자리 계산과 되돌리기는
   * 전부 프로즈미러가 합니다.
   */
  const beginDrag = (e: React.DragEvent) => {
    if (!editor || !slot) return
    const { view } = editor
    const sel = NodeSelection.create(view.state.doc, slot.pos)
    view.dispatch(view.state.tr.setSelection(sel))
    const dom = view.nodeDOM(slot.pos)
    if (dom instanceof HTMLElement) e.dataTransfer.setDragImage(dom, 8, 8)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', '')
    view.dragging = { slice: sel.content(), move: true }
  }

  /** 오른쪽 클릭도 같은 메뉴를 엽니다. 손잡이를 못 찾은 사람을 위해. */
  useEffect(() => {
    const host = boundary.current
    if (!host || !editor) return
    const onContext = (e: MouseEvent) => {
      const pos = blockAt(editor, e.clientX, e.clientY)
      if (pos === null) return
      e.preventDefault()
      setMenu({ x: e.clientX, y: e.clientY, pos })
    }
    host.addEventListener('contextmenu', onContext)
    return () => host.removeEventListener('contextmenu', onContext)
  }, [editor, boundary])

  /**
   * `/`를 지켜봅니다.
   *
   * 커서 바로 앞이 `/`로 시작하는 짧은 토막이고, 그 앞이 줄의 시작이면 메뉴를
   * 엽니다. 문장 한가운데의 슬래시(날짜, 경로)까지 메뉴를 띄우면 메뉴가
   * 방해물이 됩니다.
   */
  useEffect(() => {
    if (!editor) return
    const check = () => {
      const { state } = editor
      const { $from, empty } = state.selection
      if (!empty) { setSlash(null); return }
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
      const m = /^\/(\S{0,18})$/.exec(before)
      if (!m) { setSlash(null); return }
      const at = editor.view.coordsAtPos($from.pos)
      setSlash({ x: at.left, y: at.bottom, from: $from.pos - before.length })
    }
    editor.on('transaction', check)
    return () => { editor.off('transaction', check) }
  }, [editor])

  if (!editor) return null

  return (
    <>
      <div onMouseMove={track} onMouseLeave={() => setSlot(null)} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {slot && !menu && (
          <div style={{
            position: 'absolute', top: slot.top, left: slot.left - 46,
            height: Math.min(slot.height, 30), display: 'flex', alignItems: 'center', gap: 1,
            pointerEvents: 'auto',
          }}>
            <HandleBtn
              title="아래에 새 줄"
              onClick={() => {
                const node = editor.state.doc.nodeAt(slot.pos)
                const after = slot.pos + (node?.nodeSize ?? 1)
                editor.chain().focus().insertContentAt(after, { type: 'paragraph' })
                  .setTextSelection(after + 1).insertContent('/').run()
              }}
            ><Icon name="plus" size={13} /></HandleBtn>
            <HandleBtn
              title="끌어서 이동 · 눌러서 메뉴"
              draggable
              onDragStart={beginDrag}
              onClick={e => {
                const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setMenu({ x: box.right + 4, y: box.top, pos: slot.pos })
              }}
            >⠿</HandleBtn>
          </div>
        )}
      </div>

      {menu && <BlockMenu editor={editor} {...menu} onClose={() => setMenu(null)} />}
      {slash && <SlashMenu editor={editor} {...slash} onClose={() => setSlash(null)} />}
    </>
  )
}

function HandleBtn({ children, title, onClick, draggable, onDragStart }: {
  children: React.ReactNode
  title: string
  onClick?: (e: React.MouseEvent) => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <span
      title={title}
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 20, height: 22, borderRadius: 'var(--r1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: draggable ? 'grab' : 'pointer', userSelect: 'none',
        color: 'var(--t3)', fontSize: 12, lineHeight: 1,
        background: hovered ? 'var(--bg3)' : 'transparent',
        transition: 'background .1s',
      }}
    >{children}</span>
  )
}

/* ── 줄로 할 수 있는 일 ── */

interface Turn { label: string; run: (e: Editor) => void }

const TURNS: Turn[] = [
  { label: '본문',       run: e => e.chain().focus().setParagraph().run() },
  { label: '할 일',      run: e => e.chain().focus().toggleTaskList().run() },
  { label: '제목 1',     run: e => e.chain().focus().setNode('heading', { level: 1 }).run() },
  { label: '제목 2',     run: e => e.chain().focus().setNode('heading', { level: 2 }).run() },
  { label: '제목 3',     run: e => e.chain().focus().setNode('heading', { level: 3 }).run() },
  { label: '글머리 기호', run: e => e.chain().focus().toggleBulletList().run() },
  { label: '번호 목록',   run: e => e.chain().focus().toggleOrderedList().run() },
  { label: '인용',       run: e => e.chain().focus().toggleBlockquote().run() },
]

function BlockMenu({ editor, x, y, pos, onClose }: {
  editor: Editor; x: number; y: number; pos: number; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === 'Escape') onClose(); return }
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [onClose])

  /** 무엇을 하든 먼저 그 줄 안에 커서를 놓습니다. */
  const inside = () => {
    const { doc, tr } = editor.state
    const node = doc.nodeAt(pos)
    if (!node) return false
    editor.view.dispatch(tr.setSelection(TextSelection.create(doc, Math.min(pos + 1, doc.content.size - 1))))
    return true
  }

  const act = (run: () => void) => { if (inside()) { run(); haptic('tap') } onClose() }

  const node = editor.state.doc.nodeAt(pos)
  const isRef = node?.type.name === 'taskRef'

  return (
    <div ref={ref} style={{
      position: 'fixed', left: Math.min(x, window.innerWidth - 188), top: Math.min(y, window.innerHeight - 300),
      width: 180, zIndex: 600, background: 'var(--bg)', border: '1px solid var(--bd)',
      borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)', padding: 4, userSelect: 'none',
    }}>
      {/* 업무 줄은 전환할 게 없습니다 — 태스크를 문단으로 만들 수는 없으니까요. */}
      {!isRef && (
        <>
          <Label>전환</Label>
          {TURNS.map(t => (
            <Item key={t.label} onClick={() => act(() => t.run(editor))}>{t.label}</Item>
          ))}
          <Rule />
        </>
      )}
      <Item onClick={() => act(() => {
        const n = editor.state.doc.nodeAt(pos)
        if (!n) return
        editor.view.dispatch(editor.state.tr.insert(pos + n.nodeSize, n.copy(n.content)))
      })}>복제</Item>
      <Item danger onClick={() => act(() => {
        const n = editor.state.doc.nodeAt(pos)
        if (!n) return
        editor.view.dispatch(editor.state.tr.delete(pos, pos + n.nodeSize))
      })}>삭제</Item>
    </div>
  )
}

/* ── 슬래시 메뉴 ── */

const SLASH: { label: string; hint: string; run: (e: Editor) => void }[] = [
  { label: '할 일',      hint: '체크박스 한 줄',   run: e => e.chain().focus().toggleTaskList().run() },
  { label: '제목 1',     hint: '가장 큰 제목',     run: e => e.chain().focus().setNode('heading', { level: 1 }).run() },
  { label: '제목 2',     hint: '',                run: e => e.chain().focus().setNode('heading', { level: 2 }).run() },
  { label: '제목 3',     hint: '',                run: e => e.chain().focus().setNode('heading', { level: 3 }).run() },
  { label: '글머리 기호', hint: '',                run: e => e.chain().focus().toggleBulletList().run() },
  { label: '번호 목록',   hint: '',                run: e => e.chain().focus().toggleOrderedList().run() },
  { label: '인용',       hint: '',                run: e => e.chain().focus().toggleBlockquote().run() },
  { label: '구분선',     hint: '가로줄 하나',      run: e => e.chain().focus().setHorizontalRule().run() },
  { label: '코드',       hint: '',                run: e => e.chain().focus().toggleCodeBlock().run() },
]

function SlashMenu({ editor, x, y, from, onClose }: {
  editor: Editor; x: number; y: number; from: number; onClose: () => void
}) {
  const [pick, setPick] = useState(0)
  const query = editor.state.selection.$from.parent
    .textBetween(0, editor.state.selection.$from.parentOffset, undefined, '')
    .slice(1)
    .toLowerCase()

  const items = SLASH.filter(i => !query || i.label.toLowerCase().includes(query))

  const choose = (i: number) => {
    const item = items[i]
    if (!item) { onClose(); return }
    // 친 `/…`는 지웁니다. 남겨 두면 명령어가 글로 남습니다.
    editor.chain().focus().deleteRange({ from, to: editor.state.selection.$from.pos }).run()
    item.run(editor)
    haptic('tap')
    onClose()
  }

  useEffect(() => { setPick(0) }, [query])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setPick(p => (p + 1) % Math.max(items.length, 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPick(p => (p - 1 + items.length) % Math.max(items.length, 1)) }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); choose(pick) }
    }
    // capture: 편집기가 Enter를 먼저 먹으면 줄만 하나 늘어납니다.
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  })

  if (!items.length) return null

  return (
    <div style={{
      position: 'fixed', left: Math.min(x, window.innerWidth - 232),
      top: Math.min(y + 4, window.innerHeight - 300),
      width: 224, zIndex: 600, background: 'var(--bg)', border: '1px solid var(--bd)',
      borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)', padding: 4,
      maxHeight: 280, overflowY: 'auto', userSelect: 'none',
    }}>
      {items.map((item, i) => (
        <div
          key={item.label}
          onMouseEnter={() => setPick(i)}
          onMouseDown={e => { e.preventDefault(); choose(i) }}
          style={{
            display: 'flex', alignItems: 'baseline', gap: 8,
            padding: '6px 9px', borderRadius: 'var(--r1)', cursor: 'pointer',
            background: i === pick ? 'var(--bg3)' : 'transparent',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--t1)' }}>{item.label}</span>
          {item.hint && <span style={{ fontSize: 11, color: 'var(--t3)' }}>{item.hint}</span>}
        </div>
      ))}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '6px 9px 3px', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', color: 'var(--t3)' }}>{children}</div>
}

function Rule() {
  return <div style={{ height: 1, background: 'var(--bd)', margin: '4px -4px' }} />
}

function Item({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '6px 9px', borderRadius: 'var(--r1)', cursor: 'pointer', fontSize: 13,
        color: danger ? 'var(--danger)' : 'var(--t1)',
        background: hovered ? (danger ? 'var(--danger-l)' : 'var(--bg3)') : 'transparent',
      }}
    >{children}</div>
  )
}
