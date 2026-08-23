import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNoticeStore } from '../../store/noticeStore'
import { useAuthStore } from '../../store/authStore'
import { useUiStore } from '../../store/uiStore'
import { useProjectStore } from '../../store/projectStore'
import { useMobile } from '../../hooks/useMobile'
import { NOTICE_LABEL as LABEL, NOTICE_TONE as TONE, type Notice } from '../../lib/notify'
import { StatusMark } from '../shared/StatusMark'
import { statusAccent } from '../../types'
import { useNoticeToast } from './NoticeToast'

/**
 * ── 알림 ─────────────────────────────────────────────────────────────────────
 *
 * A bell, a count, and a list — deliberately not more than that.
 *
 * The list is the whole feature: what matters is that a notice can be *cleared*,
 * because an inbox nobody can empty is one people stop opening. So every line
 * takes you to the thing it is about and marks itself read on the way, and the
 * header can empty the lot in one press.
 *
 * Grouped by 오늘 / 어제 / 이전, which is how anybody scanning it actually
 * thinks — "did I miss something today" is a different question from "what
 * happened this week".
 */

function dayBucket(at: number): '오늘' | '어제' | '이전' {
  const d = new Date(at)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  if (d >= today) return '오늘'
  if (d >= yesterday) return '어제'
  return '이전'
}

function clock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 받은 알림을 구독하고, 안 읽은 수를 앱 아이콘에 올립니다.
 *
 * 목록을 그리는 곳과 분리돼 있는 이유: 구독은 앱이 떠 있는 내내 살아 있어야
 * 하고(알림은 패널을 열어야 도착하는 게 아닙니다), 목록은 눌렀을 때만
 * 그려집니다. 예전에는 둘이 한 컴포넌트라 종 아이콘이 곧 구독이었습니다.
 */
export function useNoticeInbox() {
  const uid = useAuthStore(s => s.uid)
  const email = useAuthStore(s => s.email)
  const notices = useNoticeStore(s => s.notices)
  const unread = useNoticeStore(s => s.unread)
  const subscribe = useNoticeStore(s => s.subscribe)

  useEffect(() => {
    if (!email) return
    return subscribe(email)
  }, [email, subscribe])

  // The unread count belongs on the app's icon too — iOS and macOS both draw it,
  // and on a phone that badge is the only part of this anybody sees at a glance.
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    }
    if (unread > 0) void nav.setAppBadge?.(unread).catch(() => {})
    else void nav.clearAppBadge?.().catch(() => {})
  }, [unread])

  return { notices, unread, signedIn: !!uid }
}

/** Where the panel hangs from: the sidebar row that opened it. */
export interface NoticeAnchor { top: number; left: number }

/**
 * The list itself — a floating panel on a desktop, a bottom sheet on a phone.
 *
 * It hangs off the sidebar row rather than the top bar, which is where Notion
 * puts its inbox and, more to the point, where the thing that owns it now lives.
 */
export function NoticePanel({ notices, anchor, onClose }: {
  notices: Notice[]
  anchor: NoticeAnchor | null
  onClose: () => void
}) {
  const isMobile = useMobile()

  // The banner hides itself while this list is open, and the test button has to
  // be able to close it — so the panel reports the state and lends its closer.
  useEffect(() => {
    const store = useNoticeToast.getState()
    store.setPanelOpen(true)
    store.registerClose(onClose)
    return () => {
      useNoticeToast.getState().setPanelOpen(false)
      useNoticeToast.getState().registerClose(null)
    }
  }, [onClose])

  return isMobile
    ? <NoticeSheet notices={notices} onClose={onClose} />
    : <NoticePopover notices={notices} anchor={anchor} onClose={onClose} />
}

function NoticePopover({ notices, anchor, onClose }: {
  notices: Notice[]
  anchor: NoticeAnchor | null
  onClose: () => void
}) {
  const width = 340
  // Kept on screen: a row near the bottom of a short window would otherwise
  // hang the panel off the end of it.
  const top = Math.min(anchor?.top ?? 80, Math.max(8, window.innerHeight - 320))
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9300 }} />
      <div style={{
        position: 'fixed', top,
        left: Math.min(anchor?.left ?? 250, window.innerWidth - width - 8),
        width, maxHeight: 'min(70vh, 520px)', zIndex: 9301,
        background: 'var(--bg)', border: '1px solid var(--bd)',
        borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <NoticeList notices={notices} onClose={onClose} />
      </div>
    </>,
    document.body,
  )
}

