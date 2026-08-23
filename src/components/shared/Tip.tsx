import { useRef, useState } from 'react'

/**
 * ── 말풍선 ───────────────────────────────────────────────────────────────────
 *
 * 아이콘만 있는 버튼은 그 아이콘을 이미 아는 사람에게만 버튼입니다. `title`
 * 속성이 있긴 한데 운영체제가 1초쯤 뒤에 자기 스타일로 그려 주고, 단축키를
 * 예쁘게 넣을 방법이 없습니다.
 *
 * 그래서 직접 그립니다. **단축키가 이 말풍선의 존재 이유입니다** — 버튼을
 * 한 번 누르러 온 사람에게 "다음부터는 이걸 치면 됩니다"라고 말할 자리가
 * 여기밖에 없습니다.
 *
 * `position: fixed`로 띄웁니다. 부모의 `overflow: hidden`에 잘리면 말풍선이
 * 반쪽만 보이는데, 툴바는 거의 항상 잘리는 상자 안에 있습니다.
 */
export function Tip({ label, keys, children, side = 'bottom' }: {
  label: string
  /** 단축키를 낱개로. ['⌘', '\\'] 처럼. */
  keys?: string[]
  children: React.ReactNode
  side?: 'bottom' | 'right'
}) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const host = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | null>(null)

  const show = () => {
    const box = host.current?.getBoundingClientRect()
    if (!box) return
    // 잠깐 머무를 때만. 지나가는 마우스마다 뜨면 화면이 깜빡입니다.
    timer.current = window.setTimeout(() => {
      setAt(side === 'right'
        ? { top: box.top + box.height / 2, left: box.right + 8 }
        : { top: box.bottom + 8, left: box.left })
    }, 400)
  }

  const hide = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    setAt(null)
  }

  return (
    <span
      ref={host}
      onMouseEnter={show}
      onMouseLeave={hide}
      // 누르고 나면 사라져야 합니다. 방금 한 일을 설명하는 말풍선은 방해입니다.
      onMouseDown={hide}
      style={{ display: 'inline-flex' }}
    >
      {children}
      {at && (
        <span style={{
          position: 'fixed', top: at.top, left: at.left, zIndex: 10000,
          transform: side === 'right' ? 'translateY(-50%)' : 'none',
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '5px 9px', borderRadius: 'var(--r2)',
          background: 'var(--bg4)', border: '1px solid var(--bd)',
          boxShadow: 'var(--sh-md)', pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          <span style={{ fontSize: 12, color: 'var(--t1)' }}>{label}</span>
          {keys?.map(k => (
            <span key={k} style={{
              fontSize: 11, color: 'var(--t3)', minWidth: 16, textAlign: 'center',
              padding: '1px 4px', borderRadius: 3, background: 'var(--bg2)',
              border: '1px solid var(--bd)', lineHeight: 1.5,
            }}>{k}</span>
          ))}
        </span>
      )}
    </span>
  )
}

/** 이 기기에서 ⌘인가 Ctrl인가. 윈도우 사람에게 ⌘를 보여 주면 못 찾습니다. */
export const CMD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  ? '⌘'
  : 'Ctrl'
