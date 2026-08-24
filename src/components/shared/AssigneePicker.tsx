import { useMenu, useMenuKeys, Menu, MenuList, MenuItem, MenuNote, MenuDivider, MenuFooter, CellTrigger } from './Menu'
import { AssigneeAvatar } from './Avatar'
import { parseAssignees, type AssigneeOption } from '../../lib/utils'

/**
 * One picker for "who is on this".
 *
 * It used to exist only inside the list. The task detail panel had its own
 * native `<select>` instead, which cannot hold two people: with an assignee
 * field of "a@x,b@x" no option matches, so the browser falls back to the first
 * one and the task reads as 미배정 — and touching it would have written that
 * back, quietly dropping everyone. Two implementations of one idea, and the
 * second one lost data.
 *
 * ── 없는 사람을 고르는 자리 ──────────────────────────────────────────────────
 *
 * 목록에 서는 사람은 그 업무를 **읽을 수 있는 사람**뿐입니다(lib/utils의
 * assigneeOptions). 그런데 맡기고 싶은 사람이 그 프로젝트에 없는 일은
 * 자주 있고, 목록에 아예 없으면 화면은 "그 사람은 안 됩니다"라고만 하고
 * 다음에 할 일을 안 알려 줍니다.
 *
 * 그래서 아래에 한 칸 더 둡니다 — 다른 데서 이미 같이 일하는 사람들. 고르면
 * **초대장이 나가고** 동시에 담당자가 됩니다. 업무만 열어 주는 길을 따로
 * 내지 않은 건, 업무 하나만 보이면 프로젝트 이름도 마일스톤도 상위 업무도
 * 안 읽혀서 볼 것이 없기 때문입니다. 접근 범위는 프로젝트 멤버십 하나입니다.
 *
 * 이 칸은 **창에서만** 보입니다(새 업무·업무 편집). 목록의 담당자 칸은 빠르게
 * 고치는 자리라, 거기서 누른 한 번이 남의 앞에 초대 창을 띄우는 건 그 칸이
 * 약속한 것보다 큰 일입니다. 목록에서 그 사람을 찾다 없으면 업무를 열게
 * 되고, 초대는 거기 있습니다.
 */


export function AssigneePicker({ assignee, options, onChange, tabbable = false, invitable = [], onInvite }: {
  assignee: string
  options: AssigneeOption[]
  onChange: (v: string) => void
  /** Reachable by Tab — the add row is filled without a mouse. */
  tabbable?: boolean
  /** 이 프로젝트 밖의 동료들. 고르면 onInvite로 넘어갑니다. */
  invitable?: { value: string; label: string }[]
  /** 초대 확인을 띄우고, 수락되면 담당자로 넣는 것까지 부르는 쪽이 합니다. */
  onInvite?: (email: string) => void
}) {
  const m = useMenu()
  const selected = parseAssignees(assignee)
  const canInvite = !!onInvite && invitable.length > 0

  const toggle = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter(s => s !== value)
      : [...selected, value]
    onChange(next.join(','))
  }

  // Space ticks a name and leaves the menu open, because more than one person
  // can be on a task; Enter is left alone so it still belongs to the row.
  // 초대 줄은 방향키가 지나가되 고르면 메뉴가 닫힙니다 — 확인 창이 뜨니까요.
  const keyValues = [...options.map(o => o.value), ...(canInvite ? invitable.map(o => o.value) : [])]
  const pick = (value: string) => {
    if (options.some(o => o.value === value)) return toggle(value)
    m.setOpen(false)
    onInvite?.(value)
  }
  const { hi, onKeyDown } = useMenuKeys(
    m, keyValues, pick,
    Math.max(0, options.findIndex(o => selected.includes(o.value))), ' ',
  )

  return (
    <div ref={m.rootRef} onKeyDown={onKeyDown} style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
      <CellTrigger open={m.open} onOpen={el => m.toggleAt(el)} tabbable={tabbable}>
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
          {options.length === 0 && !canInvite ? (
            <MenuNote>멤버가 없습니다</MenuNote>
          ) : (
            <>
              <MenuList>
                {options.map((opt, i) => (
                  <MenuItem
                    key={opt.value}
                    multi
                    highlighted={hi === i}
                    selected={selected.includes(opt.value)}
                    onSelect={() => toggle(opt.value)}
                    trailing={opt.pending ? <span style={{ fontSize: 11, color: 'var(--t3)' }}>수락 대기</span> : undefined}
                  >
                    <AssigneeAvatar assigneeKey={opt.value} size={20} />
                    {opt.label}
                  </MenuItem>
                ))}

                {canInvite && (
                  <>
                    <MenuDivider />
                    {/* 왜 한 칸 아래인지 먼저 말합니다 — 누르면 초대장이 나가는
                        줄이라, 위의 줄들과 같은 무게로 서 있으면 안 됩니다. */}
                    <div style={{ padding: '6px 8px 4px', fontSize: 11, color: 'var(--t3)' }}>
                      이 프로젝트에 없는 사람 · 고르면 초대합니다
                    </div>
                    {invitable.map((opt, i) => (
                      <MenuItem
                        key={opt.value}
                        highlighted={hi === options.length + i}
                        onSelect={() => { m.setOpen(false); onInvite?.(opt.value) }}
                      >
                        <span style={{ opacity: 0.55, display: 'flex' }}>
                          <AssigneeAvatar assigneeKey={opt.value} size={20} />
                        </span>
                        {opt.label}
                      </MenuItem>
                    ))}
                  </>
                )}
              </MenuList>
              {selected.length > 0 && <MenuFooter label="담당자 해제" onSelect={() => onChange('')} />}
            </>
          )}
        </Menu>
      )}
    </div>
  )
}
