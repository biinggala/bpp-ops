import React from 'react'
import { useUiStore } from '../../store/uiStore'
import { useAuthStore } from '../../store/authStore'
import { useMobile } from '../../hooks/useMobile'

export function Topbar() {
  const { space, openTaskModal, toggleSidebar } = useUiStore()
  const { memberKey } = useAuthStore()
  const isMobile = useMobile()

  return (
    <header style={{
      height: 52,
      background: 'var(--bg)',
      borderBottom: '1px solid var(--bd)',
      padding: '0 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexShrink: 0,
    }}>
      {isMobile && (
        <button
          onClick={toggleSidebar}
          aria-label="메뉴"
          style={{
            width: 36, height: 36, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 5,
            background: 'transparent', border: 'none', cursor: 'pointer',
            borderRadius: 'var(--r2)', flexShrink: 0, padding: 0,
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span style={{ display: 'block', width: 18, height: 1.5, background: 'var(--t2)', borderRadius: 2 }} />
          <span style={{ display: 'block', width: 18, height: 1.5, background: 'var(--t2)', borderRadius: 2 }} />
          <span style={{ display: 'block', width: 18, height: 1.5, background: 'var(--t2)', borderRadius: 2 }} />
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        <h1 style={{ fontSize: isMobile ? 15 : 16, fontWeight: 600, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {space ?? '전체 업무'}
        </h1>
        {memberKey && !isMobile && (
          <span style={{ fontSize: 13, color: 'var(--t3)', fontWeight: 400 }}>/ {memberKey}</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {isMobile ? (
          <button
            onClick={() => openTaskModal()}
            aria-label="새 업무"
            style={{
              width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--ac)', border: 'none', borderRadius: 'var(--r2)',
              cursor: 'pointer', color: '#fff', flexShrink: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        ) : (
          <Btn onClick={() => openTaskModal()} primary>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
            새 업무
          </Btn>
        )}
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
