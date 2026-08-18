import { useMenu, Menu, MenuList, MenuItem, MenuNote, MenuFooter, CellTrigger } from './Menu'
import { AssigneeAvatar } from './Avatar'
import { parseAssignees } from '../../lib/utils'

/**
 * One picker for "who is on this".
 *
 * It used to exist only inside the list. The task detail panel had its own
 * native `<select>` instead, which cannot hold two people: with an assignee
 * field of "a@x,b@x" no option matches, so the browser falls back to the first
 * one and the task reads as 미배정 — and touching it would have written that
 * back, quietly dropping everyone. Two implementations of one idea, and the
 * second one lost data.
 */


export function AssigneePicker({ assignee, options, onChange }: {
  assignee: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  const m = useMenu()
  const selected = parseAssignees(assignee)

  const toggle = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter(s => s !== value)
      : [...selected, value]
    onChange(next.join(','))
  }

  return (
    <div ref={m.rootRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
      <CellTrigger open={m.open} onOpen={el => m.toggleAt(el)}>
        {selected.length === 0 ? (
          <span style={{ color: 'var(--t3)', fontSize: 12 }}>—</span>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            {selected.map((k, i) => (
              <span key={k} style={{ marginLeft: i > 0 ? -6 : 0, position: 'relative', zIndex: 1 - i }}>
                <AssigneeAvatar assigneeKey={k} size={22} />
              </span>
            ))}
          </span>
        )}
      </CellTrigger>

      {m.open && (
        <Menu pos={m.pos} panelRef={m.panelRef}>
          {options.length === 0 ? (
            <MenuNote>멤버가 없습니다</MenuNote>
          ) : (
            <>
              <MenuList>
                {options.map(opt => (
                  <MenuItem key={opt.value} multi selected={selected.includes(opt.value)} onSelect={() => toggle(opt.value)}>
                    <AssigneeAvatar assigneeKey={opt.value} size={20} />
                    {opt.label}
                  </MenuItem>
                ))}
              </MenuList>
              {selected.length > 0 && <MenuFooter label="담당자 해제" onSelect={() => onChange('')} />}
            </>
          )}
        </Menu>
      )}
    </div>
  )
}

