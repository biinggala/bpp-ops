import { StatusMark } from './StatusMark'
import { useMenu, Menu, MenuList, MenuItem } from './Menu'
import { STATUS_LIST, statusAccent, type Status } from '../../types'

/**
 * ── 상태를 보여 주고, 누르면 바꾸는 것 ───────────────────────────────────────
 *
 * 데일리 노트의 업무 줄에 있던 것을 꺼냈습니다. 시간 축의 블록도 같은 일을
 * 하는데, 거기서 다른 모양을 쓰면 **같은 값을 두 가지로 배우게** 됩니다.
 * 하나만 두고 둘이 씁니다.
 *
 * **여기 있는 건 체크박스가 아니라 상태입니다.** 처음엔 동그란 체크박스였는데,
 * 그건 일이 끝났거나 안 끝났거나 둘 중 하나라는 말입니다. 우리 업무는 대기 ·
 * 진행중 · 검토중 · 완료 네 가지고, 하루 중 제일 자주 일어나는 변화는
 * '완료'가 아니라 '진행중으로 옮김'입니다. 체크박스는 그걸 표현할 수 없어서
 * 한 번 누르면 무조건 완료로 보내 버렸습니다 — 아직 하는 중인 일을요.
 */
export function StatusPick({ status, onPick, size = 20, stop = false }: {
  status: Status
  onPick: (s: Status) => void
  /** 버튼의 지름. 시간 축의 좁은 블록에서는 조금 작게 씁니다. */
  size?: number
  /**
   * 눌린 것이 위로 안 올라가게 막습니다.
   *
   * 시간 축의 블록은 자기 mousedown으로 끌기를 시작하고 click으로 카드를
   * 엽니다. 상태를 바꾸려고 누른 것이 그 둘을 깨우면, 한 번 누를 때마다
   * 일정이 잡히거나 카드가 열립니다.
   */
  stop?: boolean
}) {
  const m = useMenu()
  const mark = Math.round(size * 0.7)
  return (
    <span
      ref={m.rootRef}
      style={{ position: 'relative', display: 'flex', flexShrink: 0 }}
      {...(stop ? { onMouseDown: (e: React.MouseEvent) => e.stopPropagation() } : {})}
    >
      <button
        onClick={e => { if (stop) e.stopPropagation(); m.toggleAt(e.currentTarget, 148, 200) }}
        aria-label={`상태: ${status}`}
        title={status}
        style={{
          width: size, height: size, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: m.open ? 'var(--bg3)' : 'transparent',
          color: statusAccent(status), fontFamily: 'var(--font)',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
        onMouseLeave={e => (e.currentTarget.style.background = m.open ? 'var(--bg3)' : 'transparent')}
      >
        <StatusMark status={status} size={mark} />
      </button>
      {m.open && (
        <Menu pos={m.pos} panelRef={m.panelRef} width={148}>
          <MenuList>
            {STATUS_LIST.map(s => (
              <MenuItem key={s} selected={s === status} onSelect={() => { onPick(s); m.setOpen(false) }}>
                <span style={{ color: statusAccent(s), display: 'flex' }}><StatusMark status={s} size={12} /></span>
                {s}
              </MenuItem>
            ))}
          </MenuList>
        </Menu>
      )}
    </span>
  )
}
