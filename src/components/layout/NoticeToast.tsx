import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { useNoticeStore } from '../../store/noticeStore'
import { useUiStore } from '../../store/uiStore'
import { useMobile } from '../../hooks/useMobile'
import { NOTICE_HEADLINE, NOTICE_LABEL, NOTICE_TONE, type Notice } from '../../lib/notify'
import { StatusMark } from '../shared/StatusMark'
import { statusAccent } from '../../types'
import { chimeEnabled, playChime } from '../../lib/chime'
import { showLocalNotice } from '../../lib/push'

/**
 * ── 앱이 열려 있을 때 오는 알림 ───────────────────────────────────────────────
 *
 * A notice that lands while somebody is looking at the app should not wait in
 * the bell for them to notice the count changed. It slides in, says what
 * happened, and goes away.
 *
 * **This is the only notification the desktop app can show.** Its WKWebView has
 * no Push API — the switch in the bell says so — so on the desktop this banner
 * is the whole mechanism, and it works because the inbox is a live database
 * subscription rather than something a push has to wake.
 *
 * Only notices that arrive **after** the app opened are shown. The hundred
 * already in the inbox are not news, and a stack of them on every launch is how
 * people learn to ignore the thing.
 */

interface ToastState {
  notice: Notice | null
  /** True while the bell's own list is open. */
  panelOpen: boolean
  /** The bell hands over its own closer; nothing else can shut that list. */
  closePanel: (() => void) | null
  show: (n: Notice) => void
  hide: () => void
  setPanelOpen: (open: boolean) => void
  registerClose: (close: (() => void) | null) => void
}

export const useNoticeToast = create<ToastState>(set => ({
  notice: null,
  panelOpen: false,
  closePanel: null,
  show: notice => set({ notice }),
  hide: () => set({ notice: null }),
  // A banner over the open list is two copies of the same sentence, and they
  // land on top of each other — the list is in the same corner.
  setPanelOpen: panelOpen => set(panelOpen ? { panelOpen, notice: null } : { panelOpen }),
  registerClose: closePanel => set({ closePanel }),
}))

/** How long a banner stays. Long enough to read two lines, not long enough to nag. */
const LINGER = 6000

/** Topbar.tsx's own height. Kept in step by hand; it has not moved in months. */
const TOPBAR_H = 52

