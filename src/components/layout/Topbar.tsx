import { useUiStore } from '../../store/uiStore'
import { useCurrentMember } from '../../store/memberStore'

export function Topbar() {
  const { space, openTaskModal } = useUiStore()
  const currentMember = useCurrentMember()

  return (
    <header style={{
      height: 52,
      background: 'var(--bg)',
      borderBottom: '1px solid var(--bd)',
      padding: '0 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        <h1 style={{ fontSize: 16, fontWeight: 600, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {space ?? '전체 업무'}
        </h1>
        {currentMember && (
          <span style={{ fontSize: 13, color: 'var(--t3)', fontWeight: 400 }}>/ {currentMember.name}</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <Btn onClick={() => openTaskModal()} primary>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
            <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          새 업무
        </Btn>
      </div>
    </header>
  )
}

function Btn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '6px 14px', borderRadius: 'var(--r2)',
        fontSize: 13, fontWeight: 500, cursor: 'pointer',
        border: primary ? 'none' : '1px solid var(--bd2)',
        background: primary ? 'var(--ac)' : 'transparent',
        color: primary ? '#fff' : 'var(--t2)',
        transition: 'background .1s, opacity .1s',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '.85' }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
    >
      {children}
    </button>
  )
}
