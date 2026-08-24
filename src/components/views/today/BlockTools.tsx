import { useEffect, useMemo, useRef, useState } from 'react'
import { writeTimeblock } from '../../../lib/timeblock'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { Icon } from '../../shared/Icon'
import { haptic } from '../../../lib/haptics'
import { DriveSearch } from '../../shared/DriveFiles'
import type { DriveFile } from '../../../lib/googleDrive'
import { driveUrl } from '../../../lib/googleDrive'
import { useTaskStore } from '../../../store/taskStore'
import { useAuthStore } from '../../../store/authStore'
import { useProjectStore } from '../../../store/projectStore'
import { useUiStore } from '../../../store/uiStore'
import { isAssignedTo } from '../../../lib/utils'

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

interface Slot { pos: number; top: number; left: number; height: number; item: number | null }

/**
 * 포인터가 가리키는 **체크박스 한 줄**의 위치.
 *
 * 손잡이가 잡는 것은 최상위 블록이라, 체크박스 목록에서는 목록 전체가 잡힙니다.
 * 하지만 '업무로 만들기'는 목록이 아니라 **그중 한 줄**에 대한 일입니다.
 *
 * 겹쳐 있는 목록(중첩 체크박스)에서는 안쪽 것을 고릅니다 — 바깥 항목의 상자는
 * 안쪽 것을 품고 있어서, 바깥부터 찾으면 늘 부모가 걸립니다.
 */
function taskItemAt(editor: Editor, x: number, y: number): number | null {
  /**
   * **상자로 먼저 찾습니다.**
   *
   * 전에는 posAtCoords에게만 물었습니다. 그런데 그건 글이 있는 자리만
   * 답합니다 — 손잡이가 사는 왼쪽 여백이나 체크박스 동그라미 위에서는
   * 답이 없거나, 더 나쁘게는 **가장 가까운 글자**를 답합니다. 그 글자가
   * 윗줄 끝인 경우가 흔해서, 둘째 줄에 마우스를 올렸는데 손잡이가 첫째
   * 줄에 서는 일이 생겼습니다(신고된 그것).
   *
   * 세로 위치는 거짓말을 안 합니다. y를 품는 상자를 찾고, 그중 **가장 작은**
   * 것을 고릅니다 — 중첩 목록에서 바깥 항목은 안쪽 것을 품고 있으므로 큰
   * 쪽은 언제나 부모입니다. blockAt이 같은 이유로 쓰는 방법입니다.
   */
  let best: { pos: number; height: number } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'taskItem') return true
    const dom = editor.view.nodeDOM(pos)
    if (!(dom instanceof HTMLElement)) return true
    const box = dom.getBoundingClientRect()
    if (y < box.top || y > box.bottom) return true
    const hit = best as { pos: number; height: number } | null
    if (!hit || box.height < hit.height) best = { pos, height: box.height }
    return true
  })
  const found = best as { pos: number; height: number } | null
  if (found) return found.pos

  // 상자 밖(줄 사이의 미세한 틈)이면 프로즈미러에게 물어봅니다.
  const at = editor.view.posAtCoords({ left: x, top: y })
  if (!at) return null
  const $p = editor.state.doc.resolve(at.pos)
  for (let d = $p.depth; d > 0; d--) {
    if ($p.node(d).type.name === 'taskItem') return $p.before(d)
  }
  return null
}

/**
 * 포인터가 가리키는 최상위 블록의 위치.
 *
 * 먼저 프로즈미러에게 묻고, 안 되면 **줄들의 상자를 직접 잽니다.**
 * `posAtCoords`는 글이 있는 자리만 답합니다 — 손잡이가 사는 왼쪽 여백이나
 * 업무 줄(contentEditable=false) 위에서는 null입니다. 그걸 '블록 없음'으로
 * 받으면, 손잡이를 잡으러 가는 순간 손잡이가 사라집니다.
 *
 * 세로 위치만 알면 어느 줄인지는 정해집니다. 그래서 실패하면 y로 찾습니다.
 */
