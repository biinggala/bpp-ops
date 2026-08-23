import { useState } from 'react'

/**
 * ── 폭 손잡이 ────────────────────────────────────────────────────────────────
 *
 * 칸의 모서리. 평소에는 안 보이고, 그 위에 가면 얇은 선 하나가 뜹니다 — 늘
 * 보이는 손잡이는 없어도 되는 세로줄을 하나 더 긋는 일이고, 이 경계는 이미
 * 테두리가 긋고 있습니다.
 *
 * 잡는 면은 눈에 보이는 것보다 넓습니다(6px). 1px짜리 선을 정확히 겨냥하는
 * 건 마우스로 할 일이 아닙니다.
 *
 * 더블클릭하면 기본값으로 돌아옵니다. 끌어서 망친 걸 끌어서 되돌리는 건
 * 어렵고, 되돌릴 방법이 없으면 사람들은 아예 안 건드립니다.
 *
 * `side`는 손잡이가 붙는 쪽입니다. 왼쪽 사이드바는 오른쪽 모서리를 잡고
 * 끌수록 넓어지지만, 오른쪽 칸은 **왼쪽** 모서리를 잡고 끌수록 좁아집니다 —
 * 부호가 반대라는 것 하나 때문에 같은 코드를 두 벌 두지는 않습니다.
 */
export function WidthHandle({ width, min, max, defaultWidth, side, onChange, onCommit }: {
  width: number
  min: number
  max: number
  defaultWidth: number
  /** 손잡이가 칸의 어느 모서리에 붙는가. */
  side: 'left' | 'right'
  onChange: (w: number) => void
  /** 끌기가 끝났을 때, 그리고 기본값으로 되돌렸을 때. 저장은 부르는 쪽 몫입니다. */
  onCommit: (w: number) => void
}) {
  const [active, setActive] = useState(false)
  const [hovered, setHovered] = useState(false)

  const clamp = (w: number) => Math.min(max, Math.max(min, w))
  const dir = side === 'right' ? 1 : -1

  const begin = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    setActive(true)
    // 끄는 동안 글자가 잡히면 칸 절반이 파랗게 칠해집니다.
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    const at = (ev: PointerEvent) => clamp(startW + (ev.clientX - startX) * dir)

    const move = (ev: PointerEvent) => onChange(at(ev))
    const end = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      setActive(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      onCommit(Math.round(at(ev)))
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }

  return (
    <div
      onPointerDown={begin}
      onDoubleClick={() => { onChange(defaultWidth); onCommit(defaultWidth) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="드래그해서 폭 조절 · 더블클릭하면 기본값"
      style={{
        position: 'absolute', top: 0, bottom: 0, width: 6,
        [side]: -3,
        cursor: 'col-resize', zIndex: 5, touchAction: 'none',
      }}
    >
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: 2, width: 2,
        background: active || hovered ? 'var(--ac)' : 'transparent',
        transition: 'background .12s',
      }} />
    </div>
  )
}
