import React, { useState, useEffect } from 'react'
import { useMenu, Menu, MenuItem, CellTrigger, Dot } from './Menu'

/**
 * The pill-shaped enum control: 상태, 우선순위.
 *
 * Shared because there were two of these. The list's opened the app's own menu;
 * the task detail panel had a second copy backed by a hidden native `<select>`,
 * so the same field opened the operating system's picker depending on where you
 * clicked it. One definition, one menu.
 */


/**
 * Was a native <select> hidden under a styled badge, which meant the two most
 * clicked cells in the table opened the operating system's menu while every
 * other cell opened the app's. Same badge, app's menu.
 */
export function BadgeSelect<T extends string>({ value, options, styleMap, onChange, tabbable = false }: {
  value: T
  options: T[]
  styleMap: Record<T, { bg: string; color: string }>
  onChange: (v: string) => void
  tabbable?: boolean
}) {
  const m = useMenu()
  const s = styleMap[value] ?? { bg: 'var(--bg3)', color: 'var(--t2)' }
  // Focus stays on the trigger while the menu is open, so the arrows are
  // handled there. Without this the add row could be tabbed to but not filled.
  const [hi, setHi] = useState(0)
  useEffect(() => { if (m.open) setHi(Math.max(0, options.indexOf(value))) }, [m.open])
  const onKey = (e: React.KeyboardEvent) => {
    if (!m.open) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation()
      setHi(i => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
    } else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation()
      onChange(options[hi]); m.setOpen(false)
    }
  }
  const badge = (v: T, st: { bg: string; color: string }) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 12,
      background: st.bg, color: st.color,
      fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', lineHeight: 1.6,
    }}>
      <Dot color={st.color} size={6} />
      {v}
    </span>
  )

  return (
    <div ref={m.rootRef} style={{ position: 'relative', display: 'inline-flex', minWidth: 0 }} onClick={e => e.stopPropagation()} onKeyDown={onKey}>
      <CellTrigger open={m.open} onOpen={el => m.toggleAt(el, 150)} style={{ flex: 'none' }} tabbable={tabbable}>
        {badge(value, s)}
      </CellTrigger>
      {m.open && (
        <Menu pos={m.pos} panelRef={m.panelRef} width={150}>
          {options.map((o, i) => (
            <MenuItem key={o} selected={o === value} highlighted={i === hi} onSelect={() => { onChange(o); m.setOpen(false) }}>
              <Dot color={(styleMap[o] ?? s).color} />
              {o}
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  )
}