function blockAt(editor: Editor, x: number, y: number): number | null {
  const found = editor.view.posAtCoords({ left: x, top: y })
  if (found) {
    const $p = editor.state.doc.resolve(found.pos)
    if ($p.depth > 0) return $p.before(1)
  }
  let near: { start: number; gap: number } | null = null
  editor.state.doc.forEach((_child, offset) => {
    const dom = editor.view.nodeDOM(offset)
    if (!(dom instanceof HTMLElement)) return
    const box = dom.getBoundingClientRect()
    const gap = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0
    if (!near || gap < near.gap) near = { start: offset, gap }
  })
  const hit = near as { start: number; gap: number } | null
  // 줄에서 한참 떨어진 곳(노트 아래 빈 공간)까지 손잡이를 띄우지는 않습니다.
  return hit && hit.gap <= 12 ? hit.start : null
}

export function BlockTools({ editor, boundary, date }: {
  editor: Editor | null
  /** 손잡이의 좌표 기준이 되는 상자 — 노트가 스크롤해도 같이 움직입니다. */
  boundary: React.RefObject<HTMLElement | null>
  /** 이 노트의 날짜. 승격한 업무의 마감이 됩니다 — 오늘 적은 건 오늘 할 일입니다. */
  date: string
}) {
  const [slot, setSlot] = useState<Slot | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; pos: number; item: number | null } | null>(null)
  const [slash, setSlash] = useState<{ x: number; y: number; from: number } | null>(null)
  /** `/자료`로 연 드라이브 찾기 창. 열려 있는 동안은 손잡이도 멈춥니다. */
  const [finder, setFinder] = useState<{ x: number; y: number } | null>(null)

  /**
   * 어느 줄 위에 있는지.
   *
   * 노트 상자에 직접 겁니다. 처음에는 손잡이를 담은 덮개에 걸었는데, 그
   * 덮개가 `pointer-events: none`이라 마우스가 지나가도 아무 일이 없었습니다 —
   * 손잡이가 영영 안 뜨던 이유입니다. 통과시키는 요소는 이벤트도 통과시킵니다.
   */
  const frozen = useRef(false)
  frozen.current = !!menu || !!slash || !!finder
  const handleRef = useRef<HTMLDivElement>(null)

  /**
   * 편집기가 바뀌면 들고 있던 자리는 전부 버립니다.
   *
   * 날짜를 넘기면 노트가 새로 만들어집니다. 그런데 slot·menu·slash는 **앞
   * 문서의 위치**를 숫자로 들고 있었습니다. 어제 노트가 길고 오늘 노트가
   * 짧으면 그 숫자는 새 문서에 없는 자리이고, 그걸로 무언가를 하려는 순간
   * 프로즈미러가 '범위를 벗어났다'며 던집니다 — 화면이 통째로 멈춥니다.
   *
   * 위치는 문서에 붙은 값이라 문서를 넘어 살아 있으면 안 됩니다.
   */
  useEffect(() => {
    setSlot(null); setMenu(null); setSlash(null); setFinder(null)
  }, [editor])

  useEffect(() => {
    const host = boundary.current
    if (!host || !editor) return
    const move = (e: MouseEvent) => {
      if (frozen.current || editor.isDestroyed) return
      // 손잡이 위에 있는 동안은 아무것도 다시 재지 않습니다. 잡으러 온 손이
      // 자기가 잡으려던 것을 지우게 두면 그건 잡을 수 없는 손잡이입니다.
      if (e.target instanceof Node && handleRef.current?.contains(e.target)) return
      const pos = blockAt(editor, e.clientX, e.clientY)
      if (pos === null) { setSlot(null); return }
      const dom = editor.view.nodeDOM(pos)
      if (!(dom instanceof HTMLElement)) { setSlot(null); return }
      /**
       * 체크박스 줄 위에서는 **그 줄**에 손잡이를 붙입니다.
       *
       * 최상위 블록은 목록 전체라, 다섯 줄짜리 목록의 셋째 줄에 마우스를
       * 올려도 손잡이는 목록 맨 위에 섰습니다. 그 손잡이가 여는 메뉴에는
       * 이제 '이 줄'에 대한 항목이 있는데, 어느 줄인지 화면이 말해 주지
       * 않으면 그 항목은 짐작으로 누르는 것이 됩니다.
       */
      const item = taskItemAt(editor, e.clientX, e.clientY)
      const rowDom = item !== null ? editor.view.nodeDOM(item) : null
      const box = (rowDom instanceof HTMLElement ? rowDom : dom).getBoundingClientRect()
      const base = host.getBoundingClientRect()
      setSlot({
        pos,
        top: box.top - base.top + host.scrollTop,
        left: box.left - base.left,
        height: box.height,
        item,
      })
    }
    const leave = () => { if (!frozen.current) setSlot(null) }
    host.addEventListener('mousemove', move)
    host.addEventListener('mouseleave', leave)
    return () => {
      host.removeEventListener('mousemove', move)
      host.removeEventListener('mouseleave', leave)
    }
  }, [editor, boundary])

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
    /**
     * copyMove인 이유. 노트 안으로 놓으면 줄이 **옮겨지고**(move), 시간 축으로
     * 놓으면 시간만 생기고 줄은 그대로 남습니다(copy). effectAllowed를 'move'로
     * 두면 시간 축이 dropEffect를 'copy'로 정할 수 없어서, 놓을 수 있는 자리인데
     * 브라우저가 거부합니다 — 커서가 끝까지 금지 표시로 남습니다.
     */
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData('text/plain', '')
    view.dragging = { slice: sel.content(), move: true }

    /**
     * ── 그리고 같은 드래그가 시간 축으로도 갑니다 ──────────────────────────
     *
     * 짐을 여기서 싣는 이유. 줄 자체에 실으려던 시도가 두 번 실패했습니다.
     *
     * 하나. 줄의 React onDragStart는 아예 안 불립니다 — tiptap의
     * NodeViewWrapper가 자기 onDragStart로 덮어씁니다.
     *
     * 둘. document에 달아도 소용없었습니다. 애초에 **dragstart가 안 났기**
     * 때문입니다: 프로즈미러는 내용이 있는 노드(체크박스 줄)에는 draggable을
     * 안 붙이고, 커스텀 노드뷰(업무 줄)에는 tiptap도 프로즈미러도 안 붙입니다.
     * 끌리지 않는 것에 짐을 싣는 코드를 두 번 쓴 셈입니다.
     *
     * 이 손잡이는 편집기 DOM 밖에 있는 진짜 draggable 버튼입니다. 프로즈미러의
     * dragstart 처리기가 안 도니 clearData도 없고, 짐이 그대로 남습니다.
     */
    /**
     * ── 시간을 붙일 수 있는 줄만 ─────────────────────────────────────────
     *
     * 업무 참조와 체크박스 줄, 둘뿐입니다. 그 둘은 '할 일'이라 언제 하는지가
     * 성립하지만, 문단이나 제목은 그렇지 않습니다 — 회의 메모 한 문단을
     * 시간 축에 놓으면 아무 뜻도 아닌 일정이 하나 생기고, 그건 지워야 하는
     * 일이 됩니다.
     *
     * 안 실으면 시간 축은 이 드래그를 못 받습니다(hasTimeblock이 거짓).
     * 그래서 격자 위에서 커서가 금지 표시로 바뀌어, 놓기 전에 안 된다는 걸
     * 압니다. 노트 안에서 줄 순서를 바꾸는 것은 그대로 됩니다 — 그건 위의
     * view.dragging이 하는 일이고 여기와 무관합니다.
     */
    /**
     * 짐을 실을 때는 **줄**을 봅니다.
     *
     * slot.pos는 최상위 블록이라 체크박스 목록에서는 목록 전체를 가리킵니다.
     * 그래서 여기서 slot.pos를 읽으면 이름이 '커피 주문슬랙 답장메일 확인'이
     * 됩니다 — 목록의 모든 줄이 이어 붙은 글자요. slot.item이 그중 지금
     * 가리키고 있는 한 줄입니다(taskItemAt).
     *
     * 업무 참조는 그 자체가 최상위 블록이라 item이 없고, 그때는 pos가 곧
     * 그 줄입니다.
     */
    const node = view.state.doc.nodeAt(slot.item ?? slot.pos)
    if (!node) return
    if (node.type.name === 'taskRef') {
      const id = node.attrs.taskId as string | null
      const task = id ? useTaskStore.getState().tasks.find(t => t.id === id) : undefined
      if (id) writeTimeblock(e.dataTransfer, { taskId: id, name: task?.name || '이름 없음' })
      return
    }
    if (node.type.name === 'taskItem') {
      // 사람이 방금 친 글자가 곧 일정 이름입니다.
      const text = node.textContent.trim()
      if (text) writeTimeblock(e.dataTransfer, { name: text })
    }
  }

  /** 오른쪽 클릭도 같은 메뉴를 엽니다. 손잡이를 못 찾은 사람을 위해. */
  useEffect(() => {
    const host = boundary.current
    if (!host || !editor) return
    const onContext = (e: MouseEvent) => {
      if (editor.isDestroyed) return
      const pos = blockAt(editor, e.clientX, e.clientY)
      if (pos === null) return
      if (editor.state.doc.nodeAt(pos)?.type.name === 'taskRef') return
      e.preventDefault()
      setMenu({ x: e.clientX, y: e.clientY, pos, item: taskItemAt(editor, e.clientX, e.clientY) })
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
      if (editor.isDestroyed) return
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

  // 파괴된 편집기 위에는 손잡이도 메뉴도 그리지 않습니다. 그 안의 위치는
  // 이미 없는 문서의 것입니다.
  if (!editor || editor.isDestroyed) return null

  return (
    <>
      {slot && !menu && (
          <div ref={handleRef} style={{
            position: 'absolute', top: slot.top, left: slot.left - 46,  // index.tsx의 GUTTER와 같은 값
            height: Math.min(slot.height, 30), display: 'flex', alignItems: 'center', gap: 1,
            zIndex: 2,
          }}>
            <HandleBtn
              title="새 줄"
              onClick={() => {
                const node = editor.state.doc.nodeAt(slot.pos)
                // 빈 줄에서 눌렀으면 그 줄을 씁니다. 아래에 하나 더 만들면
                // 빈 줄 두 개가 되고, 누른 사람은 그중 어느 쪽이 자기 것인지
                // 모릅니다. 글이 있는 줄에서는 노션처럼 아래에 만듭니다.
                const blank = node?.type.name === 'paragraph' && node.content.size === 0
                if (blank) {
                  editor.chain().focus().setTextSelection(slot.pos + 1).insertContent('/').run()
                  return
                }
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
                if (editor.state.doc.nodeAt(slot.pos)?.type.name === 'taskRef') return
                const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setMenu({ x: box.right + 4, y: box.top, pos: slot.pos, item: slot.item })
              }}
            >⠿</HandleBtn>
          </div>
      )}

      {menu && <BlockMenu editor={editor} date={date} {...menu} onClose={() => setMenu(null)} />}
      {slash && (
        <SlashMenu
          editor={editor} {...slash}
          onClose={() => setSlash(null)}
          onFinder={at => { setSlash(null); setFinder(at) }}
        />
      )}
      {finder && (
        <DriveFinder
          {...finder}
          onClose={() => setFinder(null)}
          onPick={f => {
            editor.chain().focus().insertContent({
              type: 'fileRef',
              attrs: {
                driveId: f.id,
                title: f.name,
                mimeType: f.mimeType,
                url: f.webViewLink || driveUrl(f.id, f.mimeType),
              },
            }).run()
            haptic('tap')
            setFinder(null)
          }}
        />
      )}
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
  { label: '간단한 할 일', run: e => e.chain().focus().toggleTaskList().run() },
  { label: '제목 1',     run: e => e.chain().focus().setNode('heading', { level: 1 }).run() },
  { label: '제목 2',     run: e => e.chain().focus().setNode('heading', { level: 2 }).run() },
  { label: '제목 3',     run: e => e.chain().focus().setNode('heading', { level: 3 }).run() },
  { label: '글머리 기호', run: e => e.chain().focus().toggleBulletList().run() },
  { label: '번호 목록',   run: e => e.chain().focus().toggleOrderedList().run() },
  { label: '인용',       run: e => e.chain().focus().toggleBlockquote().run() },
]

function BlockMenu({ editor, x, y, pos, item, date, onClose }: {
  editor: Editor; x: number; y: number; pos: number
  item: number | null
  date: string
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [promoting, setPromoting] = useState(false)
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

  /*
   * 이 메뉴에는 전환밖에 없습니다.
   *
   * 삭제와 복제도 있었는데, 줄 하나를 지우는 건 커서 놓고 Backspace고 복제는
   * 복사·붙여넣기입니다. 둘 다 이미 손이 아는 일이라 메뉴에서는 자리만
   * 차지하면서, 정작 다른 방법이 없는 '전환'을 아래로 밀어냈습니다.
   *
   * 업무 줄은 메뉴 자체가 안 뜹니다. 태스크를 문단으로 만들 수는 없고,
   * 노트에서 빼는 건 그 줄의 × 가 합니다.
   */
  return (
    <div ref={ref} style={{
      position: 'fixed', left: Math.min(x, window.innerWidth - 188), top: Math.min(y, window.innerHeight - 300),
      width: 180, zIndex: 600, background: 'var(--bg)', border: '1px solid var(--bd)',
      borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)', padding: 4, userSelect: 'none',
    }}>
      {/*
        ── 승격 ───────────────────────────────────────────────────────────────
        체크박스 줄에만 뜹니다. 대부분의 체크박스는 오늘만 살다 사라지는
        생각이고, 그중 어떤 것은 사실 진짜 일입니다. 이 줄은 그 순간을 위한
        문 하나입니다 — '연결'이 아니라 승격인 이유는 PromotePicker 주석에.
      */}
      {item !== null && (
        <>
          <Label>이 줄</Label>
          <Item onClick={() => setPromoting(true)}>업무로 만들기…</Item>
          <div style={{ height: 1, background: 'var(--bd)', margin: '4px 6px' }} />
        </>
      )}

      <Label>전환</Label>
      {TURNS.map(t => (
        <Item key={t.label} onClick={() => act(() => t.run(editor))}>{t.label}</Item>
      ))}

      {promoting && item !== null && (
        <PromotePicker
          editor={editor} item={item} date={date}
          x={x} y={y}
          onClose={() => { setPromoting(false); onClose() }}
        />
      )}
    </div>
  )
}

/**
 * ── 체크박스를 업무로 ────────────────────────────────────────────────────────
 *
 * '연결'이 아니라 **승격**입니다.
 *
 * 연결로 두면 한 업무의 할 일이 두 군데가 됩니다 — 하위 업무 목록 하나,
 * 노트에 흩어진 연결된 체크박스들 하나. 둘은 성격도 다릅니다. 하위 업무는
 * 팀이 보고 마감이 있고 어디서나 세어지는데, 노트 체크박스는 나만 보고
 * 그 날짜에만 삽니다. 그러면 "이 업무 안 끝난 게 몇 개냐"에 답이 둘이 됩니다.
 *
 * 그리고 '연결하고 싶다'는 마음은 대개 **'이건 사실 진짜 일이다'**라는 뜻이라,
 * 진짜 일로 만들어 주는 편이 그 마음에 맞습니다.
 *
 * 베끼지 않고 **자리를 물려줍니다**: 그 줄은 업무 참조로 바뀝니다. 글자가
 * 두 군데 남으면 둘은 언젠가 달라집니다.
 */
function PromotePicker({ editor, item, date, x, y, onClose }: {
  editor: Editor
  /** 승격할 체크박스 줄의 위치. */
  item: number
  date: string
  x: number; y: number
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const addTask = useTaskStore(s => s.addTask)
  const tasks = useTaskStore(s => s.tasks)
  const email = useAuthStore(s => s.email)
  const projects = useProjectStore(s => s.projects)
  const uiProjectId = useUiStore(s => s.projectId)

  useEffect(() => {
    // 바깥 클릭은 잡는 단계로 — 아래 메뉴가 자기 mousedown을 멈춰 세웁니다.
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    const t = setTimeout(() => document.addEventListener('mousedown', away, true), 0)
    document.addEventListener('keydown', key, true)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', away, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [onClose])

  const node = editor.state.doc.nodeAt(item)
  const text = (node?.textContent ?? '').trim()
  const done = node?.attrs?.checked === true

  /**
   * 부모가 될 수 있는 것들 — 내가 맡은, 아직 안 끝난, 그리고 자기도 하위가
   * 아닌 업무들. 하위의 하위까지 만들면 목록이 세 겹이 되고, 그 깊이를
   * 화면에서 다시 펼 방법이 마땅치 않습니다.
   */
  const parents = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tasks
      .filter(t => !t.parentId && t.status !== '완료' && isAssignedTo(t.assignee, email))
      .filter(t => !q || t.name.toLowerCase().includes(q))
      .slice(0, 8)
  }, [tasks, query, email])

  /**
   * 만들고, 그 줄을 업무 참조로 갈아 끼웁니다.
   *
   * 체크박스는 목록 안에 사는 노드라 그 자리에 업무 참조를 놓을 수 없습니다
   * (스키마가 허락하지 않습니다). 그래서 줄은 지우고, 참조는 **그 목록 바로
   * 뒤**에 놓습니다. 목록에 그 줄뿐이었으면 목록째 갈아 끼웁니다 — 빈 목록이
   * 남으면 눌리지도 않는 체크박스 한 칸이 남습니다.
   */
  const promote = (parent: { id: string; projectId?: string; cat?: string } | null, projectId?: string) => {
    if (!text) { onClose(); return }
    const created = addTask({
      type: parent ? '세부' : '상위',
      name: text,
      cat: parent?.cat ?? '',
      // 오늘 적은 건 오늘 할 일입니다. 노트의 날짜를 그대로 씁니다.
      assignee: email ?? '',
      start: '',
      due: date,
      priority: '중간',
      status: done ? '완료' : '대기',
      progress: done ? 100 : 0,
      memo: '',
      ...(parent ? { parentId: parent.id } : {}),
      ...(parent?.projectId ? { projectId: parent.projectId } : projectId ? { projectId } : {}),
      ...(email ? { createdBy: email } : {}),
    })

    const { state } = editor
    const $i = state.doc.resolve(item)
    const node2 = state.doc.nodeAt(item)
    if (!node2) { onClose(); return }
    const ref2 = state.schema.nodes.taskRef.create({ taskId: created.id })

    const listStart = $i.before(1)
    const listNode = state.doc.nodeAt(listStart)
    const tr = state.tr

    // 이 줄뿐인 목록이면 목록째 바꿉니다.
    if (listNode && listNode.childCount === 1 && $i.depth === 1) {
      tr.replaceWith(listStart, listStart + listNode.nodeSize, ref2)
    } else {
      tr.delete(item, item + node2.nodeSize)
      tr.insert(tr.mapping.map($i.after(1)), ref2)
    }
    editor.view.dispatch(tr)
    haptic('tap')
    onClose()
  }

  const fallbackProject = uiProjectId ?? undefined
  const projectName = fallbackProject ? projects.find(p => p.id === fallbackProject)?.name : null

  return (
    <div ref={ref} style={{
      position: 'fixed',
      left: Math.min(x, window.innerWidth - 292),
      top: Math.min(y, window.innerHeight - 320),
      width: 284, zIndex: 700,
      background: 'var(--bg)', border: '1px solid var(--bd)',
      borderRadius: 'var(--r3)', boxShadow: 'var(--sh-lg)', padding: 8,
    }}>
      <div style={{
        fontSize: 13, fontWeight: 600, color: 'var(--t1)', padding: '2px 4px 6px',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {text || '(빈 줄)'}
      </div>

      <input
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="어느 업무 아래에 둘까요?"
        style={{
          width: '100%', boxSizing: 'border-box', padding: '6px 8px',
          borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
          background: 'var(--bg2)', color: 'var(--t1)',
          fontSize: 13, fontFamily: 'var(--font)', outline: 'none',
        }}
      />

      <div style={{ maxHeight: 190, overflowY: 'auto', marginTop: 4 }}>
        {parents.map(t => (
          <Item key={t.id} onClick={() => promote(t)}>
            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.name}
            </span>
          </Item>
        ))}
        {!parents.length && (
          <div style={{ padding: '8px 8px 4px', fontSize: 12, color: 'var(--t3)' }}>
            맞는 업무가 없습니다
          </div>
        )}
      </div>

      <div style={{ height: 1, background: 'var(--bd)', margin: '5px 6px' }} />
      {projectName && (
        <Item onClick={() => promote(null, fallbackProject)}>{projectName}의 업무로</Item>
      )}
      <Item onClick={() => promote(null)}>개인 업무로</Item>

      {/* 승격은 사적인 줄을 공개하는 일입니다. 그 사실을 여기서 말합니다 —
          노트의 안내문은 '나만 볼 수 있다'고 말해 두었으니까요. */}
      <div style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.5, padding: '6px 6px 2px' }}>
        업무가 되면 팀도 볼 수 있습니다. 마감은 {date.slice(5).replace('-', '월 ')}일.
      </div>
    </div>
  )
}

/* ── 슬래시 메뉴 ── */

interface SlashItem {
  label: string
  hint: string
  run?: (e: Editor) => void
  /** 줄을 바로 만들지 않고 창을 하나 여는 항목. 지금은 자료 찾기 하나. */
  opens?: 'drive'
}

const SLASH: SlashItem[] = [
  { label: '간단한 할 일', hint: '체크박스 한 줄', run: e => e.chain().focus().toggleTaskList().run() },
  { label: '자료',       hint: '드라이브에서 찾기', opens: 'drive' },
  { label: '제목 1',     hint: '가장 큰 제목',     run: e => e.chain().focus().setNode('heading', { level: 1 }).run() },
  { label: '제목 2',     hint: '',                run: e => e.chain().focus().setNode('heading', { level: 2 }).run() },
  { label: '제목 3',     hint: '',                run: e => e.chain().focus().setNode('heading', { level: 3 }).run() },
  { label: '글머리 기호', hint: '',                run: e => e.chain().focus().toggleBulletList().run() },
  { label: '번호 목록',   hint: '',                run: e => e.chain().focus().toggleOrderedList().run() },
  { label: '인용',       hint: '',                run: e => e.chain().focus().toggleBlockquote().run() },
  { label: '구분선',     hint: '가로줄 하나',      run: e => e.chain().focus().setHorizontalRule().run() },
  { label: '코드',       hint: '',                run: e => e.chain().focus().toggleCodeBlock().run() },
]

function SlashMenu({ editor, x, y, from, onClose, onFinder }: {
  editor: Editor; x: number; y: number; from: number
  onClose: () => void
  onFinder: (at: { x: number; y: number }) => void
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
    // 창을 여는 항목은 여기서 끝내지 않습니다 — 고른 다음에 줄이 생깁니다.
    if (item.opens === 'drive') { onFinder({ x, y }); return }
    item.run?.(editor)
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

/**
 * ── 자료 찾기 ────────────────────────────────────────────────────────────────
 *
 * `/`를 치고 '자료'를 고르면 여기가 뜹니다. 검색 상자는 업무 상세 창에서 파일을
 * 붙일 때 쓰는 것과 **같은 것**입니다(DriveSearch) — 같은 일을 두 군데서 다르게
 * 하면 두 가지를 배워야 합니다.
 *
 * 폴더를 좁히지 않고 드라이브 전체에서 찾습니다. 노트는 프로젝트에 속하지
 * 않으니까요 — 오늘 하루가 프로젝트 하나로만 이뤄지는 사람은 없습니다.
 */
function DriveFinder({ x, y, onPick, onClose }: {
  x: number; y: number
  onPick: (f: DriveFile) => void
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (panel.current?.contains(e.target as Node)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    // 다음 클릭부터, 그리고 잡는 단계로. 사이에 stopPropagation을 거는
    // 무언가가 있으면 올라오는 길에 걸어 둔 귀는 아무것도 못 듣습니다.
    const t = setTimeout(() => document.addEventListener('mousedown', away, true), 0)
    document.addEventListener('keydown', key)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', away, true)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])

  return (
    <div
      ref={panel}
      style={{
        position: 'fixed', left: Math.min(x, window.innerWidth - 340),
        top: Math.min(y + 4, window.innerHeight - 340),
        width: 328, height: 320, zIndex: 600,
        background: 'var(--bg)', border: '1px solid var(--bd)',
        borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)', padding: 8,
        display: 'flex', flexDirection: 'column', minHeight: 0,
      }}
    >
      <DriveSearch
        folderId={null}
        attachedIds={EMPTY}
        onPick={f => onPick(f)}
        onClose={onClose}
      />
    </div>
  )
}

/** 노트에는 '이미 붙어 있는 것' 개념이 없습니다 — 같은 파일을 두 번 적어도 됩니다. */
const EMPTY = new Set<string>()

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '6px 9px 3px', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', color: 'var(--t3)' }}>{children}</div>
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
