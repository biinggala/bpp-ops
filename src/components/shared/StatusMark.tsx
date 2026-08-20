import type { Status } from '../../types'

/**
 * The state of a task, drawn rather than tinted.
 *
 * Every enum in the row used to be the same pale pill with the same 6px dot, so
 * 상태 — the one field people scan a hundred rows for — looked exactly like
 * 우선순위 and the tags beside it. Colour alone could not fix that: the row
 * already carries five colours, and roughly one man in twelve cannot tell the
 * amber one from the green one anyway.
 *
 * So the state gets a shape. A ring that fills as the work moves — empty for
 * 대기, half for 진행중, three quarters for 검토중, a tick for 완료 — which is
 * legible at 12px, tells the states apart with the colour switched off, and
 * reads in the same direction the work does.
 *
 * It paints in `currentColor`, so the same component is white inside a filled
 * pill and the status colour inside an outlined one.
 */
export function StatusMark({ status, size = 12 }: { status: Status; size?: number }) {
  const common = {
    width: size, height: size, viewBox: '0 0 12 12',
    fill: 'none', stroke: 'currentColor', style: { flexShrink: 0, display: 'block' },
  }

  if (status === '완료') {
    return (
      <svg {...common} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M2.2 6.4 4.7 8.9 9.8 3.4" />
      </svg>
    )
  }

  // A wedge of the circle, measured clockwise from the top — the direction a
  // clock face and a progress ring are both read in.
  const wedge = (fraction: number) => {
    const c = 6, r = 2.9
    const angle = fraction * 2 * Math.PI
    const x = c + r * Math.sin(angle)
    const y = c - r * Math.cos(angle)
    return `M ${c} ${c} L ${c} ${c - r} A ${r} ${r} 0 ${fraction > 0.5 ? 1 : 0} 1 ${x} ${y} Z`
  }
  const filled = status === '진행중' ? 0.5 : status === '검토중' ? 0.75 : 0

  return (
    <svg {...common} strokeWidth={1.6} aria-hidden>
      <circle cx="6" cy="6" r="4.4" />
      {filled > 0 && <path d={wedge(filled)} fill="currentColor" stroke="none" />}
    </svg>
  )
}
