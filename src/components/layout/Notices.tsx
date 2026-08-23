import React, { useEffect, useState } from 'react'
import { useNoticeStore } from '../../store/noticeStore'
import { useAuthStore } from '../../store/authStore'
import { useUiStore } from '../../store/uiStore'
import { useProjectStore } from '../../store/projectStore'
import { NOTICE_LABEL as LABEL, NOTICE_TONE as TONE, type Notice } from '../../lib/notify'
import { StatusMark } from '../shared/StatusMark'
import { Icon } from '../shared/Icon'
import { statusAccent } from '../../types'
import { useNoticeToast } from './NoticeToast'
import { useSyncStore } from '../../store/syncStore'
import { pollDriveChanges, POLL_MS } from '../../lib/driveWatch'

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
  const ready = useSyncStore(s => s.ready)

  useEffect(() => {
    if (!email) return
    return subscribe(email)
  }, [email, subscribe])

  /**
   * 밖에서 온 것 — 지금은 드라이브 하나입니다.
   *
   * 업무가 다 도착한 뒤에 시작합니다. 그 전에 물어보면 '붙여 둔 파일이
   * 없다'고 대답하게 되고, 그건 아직 안 온 것뿐입니다.
   *
   * 구독이 아니라 몇 분에 한 번 묻는 방식입니다. 드라이브에는 우리가
   * 받을 수 있는 실시간 통로가 없고, 파일 수정은 초 단위로 급하지도
   * 않습니다.
   */
  useEffect(() => {
    if (!email || !ready) return
    void pollDriveChanges()
    const timer = window.setInterval(() => { void pollDriveChanges() }, POLL_MS)
    return () => clearInterval(timer)
  }, [email, ready])

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

/**
 * ── 받은 알림 목록 ───────────────────────────────────────────────────────────
 *
 * 사이드바 본문을 차지합니다 — 떠 있는 패널이 아니라, 프로젝트 목록이 있던
 * 자리를 대신합니다. 그래서 위치를 계산할 앵커도, 바깥을 덮는 레이어도
 * 없습니다. 폭이 240이라 한 줄에 들어갈 것만 넣습니다: 무슨 일이 일어났는지,
 * 누가 했는지, 언제.
 */
export function NoticeList({ onClose }: { onClose: () => void }) {
  const notices = useNoticeStore(s => s.notices)
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
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {unread > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 10px 6px', flexShrink: 0 }}>
          <button
            onClick={markAllRead}
            style={{ fontSize: 11, color: 'var(--ac)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font)', padding: 0 }}
          >모두 읽음</button>
        </div>
      )}

      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {notices.length === 0 && (
          <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: 12, color: 'var(--sb-t3)', lineHeight: 1.6 }}>
            새 알림이 없습니다
          </div>
        )}
        {notices.map(n => {
          const bucket = dayBucket(n.at)
          const header = bucket !== lastBucket ? bucket : null
          lastBucket = bucket
          const project = n.projectId ? projects.find(p => p.id === n.projectId) : undefined
          const rest = n.read ? 'transparent' : 'var(--ac-l)'
          return (
            <React.Fragment key={n.id}>
              {header && (
                <div style={{ padding: '8px 10px 3px', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', color: 'var(--sb-t3)', background: 'var(--sb-bg)', position: 'sticky', top: 0 }}>
                  {header}
                </div>
              )}
              <div
                onClick={() => openNotice(n)}
                style={{
                  display: 'flex', gap: 8, padding: '7px 8px 7px 10px', margin: '0 4px',
                  borderRadius: 'var(--r2)', cursor: n.taskId ? 'pointer' : 'default',
                  background: rest,
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--sb-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = rest}
              >
                {n.kind === 'file_changed' || n.kind === 'file_removed' ? (
                  // 밖에서 온 줄. 색만으로는 '안에서 누가 뭘 했다'는 다른
                  // 줄들과 안 갈라집니다 — 어디서 온 소식인지가 먼저입니다.
                  <span style={{ color: TONE[n.kind], flexShrink: 0, marginTop: 1, display: 'flex' }}>
                    <Icon name="file" size={12} />
                  </span>
                ) : n.status ? (
                  // The state it moved to, drawn the way the list draws it — so
                  // the row says '검토중' without spending a word on it.
                  <span style={{ color: statusAccent(n.status), flexShrink: 0, marginTop: 2, display: 'flex' }}>
                    <StatusMark status={n.status} size={12} />
                  </span>
                ) : (
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: TONE[n.kind] ?? 'var(--sb-t3)', flexShrink: 0, marginTop: 5 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--sb-t1)', fontWeight: n.read ? 400 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.taskName || '(이름 없음)'}
                  </div>
                  {/* 240 is not 340: the time joins this line rather than taking
                      a column of its own, and the project is the first thing to
                      go when there is no room for it. */}
                  <div style={{ fontSize: 11, color: 'var(--sb-t3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {LABEL[n.kind] ?? n.kind}
                    {n.detail ? ` · ${n.detail}` : ''}
                    {' · '}{n.by}
                    {' · '}{clock(n.at)}
                    {project ? ` · ${project.name}` : ''}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); dismiss(n.id) }}
                  aria-label="지우기"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--sb-t3)', fontSize: 13, padding: '0 2px', flexShrink: 0, lineHeight: 1, alignSelf: 'flex-start', marginTop: 1 }}
                >×</button>
              </div>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