function NoticeSheet({ notices, onClose }: { notices: Notice[]; onClose: () => void }) {
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 9300 }} />
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9301,
        maxHeight: '78%', background: 'var(--bg)',
        borderTopLeftRadius: 'var(--r4)', borderTopRightRadius: 'var(--r4)',
        boxShadow: '0 -8px 40px rgba(0,0,0,.2)',
        paddingBottom: 'var(--safe-b)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 2px' }}>
          <span style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--bd2)' }} />
        </div>
        <NoticeList notices={notices} onClose={onClose} />
      </div>
    </>,
    document.body,
  )
}

function NoticeList({ notices, onClose }: { notices: Notice[]; onClose: () => void }) {
  const markRead = useNoticeStore(s => s.markRead)
  const markAllRead = useNoticeStore(s => s.markAllRead)
  const dismiss = useNoticeStore(s => s.dismiss)
  const openTaskDetail = useUiStore(s => s.openTaskDetail)
  const projects = useProjectStore(s => s.projects)
  const unread = useNoticeStore(s => s.unread)

  const openNotice = (n: Notice) => {
    if (!n.read) markRead(n.id)
    if (n.taskId) { openTaskDetail(n.taskId); onClose() }
  }

  let lastBucket = ''

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>
          알림{unread > 0 ? ` ${unread}` : ''}
        </span>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            style={{ fontSize: 12, color: 'var(--ac)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font)', padding: 0 }}
          >모두 읽음</button>
        )}
      </div>


      <div style={{ overflowY: 'auto', flex: 1 }}>
        {notices.length === 0 && (
          <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: 13, color: 'var(--t3)' }}>
            새 알림이 없습니다
          </div>
        )}
        {notices.map(n => {
          const bucket = dayBucket(n.at)
          const header = bucket !== lastBucket ? bucket : null
          lastBucket = bucket
          const project = n.projectId ? projects.find(p => p.id === n.projectId) : undefined
          return (
            <React.Fragment key={n.id}>
              {header && (
                <div style={{ padding: '8px 14px 4px', fontSize: 11, fontWeight: 600, color: 'var(--t3)', background: 'var(--bg)', position: 'sticky', top: 0 }}>
                  {header}
                </div>
              )}
              <div
                onClick={() => openNotice(n)}
                style={{
                  display: 'flex', gap: 9, padding: '9px 14px', cursor: n.taskId ? 'pointer' : 'default',
                  background: n.read ? 'transparent' : 'rgba(35,131,226,.05)',
                  borderBottom: '1px solid var(--bd)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                onMouseLeave={e => e.currentTarget.style.background = n.read ? 'transparent' : 'rgba(35,131,226,.05)'}
              >
                {n.status ? (
                  // The state it moved to, drawn the way the list draws it — so
                  // the row says '검토중' without spending a word on it.
                  <span style={{ color: statusAccent(n.status), flexShrink: 0, marginTop: 2, display: 'flex' }}>
                    <StatusMark status={n.status} size={13} />
                  </span>
                ) : (
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: TONE[n.kind] ?? 'var(--t3)', flexShrink: 0, marginTop: 5 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--t1)', fontWeight: n.read ? 400 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.taskName || '(이름 없음)'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {LABEL[n.kind] ?? n.kind}
                    {n.detail ? ` · ${n.detail}` : ''}
                    {' · '}{n.by}
                    {project ? ` · ${project.name}` : ''}
                  </div>
                </div>
                <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0, marginTop: 2 }}>{clock(n.at)}</span>
                <button
                  onClick={e => { e.stopPropagation(); dismiss(n.id) }}
                  aria-label="지우기"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 13, padding: '0 2px', flexShrink: 0, lineHeight: 1 }}
                >×</button>
              </div>
            </React.Fragment>
          )
        })}
      </div>
    </>
  )
}