export function NoticeToast() {
  const notice = useNoticeToast(s => s.notice)
  const panelOpen = useNoticeToast(s => s.panelOpen)
  const hide = useNoticeToast(s => s.hide)
  const notices = useNoticeStore(s => s.notices)
  const markRead = useNoticeStore(s => s.markRead)
  const openTaskDetail = useUiStore(s => s.openTaskDetail)
  const isMobile = useMobile()
  const [shown, setShown] = useState(false)

  // Everything already in the inbox when this mounted is history, not news.
  const openedAt = useRef(Date.now())
  const seen = useRef(new Set<string>())

  useEffect(() => {
    const fresh = notices.find(n => n.at > openedAt.current && !seen.current.has(n.id))
    if (!fresh) return
    seen.current.add(fresh.id)
    // Marked seen either way: once the list has been open past it, it is read.
    if (useNoticeToast.getState().panelOpen) return

    // Out of sight — the phone's own notification is the right instrument, and
    // it needs no push because the app is still running to make the call.
    if (document.hidden) {
      void showLocalNotice(
        NOTICE_HEADLINE[fresh.kind] ?? '알림',
        [fresh.taskName, fresh.detail].filter(Boolean).join(' · '),
        fresh.taskId ? `/?task=${fresh.taskId}` : '/',
        `notice:${fresh.id}`,
      )
      return
    }

    useNoticeToast.getState().show(fresh)
    if (chimeEnabled()) playChime()
  }, [notices])

  // Two effects rather than one: the entrance has to be a second frame, or the
  // element is born at its final position and there is nothing to animate.
  useEffect(() => {
    if (!notice) return void setShown(false)
    const enter = requestAnimationFrame(() => setShown(true))
    const leave = setTimeout(() => setShown(false), LINGER)
    const gone = setTimeout(hide, LINGER + 250)
    return () => { cancelAnimationFrame(enter); clearTimeout(leave); clearTimeout(gone) }
  }, [notice, hide])

  // The desktop popover sits in this exact corner, so a banner over it is the
  // collision. The phone's sheet is at the bottom and never overlaps — and
  // keeping the sheet open there is what lets its own error text stay readable.
  if (!notice || (panelOpen && !isMobile)) return null

  const open = () => {
    if (!notice.read && !notice.id.startsWith('test:')) markRead(notice.id)
    if (notice.taskId) openTaskDetail(notice.taskId)
    hide()
  }

  const detail = [NOTICE_LABEL[notice.kind] ?? notice.kind, notice.detail, notice.by]
    .filter(Boolean).join(' · ')

  // Portalled to the body, like every other fixed overlay in the app: a
  // transformed ancestor anywhere above would otherwise become this element's
  // containing block and move it somewhere nobody can see.
  return createPortal(
    <div
      style={{
        position: 'fixed', zIndex: 9800,
        // Under the top bar rather than over it — the bar holds the bell and
        // the '새 업무' button, and a card across them reads as a broken layout.
        top: `calc(env(safe-area-inset-top, 0px) + ${TOPBAR_H + 8}px)`,
        right: isMobile ? 8 : 14,
        left: isMobile ? 8 : 'auto',
        width: isMobile ? 'auto' : 330,
        // Slides from the edge it is pinned to.
        transform: shown ? 'none' : `translate${isMobile ? 'Y(-18px)' : 'X(24px)'}`,
        opacity: shown ? 1 : 0,
        transition: 'transform .22s ease-out, opacity .22s ease-out',
      }}
    >
      <div
        onClick={open}
        style={{
          display: 'flex', gap: 10, alignItems: 'flex-start',
          padding: '11px 12px',
          // Opaque on purpose. `--bg1` was never a token, so this drew with no fill at
          // all and the panel behind it read straight through — the same mistake the
          // Gantt's pinned column made with the translucent `--bg3`.
          background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 10,
          boxShadow: '0 8px 28px rgba(15,15,15,.16)',
          cursor: notice.taskId ? 'pointer' : 'default',
        }}
      >
        {notice.status ? (
          <span style={{ color: statusAccent(notice.status), flexShrink: 0, marginTop: 1, display: 'flex' }}>
            <StatusMark status={notice.status} size={14} />
          </span>
        ) : (
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 4,
            background: NOTICE_TONE[notice.kind] ?? 'var(--t3)',
          }} />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 500, color: 'var(--t1)', lineHeight: 1.35,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {notice.taskName || '(이름 없음)'}
          </div>
          <div style={{
            fontSize: 11, color: 'var(--t3)', marginTop: 2, lineHeight: 1.4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {detail}
          </div>
        </div>

        <button
          onClick={e => { e.stopPropagation(); setShown(false); setTimeout(hide, 250) }}
          aria-label="닫기"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--t3)',
            fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0, marginTop: 1,
          }}
        >×</button>
      </div>
    </div>,
    document.body,
  )
}

/**
 * The banner a person can raise themselves, to see whether this works at all.
 *
 * Closing the list first is the point rather than a detail: the banner is
 * suppressed while the list is open, and the list is where the button lives.
 */
export function showTestNotice(by: string, closeList = true) {
  const { closePanel } = useNoticeToast.getState()
  if (closeList) closePanel?.()
  // A tick, so the list is gone before the banner slides in. Showing it in the
  // same frame drew both at once, on top of each other.
  setTimeout(() => {
    useNoticeToast.getState().show({
      id: `test:${Date.now()}`,
      kind: 'assigned',
      by,
      taskName: '테스트 알림 — 이렇게 보입니다',
      at: Date.now(),
      read: true,
    })
    if (chimeEnabled()) playChime()
  }, 140)
}
