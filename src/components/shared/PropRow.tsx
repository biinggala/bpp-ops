import { useMenu, Menu, MenuList, MenuItem, CellTrigger, Dot } from './Menu'
import { NOTION } from '../../types'
import type { Status, Priority } from '../../types'

/**
 * ── 속성 한 줄 ───────────────────────────────────────────────────────────────
 *
 * The label-and-value row, and the picker that goes in it.
 *
 * Both used to live inside TaskDetailModal, which meant the *other* place a
 * task is filled in — the 새 업무 창 — had its own `<select>` elements that
 * looked nothing like them. Two ways to set the same field on the same object
 * is one too many, so this is the one both import.
 */

export function PropCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, minHeight: 30 }}>
      <span style={{ width: 62, fontSize: 12, color: 'var(--t3)', fontWeight: 500, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>{children}</div>
    </div>
  )
}

export function OptionPicker({ value, options, empty, onChange }: {
  value: string | undefined
  options: { value: string; label: string; dot?: string; sub?: string }[]
  empty: string
  onChange: (v: string | undefined) => void
}) {
  const m = useMenu()
  const current = options.find(o => o.value === value)

  return (
    <div ref={m.rootRef} style={{ position: 'relative', display: 'flex', flex: 1, minWidth: 0 }}>
      <CellTrigger open={m.open} onOpen={el => m.toggleAt(el, 220)}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 13 }}>
          {current?.dot && <Dot color={current.dot} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: current ? 'var(--t1)' : 'var(--t3)' }}>
            {current?.label ?? empty}
          </span>
        </span>
      </CellTrigger>
      {m.open && (
        <Menu pos={m.pos} panelRef={m.panelRef} width={220}>
          <MenuList>
            <MenuItem selected={!value} onSelect={() => { onChange(undefined); m.setOpen(false) }}>{empty}</MenuItem>
            {options.map(o => (
              <MenuItem
                key={o.value}
                selected={o.value === value}
                onSelect={() => { onChange(o.value); m.setOpen(false) }}
                trailing={o.sub ? <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>{o.sub}</span> : undefined}
              >
                {o.dot && <Dot color={o.dot} />}
                {o.label}
              </MenuItem>
            ))}
          </MenuList>
        </Menu>
      )}
    </div>
  )
}

/**
 * The badge colours for 상태 and 우선순위, in one place.
 *
 * The same pairs the list and the board use. Each screen used to carry its own
 * copy, which is how they ended up close-but-not-equal — near enough to read as
 * a rendering bug rather than a different colour.
 */
export const STATUS_STYLE: Record<Status, { bg: string; color: string }> = {
  '진행중': { bg: NOTION.blue.bg,   color: NOTION.blue.text },
  '대기':   { bg: NOTION.gray.bg,   color: NOTION.gray.text },
  '검토중': { bg: NOTION.yellow.bg, color: NOTION.yellow.text },
  '완료':   { bg: NOTION.green.bg,  color: NOTION.green.text },
}

export const PRIORITY_STYLE: Record<Priority, { bg: string; color: string }> = {
  '높음': { bg: NOTION.red.bg,    color: NOTION.red.text },
  '중간': { bg: NOTION.orange.bg, color: NOTION.orange.text },
  '낮음': { bg: 'transparent',    color: 'var(--t3)' },
}
