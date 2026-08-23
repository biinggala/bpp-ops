import React from 'react'
import { useUiStore } from '../../store/uiStore'
import { useProjectStore } from '../../store/projectStore'
import { useMobile } from '../../hooks/useMobile'
import { haptic } from '../../lib/haptics'
import { MobileFilterButton } from './MobileFilterSheet'
import { pendingUpdate, installUpdate, openInBrowser, type DesktopRelease } from '../../lib/desktopUpdate'
import { Icon } from '../shared/Icon'
import { Tip, CMD } from '../shared/Tip'

export function Topbar() {
  const { space, projectId, myTasksOnly, openTaskModal, toggleSidebar, view, screen } = useUiStore()
  const sidebarHidden = useUiStore(s => s.sidebarHidden)
  const toggleSidebarHidden = useUiStore(s => s.toggleSidebarHidden)
  const projects = useProjectStore(s => s.projects)
  const isMobile = useMobile()

  const activeProject = projectId ? projects.find(p => p.id === projectId) : null
  const personalOnly = useUiStore(s => s.personalOnly)
  const title = screen === 'today'
    ? '오늘'
    : screen === 'calendar'
    ? '캘린더'
    : (activeProject?.name ?? space ?? (personalOnly ? '개인' : myTasksOnly ? '내 할 일' : '전체 업무'))

  return (
    <header style={{
      paddingTop: 'env(safe-area-inset-top, 0px)',
      background: 'var(--bg)',
      borderBottom: '1px solid var(--bd)',
      flexShrink: 0,
    }}>
      <div style={{
        height: 52,
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
      {/* 넓은 화면에서 사이드바를 접었다 폈다. 접혀 있든 펴져 있든 자리가
          같습니다 — 접는 버튼과 펴는 버튼이 다른 데 있으면 접고 나서 되돌릴
          것을 찾아야 합니다. */}
      {!isMobile && (
        <Tip label={sidebarHidden ? '사이드바 보이기' : '사이드바 숨기기'} keys={[CMD, '\\']}>
          <button
            onClick={toggleSidebarHidden}
            aria-label={sidebarHidden ? '사이드바 보이기' : '사이드바 숨기기'}
            style={{
              width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', cursor: 'pointer',
              borderRadius: 'var(--r2)', flexShrink: 0, padding: 0,
              color: sidebarHidden ? 'var(--t3)' : 'var(--t2)',
              marginLeft: -6, marginRight: 2,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Icon name="panel" size={17} />
          </button>
        </Tip>
      )}

      {isMobile && (
        <button
          onClick={() => { haptic('tap'); toggleSidebar() }}
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
          {title}
        </h1>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <UpdateButton />
        {/* One door to everything that narrows or reorders the view. The ✓ that
            used to sit here toggled only 완료 숨기기, and left the other six
            controls with nowhere to live on a phone. */}
        {isMobile && screen === 'work' && view !== 'f' && <MobileFilterButton />}
        {isMobile ? (
          <button
            onClick={() => { haptic('tap'); openTaskModal() }}
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

/**
 * Shown only in the desktop app, and only when its binary is behind.
 *
 * The web half of the app updates itself — the shell loads the deployment — so
 * there is nothing here to announce most of the time, and a button that says
 * "최신입니다" every day is a button nobody reads. It appears when there is
 * something to do and is absent otherwise.
 *
 * Clicking it does the update rather than describing where to find one. A shell
 * old enough to have no updater in it falls back to the download page, which is
 * the only thing it can do.
 */
function UpdateButton() {
  const [update, setUpdate] = React.useState<DesktopRelease | null>(null)
  const [percent, setPercent] = React.useState<number | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [failed, setFailed] = React.useState<string | null>(null)

  React.useEffect(() => {
    let alive = true
    const check = () => { void pendingUpdate().then(u => { if (alive) setUpdate(u) }) }
    check()
    // The app sits open for days, and a release lands while it does.
    const timer = setInterval(check, 6 * 60 * 60 * 1000)
    window.addEventListener('focus', check)
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', check) }
  }, [])

  if (!update) return null

  const run = async () => {
    haptic('tap')
    setBusy(true); setFailed(null); setPercent(null)
    try {
      // Returns only by restarting into the new build; anything else threw.
      await installUpdate(setPercent)
    } catch (e) {
      setBusy(false)
      setFailed(e instanceof Error ? e.message : '업데이트에 실패했습니다')
    }
  }

  const label = busy
    ? (percent === null ? '준비 중…' : percent < 100 ? `내려받는 중 ${percent}%` : '설치 중…')
    : failed
      ? '다운로드 페이지 열기'
      : `업데이트 ${update.version}`

  return (
    <button
      onClick={() => { if (busy) return; if (failed) { void openInBrowser(update.url) } else { void run() } }}
      title={failed ?? `새 버전 ${update.version} — 받아서 설치하고 다시 시작합니다`}
      style={{
        position: 'relative', overflow: 'hidden',
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 11px', borderRadius: 'var(--r2)',
        fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
        cursor: busy ? 'default' : 'pointer',
        border: `1px solid ${failed ? 'var(--danger)' : '#448361'}`,
        background: failed ? 'rgba(212,76,71,.1)' : 'rgba(68,131,97,.12)',
        color: failed ? 'var(--danger)' : '#448361',
        fontFamily: 'var(--font)',
      }}
      onMouseEnter={e => { if (!busy) e.currentTarget.style.background = failed ? 'rgba(212,76,71,.18)' : 'rgba(68,131,97,.2)' }}
      onMouseLeave={e => { e.currentTarget.style.background = failed ? 'rgba(212,76,71,.1)' : 'rgba(68,131,97,.12)' }}
    >
      {/* The bar is the button filling up, rather than a second thing to look at. */}
      {busy && percent !== null && (
        <span style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: `${percent}%`,
          background: 'rgba(68,131,97,.22)', transition: 'width .2s', pointerEvents: 'none',
        }} />
      )}
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, zIndex: 1 }}>
        <path d="M6 9V2M6 2L3 5M6 2l3 3M2 10h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <span style={{ zIndex: 1 }}>{label}</span>
    </button>
  )
}
