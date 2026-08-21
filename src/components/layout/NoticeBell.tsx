import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNoticeStore } from '../../store/noticeStore'
import { useAuthStore } from '../../store/authStore'
import { useUiStore } from '../../store/uiStore'
import { useProjectStore } from '../../store/projectStore'
import { useMobile } from '../../hooks/useMobile'
import { haptic } from '../../lib/haptics'
import { NOTICE_LABEL as LABEL, NOTICE_TONE as TONE, type Notice } from '../../lib/notify'
import { StatusMark } from '../shared/StatusMark'
import { statusAccent } from '../../types'
import { disablePush, enablePush, pushEnabledHere, pushSupport, showLocalNotice } from '../../lib/push'
import { showTestNotice, useNoticeToast } from './NoticeToast'
import { chimeEnabled, playChime, setChimeEnabled } from '../../lib/chime'

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

export function NoticeBell() {
  const uid = useAuthStore(s => s.uid)
  const notices = useNoticeStore(s => s.notices)
  const unread = useNoticeStore(s => s.unread)
  const subscribe = useNoticeStore(s => s.subscribe)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)
  const isMobile = useMobile()

  useEffect(() => {
    if (!uid) return
    return subscribe(uid)
  }, [uid, subscribe])

  // The banner hides itself while this list is open; it has to be told.
  useEffect(() => {
    useNoticeToast.getState().setPanelOpen(open)
    return () => useNoticeToast.getState().setPanelOpen(false)
  }, [open])

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

  if (!uid) return null

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    haptic('tap')
    if (open) { setOpen(false); return }
    const r = e.currentTarget.getBoundingClientRect()
    setAnchor({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
    setOpen(true)
  }

  return (
    <>
      <button
        onClick={toggle}
        aria-label={unread ? `알림 ${unread}건` : '알림'}
        style={{
          position: 'relative', width: 36, height: 36, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: open ? 'var(--bg3)' : 'transparent', border: 'none',
          borderRadius: 'var(--r2)', cursor: 'pointer', color: 'var(--t2)', padding: 0,
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--bg3)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8.6a6 6 0 1 0-12 0c0 5.2-2.1 6.4-2.1 6.4h16.2S18 13.8 18 8.6" />
          <path d="M13.7 19a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 3,
            minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 999, background: '#D44C47', color: '#fff',
            fontSize: 10, fontWeight: 700, lineHeight: '16px', textAlign: 'center',
            boxShadow: '0 0 0 2px var(--bg)',
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (isMobile
        ? <NoticeSheet notices={notices} onClose={() => setOpen(false)} />
        : <NoticePopover notices={notices} anchor={anchor} onClose={() => setOpen(false)} />)}
    </>
  )
}

function NoticePopover({ notices, anchor, onClose }: {
  notices: Notice[]
  anchor: { top: number; right: number } | null
  onClose: () => void
}) {
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9300 }} />
      <div style={{
        position: 'fixed', top: anchor?.top ?? 60, right: anchor?.right ?? 12,
        width: 340, maxHeight: 'min(70vh, 520px)', zIndex: 9301,
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

      <PushToggle />
      <ChimeToggle />

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

/**
 * The switch for push, where the notifications already are.
 *
 * It has to be a tap on this device: a subscription belongs to one browser on
 * one machine, so turning it on on the laptop says nothing about the phone. And
 * the reason it cannot be turned on — an iPhone not yet added to the home
 * screen, a desktop shell with no Push API — is written out rather than left as
 * a dead switch.
 */
/** The switch used by both rows below, so they cannot drift apart. */
function MiniSwitch({ on, busy, onClick }: { on: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      role="switch"
      aria-checked={on}
      style={{
        width: 38, height: 22, borderRadius: 999, flexShrink: 0, padding: 2,
        border: 'none', cursor: busy ? 'default' : 'pointer',
        background: on ? 'var(--ac)' : 'var(--bd2)',
        display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start',
        transition: 'background .15s', opacity: busy ? .6 : 1,
      }}
    >
      <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)', transition: 'all .15s' }} />
    </button>
  )
}

const ROW: React.CSSProperties = {
  padding: '8px 14px', borderBottom: '1px solid var(--bd)',
  display: 'flex', alignItems: 'center', gap: 8,
}

/**
 * 알림 소리 — 배너가 뜰 때만.
 *
 * A push that arrives with the app closed uses the phone's own notification
 * sound; nothing here reaches that, and no web app can choose it. So this is
 * about the banner, and it is a per-device choice like the push switch: the
 * laptop in a shared room and the phone in a pocket do not want the same answer.
 */
function ChimeToggle() {
  const [on, setOn] = useState(chimeEnabled())
  return (
    <div style={ROW}>
      <span style={{ fontSize: 12, color: 'var(--t2)', flex: 1, minWidth: 0 }}>알림 소리</span>
      <MiniSwitch
        on={on}
        onClick={() => {
          const next = !on
          setChimeEnabled(next); setOn(next)
          // Hearing it is the only way to judge it.
          if (next) playChime()
        }}
      />
    </div>
  )
}

function PushToggle() {
  const [on, setOn] = useState(pushEnabledHere())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const me = useAuthStore(s => s.displayName || s.email?.split('@')[0] || '나')
  const support = pushSupport()

  /**
   * Two notifications from one press, because they can fail separately.
   *
   * The banner is drawn by the app and always works. The OS notification needs
   * a real notification permission and a live worker — and *not* a push — so
   * when it fails it says which of the two is broken, which is the question
   * 'permission denied' on its own never answered.
   */
  const runTest = async () => {
    showTestNotice(me)
    const res = await showLocalNotice('테스트 알림', '이게 보이면 폰 알림은 정상입니다')
    setError(res.ok ? null : `OS 알림 실패 — ${res.reason}`)
  }

  // Offered even where push cannot work at all — on the desktop app the banner
  // *is* the notification, and this is the only way to see it without waiting
  // for a colleague to assign something.
  const test = (
    <button
      onClick={() => void runTest()}
      style={{
        fontSize: 11, color: 'var(--ac)', background: 'transparent', border: 'none',
        cursor: 'pointer', fontFamily: 'var(--font)', padding: 0, flexShrink: 0,
      }}
    >테스트</button>
  )

  if (!support.ok) {
    return (
      <div style={{
        padding: '8px 14px', borderBottom: '1px solid var(--bd)', fontSize: 11,
        color: 'var(--t3)', lineHeight: 1.5, display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          {support.reason}
          {error && <span style={{ display: 'block', color: '#D44C47', marginTop: 3 }}>{error}</span>}
        </span>
        {test}
      </div>
    )
  }

  const toggle = async () => {
    setBusy(true); setError(null)
    if (on) {
      await disablePush()
      setOn(false)
    } else {
      const res = await enablePush()
      if (res.ok) setOn(true)
      else setError(res.reason)
    }
    setBusy(false)
  }

  return (
    <div style={ROW}>
      <span style={{ fontSize: 12, color: 'var(--t2)', flex: 1, minWidth: 0 }}>
        이 기기에서 푸시 받기
        {error && <span style={{ display: 'block', fontSize: 11, color: '#D44C47' }}>{error}</span>}
      </span>
      {test}
      <MiniSwitch on={on} busy={busy} onClick={() => void toggle()} />
    </div>
  )
}
