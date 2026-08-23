import React, { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'

/**
 * ── ⋯ 뒤에 두는 것들 ─────────────────────────────────────────────────────────
 *
 * 되돌릴 수 없는 일은 한 겹 뒤에 둡니다. 자주 누르는 것(저장, 닫기)과 한 번
 * 누르면 끝인 것(삭제)이 같은 줄에 같은 크기로 있으면 언젠가 잘못 누릅니다.
 *
 * `docs/desktop-updates.md`에 규칙으로 적혀 있는 그것입니다 — **파괴적인 버튼은
 * hover에 두지 않고, 메뉴 뒤에 두고, 필요하면 확인을 받는다.** 실제 확인은
 * 부르는 쪽이 `askConfirm`으로 합니다. 무엇을 지우는지는 여기가 모르고,
 * '하위 업무 3개도 함께 삭제됩니다' 같은 말은 부르는 쪽만 할 수 있습니다.
 *
 * 바깥 클릭은 **잡는 단계(capture)로** 듣습니다. 이 메뉴가 놓이는 카드들이
 * 자기 mousedown에 stopPropagation을 걸고 있어서(뒤의 덮개가 카드를 닫지
 * 않게), 올라오는 단계로 걸어 둔 귀에는 아무것도 도착하지 않습니다. 이벤트가
 * 안 온 게 아니라 막힌 것인데 코드에서는 둘이 똑같아 보입니다.
 */

export interface MoreMenuItem {
  label: string
  icon?: IconName
  danger?: boolean
  onSelect: () => void
}

export function MoreMenu({ items, label = '더 보기', align = 'right' }: {
  items: MoreMenuItem[]
  label?: string
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    // 다음 클릭부터 — 이 메뉴를 연 그 클릭이 곧바로 닫지 않게.
    const t = setTimeout(() => document.addEventListener('mousedown', away, true), 0)
    document.addEventListener('keydown', key, true)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', away, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [open])

  if (!items.length) return null

  return (
    <div ref={box} style={{ position: 'relative', flexShrink: 0, display: 'flex' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={label}
        style={{
          width: 24, height: 24, borderRadius: 'var(--r1)', border: 'none', padding: 0,
          cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 14, lineHeight: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: open ? 'var(--bg3)' : 'transparent', color: 'var(--t3)',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
        onMouseLeave={e => (e.currentTarget.style.background = open ? 'var(--bg3)' : 'transparent')}
      >⋯</button>

      {open && (
        <div style={{
          position: 'absolute', top: 26, [align]: 0, minWidth: 148, zIndex: 30,
          background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r2)',
          boxShadow: 'var(--sh-md)', padding: 4,
        }}>
          {items.map(item => (
            <Row key={item.label} item={item} onDone={() => setOpen(false)} />
          ))}
        </div>
      )}
    </div>
  )
}

function Row({ item, onDone }: { item: MoreMenuItem; onDone: () => void }) {
  const [hovered, setHovered] = useState(false)
  const tone = item.danger ? 'var(--danger)' : 'var(--t1)'
  return (
    <button
      onClick={() => { onDone(); item.onSelect() }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '6px 8px', borderRadius: 'var(--r1)', border: 'none',
        cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 12.5,
        color: tone, textAlign: 'left',
        background: hovered ? (item.danger ? 'var(--danger-l)' : 'var(--bg3)') : 'transparent',
      }}
    >
      {item.icon && <Icon name={item.icon} size={13} />}
      {item.label}
    </button>
  )
}
