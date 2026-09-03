import React, { useEffect, useMemo, useState } from 'react'
import { useNoticeStore } from '../../store/noticeStore'
import { useAuthStore } from '../../store/authStore'
import { useUiStore } from '../../store/uiStore'
import { useProjectStore } from '../../store/projectStore'
import { useUserProfileStore } from '../../store/userProfileStore'
import { NOTICE_LABEL as LABEL, NOTICE_TONE as TONE, type Notice } from '../../lib/notify'
import { StatusMark } from '../shared/StatusMark'
import { Icon } from '../shared/Icon'
import { statusAccent } from '../../types'
import { useNoticeToast } from './NoticeToast'
import { useSyncStore } from '../../store/syncStore'
import { pollDriveChanges, POLL_MS } from '../../lib/driveWatch'
import { useMailStore, MAIL_POLL_MS, warmMailAuth } from '../../store/mailStore'
import { useGCalStore, awaitingMe, myAttendance } from '../../store/gcalStore'
import { onePerEvent } from '../../lib/attendance'
import { RsvpPicker } from '../shared/RsvpPicker'
import { fmtYMD, addDays } from '../../lib/utils'
import { threadUrl } from '../../lib/gmail'
import { openExternal } from '../../lib/desktopLinks'

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

  /**
   * 메일. 연동 안 했으면 refresh가 조용히 아무것도 안 합니다.
   *
   * 저장하지 않으므로 앱이 떠 있는 동안만 최신입니다 — 그래서 목록을 여는
   * 순간이 아니라 앱이 사는 내내 물어봅니다. 배지가 목록을 열어야 맞는
   * 숫자가 되면 배지가 아닙니다.
   */
  const refreshMail = useMailStore(s => s.refresh)
  useEffect(() => {
    if (!email) return
    void refreshMail()
    const timer = window.setInterval(() => { void refreshMail() }, MAIL_POLL_MS)
    return () => clearInterval(timer)
  }, [email, refreshMail])

  /**
   * 캘린더 초대.
   *
   * 목록을 열 때가 아니라 앱이 사는 내내 창을 확보해 둡니다 — 캘린더 화면을
   * 한 번도 안 열어 본 사람에게도 초대가 도착해야 하고, 배지가 목록을 열어야
   * 맞는 숫자가 되면 배지가 아닙니다.
   *
   * 오늘부터 4주. 지난 초대는 답해도 소용이 없고, 두 달 뒤 초대는 지금 답할
   * 일이 아닙니다.
   */
  const gcalToken = useGCalStore(s => s.token)
  const ensureEvents = useGCalStore(s => s.ensureEvents)
  useEffect(() => {
    if (!gcalToken) return
    const today = new Date()
    void ensureEvents(fmtYMD(today), fmtYMD(addDays(today, 28)))
  }, [gcalToken, ensureEvents])

  // The unread count belongs on the app's icon too — iOS and macOS both draw it,
  // and on a phone that badge is the only part of this anybody sees at a glance.
  /**
   * 운영체제 배지는 **업무 알림만** 셉니다.
   *
   * 안에 있는 탭 배지는 그 목록에 있는 걸 다 세는 게 맞지만, 홈 화면의 배지는
   * 다릅니다 — 같은 폰에 지메일 앱이 이미 그 메일을 세고 있습니다. 한 통을 두
   * 아이콘이 같이 세면 둘 다 못 믿게 됩니다. 이 앱만 아는 것만 여기 올립니다.
   */
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    }
    if (unread > 0) void nav.setAppBadge?.(unread).catch(() => {})
    else void nav.clearAppBadge?.().catch(() => {})
  }, [unread])

  // 밖에서 온 것도 배지에 셉니다. 답할 메일 세 통이 있는데 배지가 0이면,
  // 그 배지는 '받은 알림'이 아니라 '업무 알림'의 배지입니다.
  const mailCount = useMailStore(s => s.threads.length)
  const inviteCount = usePendingInvites().length

  return { notices, unread, external: mailCount + inviteCount, signedIn: !!uid }
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
  // 보낸 사람은 지금 이름으로. 알림에는 보낼 때의 이름이 찍혀 있는데, 그
  // 사람이 프로필에서 이름을 고치면 옛 알림도 새 이름으로 읽혀야 합니다.
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const notices = useNoticeStore(s => s.notices)
  const markRead = useNoticeStore(s => s.markRead)
  const markAllRead = useNoticeStore(s => s.markAllRead)
  const dismiss = useNoticeStore(s => s.dismiss)
  const openTaskDetail = useUiStore(s => s.openTaskDetail)
  const projects = useProjectStore(s => s.projects)
  const unread = useNoticeStore(s => s.unread)
  const mailCount = useMailStore(s => s.threads.length)
  const inviteCount = usePendingInvites().length

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
        {/* 밖에서 온 것이 위입니다. 여섯 줄로 끝나는 목록이고, 아래의 업무
            알림은 끝이 없습니다 — 길이를 모르는 목록 밑에 짧은 목록을 두면
            아무도 못 봅니다. */}
        <InviteSection />
        <MailSection />

        {notices.length > 0 && (
          <SectionHead>업무</SectionHead>
        )}
        {notices.length === 0 && mailCount === 0 && inviteCount === 0 && (
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
                <div style={{ padding: '10px 10px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', color: 'var(--sb-t3)', background: 'var(--sb-bg)', position: 'sticky', top: 0 }}>
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
                  <div style={{ fontSize: 13.5, color: 'var(--sb-t1)', fontWeight: n.read ? 500 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.taskName || '(이름 없음)'}
                  </div>
                  {/* 240 is not 340: the time joins this line rather than taking
                      a column of its own, and the project is the first thing to
                      go when there is no room for it. */}
                  <div style={{ fontSize: 12, color: 'var(--sb-t3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {LABEL[n.kind] ?? n.kind}
                    {n.detail ? ` · ${n.detail}` : ''}
                    {' · '}{n.byEmail ? getNameByEmail(n.byEmail) : n.by}
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

/* ── 밖에서 온 것 ────────────────────────────────────────────────────────── */

function SectionHead({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '10px 10px 4px', fontSize: 11, fontWeight: 700,
      letterSpacing: '.06em', color: 'var(--sb-t3)',
    }}>
      <span>{children}</span>
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  )
}

/**
 * ── 답할 메일 ────────────────────────────────────────────────────────────────
 *
 * '안 읽은 메일'이 아닙니다. 그건 지메일이 훨씬 잘합니다. 여기 오는 건 **나에게
 * 물어 왔고 내가 아직 답 안 한** 대화뿐이고, 그래서 보통 서너 줄입니다.
 *
 * 읽음 표시가 여기 없는 것도 같은 이유입니다. 누르면 지메일이 열리고, 거기서
 * 읽으면 다음 새로고침에 사라집니다. 우리 쪽에 '읽음'을 하나 더 만들면 두
 * 군데가 어긋나고, 그때부터 어느 쪽도 못 믿습니다.
 */
function MailSection() {
  const threads = useMailStore(s => s.threads)
  const wasConnected = useMailStore(s => s.wasConnected)
  const needsReconnect = useMailStore(s => s.needsReconnect)
  const connecting = useMailStore(s => s.connecting)
  const connect = useMailStore(s => s.connect)
  const error = useMailStore(s => s.error)

  // 연동 버튼을 누른 다음이 아니라 목록이 그려질 때 준비합니다. 네트워크를
  // 한 번 다녀온 뒤에 여는 창은 iOS가 막습니다 — 드라이브와 같은 처방.
  useEffect(() => { if (!wasConnected) warmMailAuth() }, [wasConnected])

  if (!wasConnected || needsReconnect) {
    return (
      <>
        <SectionHead>메일</SectionHead>
        <div style={{ padding: '2px 10px 8px' }}>
          <div style={{ fontSize: 11, color: 'var(--sb-t3)', lineHeight: 1.6, marginBottom: 7 }}>
            {needsReconnect
              ? '구글 로그인이 만료됐습니다'
              : '답장을 기다리는 메일만 여기 모입니다'}
          </div>
          <button
            onClick={() => void connect()}
            disabled={connecting}
            style={{
              padding: '4px 10px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
              background: 'transparent', color: 'var(--ac)', fontSize: 11,
              cursor: connecting ? 'default' : 'pointer', fontFamily: 'var(--font)',
              opacity: connecting ? .6 : 1,
            }}
          >{connecting ? '연결 중…' : needsReconnect ? '다시 연결' : '메일 연동'}</button>
          {error && <div style={{ fontSize: 10, color: 'var(--danger)', marginTop: 6, lineHeight: 1.5 }}>{error}</div>}
        </div>
      </>
    )
  }

  if (!threads.length) return null

  return (
    <>
      <SectionHead right={<span style={{ opacity: .7 }}>{threads.length}</span>}>메일</SectionHead>
      {threads.map(t => <MailRow key={t.threadId} thread={t} />)}
    </>
  )
}

function MailRow({ thread }: { thread: { threadId: string; subject: string; from: string; snippet: string; at: number; count: number } }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={() => void openExternal(threadUrl(thread.threadId))}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={thread.snippet}
      style={{
        display: 'flex', gap: 8, padding: '7px 8px 7px 10px', margin: '0 4px',
        borderRadius: 'var(--r2)', cursor: 'pointer',
        background: hovered ? 'var(--sb-hover)' : 'transparent',
      }}
    >
      <span style={{ color: '#D9730D', flexShrink: 0, marginTop: 2, display: 'flex' }}>
        <Icon name="mail" size={12} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13.5, color: 'var(--sb-t1)', fontWeight: 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{thread.subject}</div>
        <div style={{
          fontSize: 12, color: 'var(--sb-t3)', marginTop: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {thread.from}
          {thread.count > 1 ? ` · ${thread.count}개` : ''}
          {' · '}{clock(thread.at)}
        </div>
      </div>
    </div>
  )
}

/**
 * ── 답을 기다리는 캘린더 초대 ────────────────────────────────────────────────
 *
 * 지금까지는 캘린더 화면을 열어야만 점선으로 보였습니다. 초대는 '내가 찾아가서
 * 봐야 하는 것'이 아니라 도착하는 것이고, 도착하는 것들이 모이는 자리는
 * 받은 알림입니다.
 *
 * **여기서 바로 답합니다.** 누르면 캘린더로 보내는 편이 코드는 쉬웠는데,
 * 그러면 두 번 움직여야 합니다 — 이 목록이 없애려던 게 그 두 번입니다.
 * 컨트롤은 일정 카드와 같은 것(RsvpPicker)이라 두 화면이 어긋날 수 없습니다.
 */
function usePendingInvites() {
  const events = useGCalStore(s => s.events)
  const calendars = useGCalStore(s => s.calendars)
  // 내 주소로 판단하므로, 내 주소가 바뀌면(로그인) 다시 셉니다.
  const myEmail = useAuthStore(s => s.email)
  return useMemo(() => {
    const today = fmtYMD(new Date())
    // 내가 초대받은 회의는 내 캘린더와 구독한 동료 캘린더 양쪽에 같은 id로
    // 있습니다. 한 번만 세고, 내 캘린더 사본을 남깁니다.
    const own = calendars.filter(c => c.accessRole === 'owner').map(c => c.id)
    return onePerEvent(events, own)
      // 지난 초대는 답해도 소용이 없습니다.
      .filter(ev => ev.start >= today && awaitingMe(ev))
      .sort((a, b) => (a.startIso ?? a.start).localeCompare(b.startIso ?? b.start))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, calendars, myEmail])
}

function InviteSection() {
  const invites = usePendingInvites()
  const respond = useGCalStore(s => s.respond)
  if (!invites.length) return null

  return (
    <>
      <SectionHead right={<span style={{ opacity: .7 }}>{invites.length}</span>}>캘린더 초대</SectionHead>
      {invites.map(ev => (
        <div key={ev.id} style={{ padding: '6px 8px 8px 10px', margin: '0 4px' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ color: '#2383E2', flexShrink: 0, marginTop: 2, display: 'flex' }}>
              <Icon name="today" size={12} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13.5, color: 'var(--sb-t1)', fontWeight: 600,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{ev.summary || '(제목 없음)'}</div>
              <div style={{
                fontSize: 12, color: 'var(--sb-t3)', marginTop: 1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {inviteWhen(ev)}
                {organizerOf(ev) ? ` · ${organizerOf(ev)}` : ''}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 5, marginLeft: 20 }}>
            <RsvpPicker
              compact
              current={myAttendance(ev)?.responseStatus ?? 'needsAction'}
              onRespond={r => { void respond(ev.id, r) }}
            />
          </div>
        </div>
      ))}
    </>
  )
}

/** '8월 25일 (월) 14:00' — 240px에 들어가는 만큼만. */
function inviteWhen(ev: { start: string; startTime?: string; allDay: boolean }): string {
  const d = new Date(ev.start + 'T00:00:00')
  const day = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
  const date = `${d.getMonth() + 1}월 ${d.getDate()}일 (${day})`
  return ev.allDay || !ev.startTime ? `${date} 종일` : `${date} ${ev.startTime}`
}

/** 부른 사람. 참석자 목록에 organizer로 표시돼 있습니다. */
function organizerOf(ev: { attendees?: { email: string; organizer?: boolean }[] }): string {
  const host = ev.attendees?.find(a => a.organizer)
  if (!host) return ''
  return useUserProfileStore.getState().getNameByEmail(host.email)
}
