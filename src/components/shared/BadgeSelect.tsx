import React from 'react'
import { useMenu, useMenuKeys, Menu, MenuItem, CellTrigger, Dot } from './Menu'

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
export function BadgeSelect<T extends string>({ value, options, styleMap, onChange, tabbable = false, renderValue }: {
  value: T
  options: T[]
  styleMap: Record<T, { bg: string; color: string }>
  onChange: (v: string) => void
  tabbable?: boolean
  /**
   * Draws an option however the field wants to be drawn — the filled 상태 pill,
   * the plain 우선순위 word — in the trigger and in the menu alike. Without it
   * every enum is the same tinted badge with the same dot, which is how the one
   * field people scan for became the one they could not find.
   */
  renderValue?: (v: T) => React.ReactNode
}) {
  const m = useMenu()
  const s = styleMap[value] ?? { bg: 'var(--bg3)', color: 'var(--t2)' }
  const { hi, onKeyDown: onKey } = useMenuKeys(
    m, options,
    o => { onChange(o); m.setOpen(false) },
    Math.max(0, options.indexOf(value)),
  )
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
      <CellTrigger open={m.open} onOpen={el => m.toggleAt(el, 160)} style={{ flex: 'none' }} tabbable={tabbable}>
        {renderValue ? renderValue(value) : badge(value, s)}
      </CellTrigger>
      {m.open && (
        <Menu pos={m.pos} panelRef={m.panelRef} width={160}>
          {options.map((o, i) => (
            <MenuItem key={o} selected={o === value} highlighted={i === hi} onSelect={() => { onChange(o); m.setOpen(false) }}>
              {renderValue ? renderValue(o) : <><Dot color={(styleMap[o] ?? s).color} />{o}</>}
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  )
}

