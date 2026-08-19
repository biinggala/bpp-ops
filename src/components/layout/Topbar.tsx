import React from 'react'
import { useUiStore } from '../../store/uiStore'
import { useProjectStore } from '../../store/projectStore'
import { useMobile } from '../../hooks/useMobile'
import { safeExternalUrl } from '../../lib/utils'
import { haptic } from '../../lib/haptics'
import { MobileFilterButton } from './MobileFilterSheet'

export function Topbar() {
  const { space, projectId, myTasksOnly, openTaskModal, toggleSidebar, view } = useUiStore()
  const projects = useProjectStore(s => s.projects)
  const isMobile = useMobile()

  const activeProject = projectId ? projects.find(p => p.id === projectId) : null
  const title = activeProject?.name ?? space ?? (myTasksOnly ? '내 할 일' : '전체 업무')
  // The project's folder used to be a 📁 that appeared on hover over the sidebar
  // row — invisible until you already suspected it was there. It belongs next to
  // the project's name, where it is on screen the whole time you are in the
  // project. (Setting it is still the sidebar's right-click menu.)
  const folderUrl = safeExternalUrl(activeProject?.driveFolderUrl)

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
        {folderUrl && (
          <a
            href={folderUrl} target="_blank" rel="noopener noreferrer"
            title="프로젝트 드라이브 폴더 열기"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
              padding: '3px 9px', borderRadius: 999,
              border: '1px solid var(--bd)', background: 'transparent',
              color: 'var(--t2)', fontSize: 12, textDecoration: 'none',
              transition: 'background .1s, border-color .1s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.borderColor = 'var(--bd2)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--bd)' }}
          >
            📁 {isMobile ? '' : '자료 폴더'}
          </a>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {/* One door to everything that narrows or reorders the view. The ✓ that
            used to sit here toggled only 완료 숨기기, and left the other six
            controls with nowhere to live on a phone. */}
        {isMobile && view !== 'f' && <MobileFilterButton />}
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
