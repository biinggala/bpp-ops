import React, { useEffect, useMemo, useState } from 'react'
import { setTheme, themeChoice, type ThemeChoice } from '../../lib/theme'
import { haptic } from '../../lib/haptics'
import { useMobile } from '../../hooks/useMobile'
import { useAuthStore } from '../../store/authStore'
import { disablePush, enablePush, pushEnabledHere, pushSupport, showLocalNotice } from '../../lib/push'
import { chimeEnabled, playChime, setChimeEnabled } from '../../lib/chime'
import { fileWatchEnabled, setFileWatchEnabled } from '../../lib/driveWatch'
import { useDriveStore } from '../../store/driveStore'
import { useMailStore } from '../../store/mailStore'
import { PUBLIC_DOMAINS, useOrgStore, pendingJoinCount } from '../../store/orgStore'
import { useProjectStore } from '../../store/projectStore'
import { GetDesktopApp } from '../shared/GetDesktopApp'
import { MCP_CONNECTOR_URL } from '../../lib/server'
import { usePrefsStore } from '../../store/prefsStore'
import { LATEST } from '../../lib/whatsNew'
import { askConfirm } from '../shared/Confirm'
import { showTestNotice } from '../layout/NoticeToast'
import { Icon, type IconName } from '../shared/Icon'
import { useShallow } from 'zustand/react/shallow'

/**
 * ── 설정 ─────────────────────────────────────────────────────────────────────
 *
 * Everything here belongs to *this machine*, not to the team. Fifty people share
 * the projects; nobody shares a screen, or the room it is in, or the pocket the
 * phone is in — so none of this goes near the database. It is the same line the
 * sidebar's ordering follows.
 *
 * The notification switches used to live in the bell's popover, which put
 * settings inside an inbox: you went there to clear notices and found a control
 * panel at the top of the list. The bell is now only the list.
 */

const THEMES: { value: ThemeChoice; label: string; icon: IconName }[] = [
  { value: 'light', label: '밝게', icon: 'sun' },
  { value: 'dark', label: '어둡게', icon: 'moon' },
  { value: 'system', label: '시스템', icon: 'monitor' },
]

/**
 * ── 설정 ─────────────────────────────────────────────────────────────────────
 *
 * 왼쪽에 항목, 오른쪽에 그 항목만. 한 장에 다 쌓아 두었더니 화면 밝기부터
 * 조직 프로젝트까지 여섯 덩어리가 한 줄로 늘어서서, 뭘 고치러 왔든 스크롤을
 * 먼저 해야 했습니다. **한 번에 한 가지만 보이면 그 한 가지가 짧습니다.**
 *
 * 나뉜 기준은 **누구의 것인가**입니다. 앞의 세 장(일반·알림·연동)은 이 기기와
 * 내 계정의 것이고, 뒤의 세 장(조직·회의실·프로젝트)은 회사가 함께 쓰는
 * 것입니다. 같은 창에 있으면서 하나는 나만의 것이고 하나는 전원의 것이면,
 * 모르고 고치는 사람이 나옵니다 — 그래서 줄로 갈라 놓았습니다.
 *
 * 폰에서는 왼쪽 대신 위에 가로로 놓습니다. 390pt에서 세로 목록에 132px을
 * 내주면 본문이 250px가 되고, 그건 설정 한 줄이 안 들어가는 폭입니다.
 */

type Page = 'general' | 'notify' | 'link' | 'org' | 'rooms' | 'projects'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const isMobile = useMobile()
  const [page, setPage] = useState<Page>('general')
  const email = useAuthStore(s => s.email)
  const orgId = useOrgStore(s => s.orgId)
  const joinRequests = useOrgStore(s => s.joinRequests)
  const myProjects = useProjectStore(s => s.projects)
  const pending = useMemo(
    () => pendingJoinCount(joinRequests, new Set(myProjects.map(p => p.id))),
    [joinRequests, myProjects],
  )

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  /** 조직이 없으면 조직 장 하나만 보입니다 — 만들기 전에는 방도 목록도 없습니다. */
  const pages: { id: Page; label: string; badge?: number }[] = [
    { id: 'general', label: '일반' },
    { id: 'notify', label: '알림' },
    { id: 'link', label: '연동' },
    { id: 'org', label: '조직' },
    ...(orgId ? [
      { id: 'rooms' as Page, label: '회의실' },
      { id: 'projects' as Page, label: '프로젝트', badge: pending },
    ] : []),
  ]

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9600, background: 'rgba(15,15,15,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 12 : 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg)', borderRadius: 'var(--r3)', boxShadow: 'var(--sh-lg)',
          border: '1px solid var(--bd)', width: '100%', maxWidth: isMobile ? 520 : 640,
          height: isMobile ? '88vh' : 520, maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 18px 14px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
          <span style={{ color: 'var(--t2)', display: 'flex' }}><Icon name="settings" size={16} /></span>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)', flex: 1 }}>설정</div>
          <button
            onClick={onClose}
            style={{
              width: 24, height: 24, borderRadius: 'var(--r1)', border: 'none', background: 'transparent',
              color: 'var(--t3)', fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >✕</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: isMobile ? 'column' : 'row' }}>
          <div style={{
            flexShrink: 0,
            display: 'flex', flexDirection: isMobile ? 'row' : 'column', gap: 1,
            padding: isMobile ? '8px 10px' : '10px 8px',
            width: isMobile ? 'auto' : 140,
            borderRight: isMobile ? 'none' : '1px solid var(--bd)',
            borderBottom: isMobile ? '1px solid var(--bd)' : 'none',
            overflowX: isMobile ? 'auto' : 'visible',
          }}>
            {pages.map(p => (
              <PageTab
                key={p.id}
                label={p.label}
                badge={p.badge}
                on={page === p.id}
                wide={!isMobile}
                onClick={() => setPage(p.id)}
              />
            ))}
          </div>

          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '16px 18px 20px' }}>
            {page === 'general' && (
              <>
                <Section title="화면 밝기" note="이 기기에서만 적용됩니다. 다른 사람 화면은 바뀌지 않습니다.">
                  <ThemeChoiceRow />
                </Section>
                <Section title="안내" note="한 번 보고 닫으면 다시 안 뜹니다. 여기서 언제든 다시 열 수 있습니다.">
                  <ReplayRows onOpen={onClose} />
                </Section>
                {/* 이미 앱으로 보고 있는 사람과 폰에서는 스스로 사라집니다. */}
                <GetDesktopApp />
                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6, paddingTop: 12, borderTop: '1px solid var(--bd)', userSelect: 'text' }}>
                  빌드 {__BUILD_ID__}
                </div>
              </>
            )}

            {page === 'notify' && (
              <Section title="알림" note="켜 두는 것이 기본입니다. 기기마다 따로 정합니다 — 노트북에서 켠다고 폰이 켜지지는 않습니다.">
                <PushRow />
                <ChimeRow />
                <FileWatchRow />
              </Section>
            )}

            {page === 'link' && (
              <Section title="연동" note="받은 알림에 밖에서 온 소식을 들이는 통로입니다. 이 기기가 아니라 계정에 붙습니다.">
                <MailLinkRow />
                <ConnectorRow />
              </Section>
            )}

            {page === 'org' && <OrgSection />}
            {page === 'rooms' && <RoomsSection />}
            {page === 'projects' && <OrgProjects />}

            {!email && (
              <div style={{ fontSize: 12, color: 'var(--t3)' }}>로그인이 필요합니다</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function PageTab({ label, badge, on, wide, onClick }: {
  label: string
  badge?: number
  on: boolean
  wide: boolean
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        width: wide ? '100%' : 'auto', flexShrink: 0,
        padding: wide ? '6px 9px' : '5px 11px',
        borderRadius: 'var(--r1)', border: 'none', cursor: 'pointer',
        fontFamily: 'var(--font)', fontSize: 13, textAlign: 'left',
        fontWeight: on ? 600 : 400,
        color: on ? 'var(--t1)' : 'var(--t2)',
        background: on ? 'var(--bg3)' : hovered ? 'var(--bg2)' : 'transparent',
        whiteSpace: 'nowrap', transition: 'background .1s',
      }}
    >
      {label}
      {/* 승인을 기다리는 요청. 설정을 열지 않아도 알아야 하는 값이라 사이드바
          기어에도 같은 숫자가 붙습니다. */}
      {!!badge && (
        <span style={{
          marginLeft: 'auto', minWidth: 16, height: 16, padding: '0 4px',
          borderRadius: 8, background: 'var(--danger)', color: '#fff',
          fontSize: 10, fontWeight: 700, lineHeight: '16px', textAlign: 'center',
        }}>{badge > 99 ? '99+' : badge}</span>
      )}
    </button>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', marginBottom: note ? 3 : 10 }}>{title}</div>
      {note && <div style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.6, marginBottom: 10 }}>{note}</div>}
      {children}
    </div>
  )
}

/**
 * 소개와 업데이트 노트를 다시 여는 두 줄.
 *
 * 저장된 '봤음'은 건드리지 않습니다 — 다시 보겠다는 건 잊었다는 뜻이지
 * 안 봤다는 뜻이 아니고, 되돌려 놓으면 다음에 앱을 켤 때 또 뜹니다.
 * 그래서 이번 한 번만 여는 `replay`를 씁니다.
 *
 * 설정 창은 먼저 닫습니다. 판이 두 장 겹치면 소개를 닫았을 때 설정이 아직
 * 열려 있습니다.
 */
function ReplayRows({ onOpen }: { onOpen: () => void }) {
  const setReplay = usePrefsStore(s => s.setReplay)
  const open = (what: 'intro' | 'whatsNew') => { onOpen(); setReplay(what) }
  return (
    <>
      <ReplayRow title="처음 안내 다시 보기" sub="어디서 무엇을 하는지 네 장" onClick={() => open('intro')} />
      {LATEST && (
        <ReplayRow title="업데이트 노트" sub={`가장 최근: ${LATEST.date}`} onClick={() => open('whatsNew')} />
      )}
    </>
  )
}

function ReplayRow({ title, sub, onClick }: { title: string; sub: string; onClick: () => void }) {
  return (
    <div style={ROW}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--t1)' }}>
        {title}
        <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{sub}</span>
      </span>
      <button
        onClick={onClick}
        style={{
          flexShrink: 0, height: 26, padding: '0 10px', borderRadius: 'var(--r1)',
          border: '1px solid var(--bd)', background: 'transparent',
          fontSize: 12, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)',
        }}
      >
        열기
      </button>
    </div>
  )
}

function ThemeChoiceRow() {
  const [choice, setChoice] = useState<ThemeChoice>(() => themeChoice())
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {THEMES.map(t => {
        const on = choice === t.value
        return (
          <button
            key={t.value}
            onClick={() => { setTheme(t.value); setChoice(t.value); haptic('tap') }}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              padding: '12px 6px 10px', borderRadius: 'var(--r2)', cursor: 'pointer',
              fontFamily: 'var(--font)', fontSize: 12, fontWeight: on ? 600 : 400,
              border: `1px solid ${on ? 'var(--ac)' : 'var(--bd)'}`,
              background: on ? 'var(--ac-l)' : 'transparent',
              color: on ? 'var(--ac)' : 'var(--t2)',
              transition: 'background .1s, color .1s, border-color .1s',
            }}
            onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'var(--bg3)' }}
            onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}
          >
            <Icon name={t.icon} size={19} />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

/** The switch used by both notification rows, so they cannot drift apart. */
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
  display: 'flex', alignItems: 'flex-start', gap: 10,
  padding: '10px 0', borderTop: '1px solid var(--bd)',
}

/**
 * 이 기기에서 푸시 받기.
 *
 * A subscription belongs to one browser on one machine, so this is per-device by
 * nature. It is on wherever it can be — see `autoEnablePush` — and this switch
 * exists for the one device that has not been asked yet, and for turning it off.
 *
 * When it *cannot* work, the reason is written out rather than left as a dead
 * switch: an iPhone that has not been added to the home screen and a desktop
 * shell with no Push API fail for completely different reasons, and 'off' says
 * neither of them.
 */
function PushRow() {
  const isMobile = useMobile()
  const [on, setOn] = useState(pushEnabledHere())
  const [busy, setBusy] = useState(false)
  /** 결과 한 줄. `bad`가 참일 때만 빨갛습니다 — 정상을 빨갛게 칠하지 않습니다. */
  const [error, setError] = useState<{ bad: boolean; text: string } | null>(null)
  const me = useAuthStore(s => s.displayName || s.email?.split('@')[0] || '나')
  const support = pushSupport()

  /**
   * 한 번 눌러 두 가지를 확인합니다 — 따로 실패하기 때문입니다.
   *
   * 배너는 앱이 직접 그립니다. 기기 알림(OS 알림)은 알림 권한과 살아 있는
   * 서비스 워커가 필요하고, 데스크톱 셸에서는 아예 불가능합니다. '알림이 안
   * 와요'라는 말에 둘 중 무엇이 안 됐는지가 답이어야 합니다.
   *
   * **좌표를 안 씁니다.** 전에는 `배너 y=60 h=58 w=330`을 그대로 보여줬습니다.
   * 배너가 안 그려지던 버그를 잡을 때 필요했던 값인데, 그 버그가 끝난 뒤에도
   * 남아서 사용자에게 읽으라고 내밀고 있었습니다. 재기는 계속 하되(그려졌는지
   * 아닌지는 물어봐야 압니다) 말로 옮깁니다.
   *
   * 그리고 **데스크톱에서 기기 알림 실패는 빨간 글씨가 아닙니다.** 그건 이
   * 앱의 정상 상태고, 정상을 빨갛게 칠하면 빨간 글씨를 안 보게 됩니다.
   */
  const runTest = async () => {
    showTestNotice(me, !isMobile)
    const res = await showLocalNotice('테스트 알림', '이게 보이면 기기 알림도 정상입니다')

    await new Promise(r => setTimeout(r, 300))
    const drawn = !!document.querySelector('[data-notice-banner]')

    if (!drawn) {
      setError({ bad: true, text: '화면 배너가 안 떴습니다. 새로고침한 뒤 다시 눌러 주세요.' })
      return
    }
    if (res.ok) {
      setError({ bad: false, text: '배너와 기기 알림 모두 정상입니다.' })
      return
    }
    if (!support.ok) {
      // 데스크톱 앱에서는 배너가 곧 알림입니다. 위 줄이 이미 그렇게 말합니다.
      setError({ bad: false, text: '배너는 정상입니다. 기기 알림은 이 앱에서 원래 안 되고, 앱이 닫혀 있을 때는 폰으로 옵니다.' })
      return
    }
    setError({ bad: true, text: `배너는 떴고, 기기 알림이 실패했습니다 — ${res.reason}` })
  }

  const test = (
    <button
      onClick={() => void runTest()}
      style={{
        fontSize: 11, color: 'var(--ac)', background: 'transparent', border: 'none',
        cursor: 'pointer', fontFamily: 'var(--font)', padding: 0, flexShrink: 0, marginTop: 2,
      }}
    >테스트</button>
  )

  const detail = error && (
    <span style={{ display: 'block', fontSize: 11, marginTop: 3, lineHeight: 1.45, color: error.bad ? 'var(--danger)' : 'var(--t3)' }}>
      {error.text}
    </span>
  )

  // Offered even where push cannot work at all — in the desktop app the banner
  // *is* the notification, and this is the only way to see it without waiting
  // for a colleague to assign something.
  if (!support.ok) {
    return (
      <div style={ROW}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: 'var(--t3)', lineHeight: 1.55 }}>
          {support.reason}
          {detail}
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
      else setError({ bad: true, text: res.reason })
    }
    setBusy(false)
  }

  return (
    <div style={ROW}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--t1)' }}>
        이 기기에서 푸시 받기
        <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
          앱이 닫혀 있어도 알림이 옵니다
        </span>
        {detail}
      </span>
      {test}
      <MiniSwitch on={on} busy={busy} onClick={() => void toggle()} />
    </div>
  )
}

/**
 * ── Claude 커넥터 주소 ───────────────────────────────────────────────────────
 *
 * 앱 어디에도 안 적혀 있었습니다. 그래서 붙이려는 사람은 슬랙에 흘러다니는
 * 메시지나 저장소의 README에서 복사했고, 그중 하나가 **틀린 주소**였습니다 —
 * Cloud Run이 한 서비스에 주소를 두 형식으로 주는데 둘 중 로그인이 되는 건
 * 하나뿐입니다. 붙는 것 같다가 `redirect_uri_mismatch`로 막혔고, 화면의 어떤
 * 글자도 그게 주소 문제라고 말해 주지 않았습니다.
 *
 * 이제 앱 안에 있습니다. 복사하는 곳이 하나면 틀린 사본이 돌아다니지 않고,
 * 주소가 바뀌면 여기 한 줄만 고치면 모두가 새것을 복사합니다(lib/server.ts).
 */
function ConnectorRow() {
  const [copied, setCopied] = useState(false)
  return (
    <div style={ROW}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, color: 'var(--t1)' }}>Claude 커넥터</span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)', marginTop: 2, lineHeight: 1.6 }}>
          Claude 설정 › 커넥터에서 이 주소를 넣으면 대화 중에 업무를 읽고 만들 수 있습니다.
        </span>
        {/* 주소 자체를 보여 줍니다. 복사 버튼만 두면 무엇이 복사됐는지
            확인할 방법이 없고, 안 되는 날 물어볼 것도 없습니다. */}
        <span style={{
          display: 'block', marginTop: 6, padding: '5px 7px',
          borderRadius: 'var(--r1)', background: 'var(--bg2)',
          border: '1px solid var(--bd)', fontSize: 11, color: 'var(--t2)',
          wordBreak: 'break-all', userSelect: 'text',
        }}>
          {MCP_CONNECTOR_URL}
        </span>
      </span>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(MCP_CONNECTOR_URL)
            .then(() => setCopied(true))
            .catch(() => {})
        }}
        style={{
          flexShrink: 0, height: 26, padding: '0 10px', borderRadius: 'var(--r1)',
          border: '1px solid var(--bd)', background: 'transparent',
          fontSize: 12, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)',
        }}
      >
        {copied ? '복사했습니다' : '복사'}
      </button>
    </div>
  )
}

/**
 * 메일 연동 — 켜고 끄는 것만.
 *
 * 연결하는 버튼은 받은 알림 목록 안에도 있습니다. 처음 보는 사람은 거기서
 * 만나고, 끊으러 오는 사람은 여기로 옵니다 — 끊는 버튼을 목록에 두면 매일
 * 보는 자리에 매일 안 쓰는 버튼이 있게 됩니다.
 */
function MailLinkRow() {
  const wasConnected = useMailStore(s => s.wasConnected)
  const needsReconnect = useMailStore(s => s.needsReconnect)
  const connecting = useMailStore(s => s.connecting)
  const connect = useMailStore(s => s.connect)
  const disconnect = useMailStore(s => s.disconnect)
  const on = wasConnected && !needsReconnect

  return (
    <div style={ROW}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--t1)' }}>
        메일
        <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
          {on
            ? '나에게 물어 왔고 아직 답 안 한 대화만 가져옵니다'
            : '읽기 권한만 받습니다. 메일을 보내거나 지우지 않습니다.'}
        </span>
      </span>
      <MiniSwitch
        on={on}
        busy={connecting}
        onClick={() => { if (on) disconnect(); else void connect() }}
      />
    </div>
  )
}

/**
 * ── 첨부 파일이 바뀌었을 때 ─────────────────────────────────────────────────
 *
 * 드라이브가 연결돼 있을 때만 도는 것이라, 여기 스위치는 '한 번 더' 끄는
 * 자리입니다. 온종일 같이 고치는 문서 하나가 붙어 있으면 이 알림만 계속
 * 올라올 수 있고, 그때 끌 데가 있어야 합니다.
 *
 * 문구가 '이 기기에서 확인합니다'인 이유: 알림은 사람에게 남습니다. 폰에서
 * 꺼도 노트북이 켜져 있으면 알림은 옵니다 — 끄는 건 이 기기가 확인하는
 * 일이지 알림을 안 받는 게 아닙니다. 그걸 안 쓰면 거짓말이 됩니다.
 */
function FileWatchRow() {
  const [on, setOn] = useState(fileWatchEnabled())
  const connected = useDriveStore(s => !!s.token || s.wasConnected)
  return (
    <div style={ROW}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--t1)' }}>
        첨부 파일 변경 알림
        <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
          {connected
            ? '내 업무에 붙인 드라이브 파일을 이 기기에서 확인합니다'
            : '드라이브를 연동해야 확인할 수 있습니다'}
        </span>
      </span>
      <MiniSwitch on={on && connected} onClick={() => { const next = !on; setFileWatchEnabled(next); setOn(next) }} />
    </div>
  )
}

/**
 * 알림 소리 — 배너가 뜰 때만.
 *
 * A push that arrives with the app closed uses the phone's own notification
 * sound; nothing here reaches that, and no web app can choose it.
 */
function ChimeRow() {
  const [on, setOn] = useState(chimeEnabled())
  return (
    <div style={ROW}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--t1)' }}>
        알림 소리
        <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
          앱이 열려 있을 때 배너와 함께
        </span>
      </span>
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


/**
 * ── 조직과 회의실 ────────────────────────────────────────────────────────────
 *
 * 여기만 이 창에서 **다른 사람 화면에도 보이는** 설정입니다. 위의 것들은 다
 * 이 기기 것이고, 회의실 목록은 회사가 함께 쓰는 사실입니다. 그래서 칸을
 * 나누고 그렇다고 적어 둡니다 — 같은 창에 있으면서 하나는 나만의 것이고
 * 하나는 전원의 것이면, 모르고 고치는 사람이 나옵니다.
 *
 * 소속은 이메일 도메인입니다. 초대도 승인도 없습니다.
 */
/**
 * ── 조직 ─────────────────────────────────────────────────────────────────────
 *
 * 조직 자체와 관리자. 회의실은 옆 장으로 나갔습니다 — 한 장에 있으면 방 목록이
 * 길어질수록 관리자 목록이 스크롤 아래로 밀려서, 관리자가 누군지 보려면 방을
 * 다 지나가야 했습니다.
 */
function OrgSection() {
  const email = useAuthStore(s => s.email)
  const { orgId, name, domain, admins, ready, createOrg, createInviteOrg, setAdmin, error } = useOrgStore(useShallow(s => ({ orgId: s.orgId, name: s.name, domain: s.domain, admins: s.admins, ready: s.ready, createOrg: s.createOrg, createInviteOrg: s.createInviteOrg, setAdmin: s.setAdmin, error: s.error })))
  const [orgName, setOrgName] = useState('')
  const [adminMail, setAdminMail] = useState('')
  const [busy, setBusy] = useState(false)
  const myDomain = email?.split('@')[1] ?? ''

  if (!email) return null
  if (!ready) return <div style={{ fontSize: 12, color: 'var(--t3)' }}>불러오는 중…</div>

  if (!orgId) {
    /*
      만드는 방법이 둘입니다. 그리고 **나중에 못 바꿉니다** — 도메인은 한 번
      정해지면 그 조직의 벽이라, 뒤늦게 붙이거나 떼면 이미 들어와 있는 사람의
      소속이 통째로 흔들립니다. 그래서 고르는 자리에서 차이를 다 말해 줍니다.

      회사 주소가 아닌 사람에게 도메인 쪽을 눌러 보게 두지 않습니다. 지메일로
      조직을 만들면 이 앱을 쓰는 **모든 지메일 사용자**가 한 조직이 되는데,
      그건 눌러 보고 알 일이 아닙니다.
    */
    const publicDomain = PUBLIC_DOMAINS.has(myDomain.toLowerCase())
    const card: React.CSSProperties = {
      flex: 1, minWidth: 0, textAlign: 'left', padding: '10px 12px',
      border: '1px solid var(--bd)', borderRadius: 'var(--r2)', background: 'transparent',
      cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3,
    }
    const make = async (fn: () => Promise<boolean>) => { setBusy(true); await fn(); setBusy(false) }

    return (
      <Section title="조직" note="회의실과 회사에 공개된 프로젝트 목록을 함께 두는 단위입니다. 만든 사람이 첫 관리자가 됩니다. 만드는 방법은 나중에 바꿀 수 없습니다.">
        <input value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="조직 이름 (예: 블랙페이퍼)" style={{ ...INPUT, marginBottom: 8 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => make(() => createOrg(orgName, email))}
            disabled={busy || !orgName.trim() || publicDomain}
            style={{ ...card, opacity: busy || !orgName.trim() || publicDomain ? .45 : 1, cursor: publicDomain ? 'not-allowed' : 'pointer' }}
          >
            <span style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 600 }}>회사 도메인으로</span>
            <span style={{ fontSize: 11, color: 'var(--t3)', wordBreak: 'keep-all' }}>
              {publicDomain
                ? `@${myDomain} 같은 개인 주소는 같은 회사를 뜻하지 않아서 쓸 수 없습니다.`
                : `@${myDomain} 로 로그인한 사람은 초대 없이 들어옵니다.`}
            </span>
          </button>
          <button
            onClick={() => make(() => createInviteOrg(orgName, email))}
            disabled={busy || !orgName.trim()}
            style={{ ...card, opacity: busy || !orgName.trim() ? .45 : 1 }}
          >
            <span style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 600 }}>초대로만</span>
            <span style={{ fontSize: 11, color: 'var(--t3)', wordBreak: 'keep-all' }}>
              도메인을 안 씁니다. 부른 사람만 들어옵니다. 개인 주소를 쓰는 팀이라면 이쪽입니다.
            </span>
          </button>
        </div>
        {busy && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>만드는 중…</div>}
        {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
      </Section>
    )
  }

  const isAdmin = admins.includes(email.toLowerCase())

  return (
    <>
      <Section title="조직" note={domain
        ? '같은 도메인으로 로그인한 사람이 곧 조직원입니다. 초대도 승인도 없습니다.'
        : '초대로만 들어오는 조직입니다. 프로젝트에 부르면 조직원이 됩니다.'}>
        <div style={ROW}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--t1)' }}>
            {name || myDomain}
            <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
              {domain ? `@${domain}` : '초대로만'}
            </span>
          </span>
        </div>
      </Section>

      {/*
        관리자가 아닌 사람에게도 **누가 관리자인지** 보여줍니다. 잠긴 버튼만
        있고 누구에게 말해야 하는지 없으면 그건 막다른 길입니다.
      */}
      <Section
        title="관리자"
        note={isAdmin
          ? `${domain ? `${domain} 주소만` : '조직원만'} 관리자가 될 수 있습니다. 회의실 목록에만 미치고, 업무나 프로젝트를 더 볼 수 있게 되지는 않습니다.`
          : '회의실을 바꿔야 하면 이분들에게 말하면 됩니다.'}
      >
        {admins.map(mail => (
          <div key={mail} style={ROW}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {mail}
              {mail === email.toLowerCase() && (
                <span style={{ fontSize: 11, color: 'var(--t3)', marginLeft: 6 }}>나</span>
              )}
            </span>
            {isAdmin && (
              <button
                onClick={() => void setAdmin(mail, false)}
                style={{ ...navBtn, padding: '3px 9px', fontSize: 11, borderColor: 'transparent', color: 'var(--danger)' }}
              >해제</button>
            )}
          </div>
        ))}
        {isAdmin && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input
              value={adminMail}
              onChange={e => setAdminMail(e.target.value)}
              onKeyDown={async e => {
                if (e.key !== 'Enter' || !adminMail.trim()) return
                if (await setAdmin(adminMail, true)) setAdminMail('')
              }}
              placeholder={`이메일 (@${domain})`}
              style={INPUT}
            />
            <button
              onClick={async () => { if (adminMail.trim() && await setAdmin(adminMail, true)) setAdminMail('') }}
              style={navBtn}
            >지정</button>
          </div>
        )}
        {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6, lineHeight: 1.5 }}>{error}</div>}
      </Section>
    </>
  )
}

/**
 * ── 회의실 ───────────────────────────────────────────────────────────────────
 *
 * 목록은 관리자만 바꿉니다. **예약은 전원입니다** — 잠글 곳은 목록이지 사용이
 * 아닙니다. 회의실을 쓰려고 관리자에게 부탁해야 한다면 이 기능은 없는 게
 * 낫습니다.
 */
function RoomsSection() {
  const email = useAuthStore(s => s.email)
  const { name, domain, rooms, admins, addRoom, updateRoom, removeRoom, error } = useOrgStore(useShallow(s => ({ name: s.name, domain: s.domain, rooms: s.rooms, admins: s.admins, addRoom: s.addRoom, updateRoom: s.updateRoom, removeRoom: s.removeRoom, error: s.error })))
  const [roomName, setRoomName] = useState('')
  if (!email) return null
  const isAdmin = admins.includes(email.toLowerCase())

  return (
    <Section
      title="회의실"
      note={isAdmin
        ? `${name || domain} 전체가 함께 보는 목록입니다. 여기서 고치면 모두의 화면이 바뀝니다. 예약은 전원이 할 수 있습니다.`
        : '목록은 관리자만 바꿉니다. 예약은 누구나 할 수 있습니다.'}
    >
      {rooms.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--t3)', padding: '2px 0 8px' }}>
          아직 등록된 회의실이 없습니다
        </div>
      )}
      {rooms.map(room => (
        <div key={room.id} style={{ ...ROW, opacity: room.active === false ? .5 : 1 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--t1)' }}>
            {room.name}
            {room.note && <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{room.note}</span>}
          </span>
          {isAdmin ? (
            <>
              {/* 끄기와 지우기는 다른 일입니다. 끄는 것은 '지금은 못 쓴다'(공사
                  중), 지우는 것은 '이런 방은 없다'(오타로 만든 것). 예약이
                  잡을 때의 방 이름을 들고 있으므로 지워도 지난 예약은 읽힙니다. */}
              <MiniSwitch on={room.active !== false} onClick={() => void updateRoom(room.id, { active: room.active === false })} />
              <button
                /* window.confirm은 안 씁니다 — 데스크톱 웹뷰에서 호스트가
                   대화상자를 안 그려주면 항상 false라, 아무도 못 본 확인창이
                   이미 거절돼 있습니다. docs/desktop-updates.md의 그 표. */
                onClick={async () => {
                  const ok = await askConfirm({
                    message: `'${room.name}'을 목록에서 지웁니다`,
                    detail: '지난 예약은 그대로 남습니다. 잠깐 못 쓰는 것이라면 지우지 말고 스위치를 끄세요.',
                    confirmLabel: '지우기',
                  })
                  if (ok) void removeRoom(room.id)
                }}
                aria-label={`${room.name} 지우기`}
                style={{
                  marginLeft: 4, width: 22, height: 22, flexShrink: 0, borderRadius: 'var(--r1)',
                  border: 'none', background: 'transparent', color: 'var(--t3)',
                  cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 13, lineHeight: 1,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--danger-l)'; e.currentTarget.style.color = 'var(--danger)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
              >×</button>
            </>
          ) : room.active === false && <span style={{ fontSize: 11, color: 'var(--t3)' }}>사용 안 함</span>}
        </div>
      ))}
      {isAdmin && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            value={roomName}
            onChange={e => setRoomName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && roomName.trim()) { void addRoom(roomName); setRoomName('') } }}
            placeholder="회의실 이름 (예: 대회의실)"
            style={INPUT}
          />
          <button onClick={() => { if (roomName.trim()) { void addRoom(roomName); setRoomName('') } }} style={navBtn}>추가</button>
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
    </Section>
  )
}

/**
 * ── 조직에 공개된 프로젝트 ───────────────────────────────────────────────────
 *
 * **경계가 아니라 라벨입니다.** 여기 이름이 올라와도 그 프로젝트의 업무는 안
 * 보입니다 — 접근은 계속 프로젝트 멤버십이 정합니다. 이 목록이 답하는 건
 * '우리 회사에 이런 프로젝트가 있고, 들어가려면 누구에게 말하면 되는가'
 * 하나입니다. 새로 들어온 사람이 아무것도 못 보는 문제는 그걸로 풀립니다.
 *
 * 올리고 내리는 것은 그 프로젝트 멤버가 사이드바에서 합니다(우클릭 →
 * 조직에 공개). 조직 관리자가 아닙니다 — 관리자에게 프로젝트 권한을 주지
 * 않기 위해서고, 남의 프로젝트를 끌어오는 일도 없어야 합니다.
 */
function OrgProjects() {
  const email = useAuthStore(s => s.email)
  const { orgId, orgProjects, joinRequests, requestJoin, clearJoinRequest, error } = useOrgStore(useShallow(s => ({ orgId: s.orgId, orgProjects: s.orgProjects, joinRequests: s.joinRequests, requestJoin: s.requestJoin, clearJoinRequest: s.clearJoinRequest, error: s.error })))
  const myProjects = useProjectStore(s => s.projects)
  const addMember = useProjectStore(s => s.addMember)
  const displayName = useAuthStore(s => s.displayName)
  const [busy, setBusy] = useState<string | null>(null)

  if (!orgId || !email) return null

  const mine = new Set(myProjects.map(p => p.id))
  const asked = new Set(
    joinRequests.filter(r => r.email === email.toLowerCase()).map(r => r.projectId),
  )

  return (
    <Section
      title="조직 프로젝트"
      note="이름만 공개됩니다. 업무 내용은 참여한 뒤에 보입니다 — 목록에 오르는 것과 들어가는 것은 다른 일입니다."
    >
      {orgProjects.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--t3)', padding: '2px 0 4px', lineHeight: 1.6 }}>
          공개된 프로젝트가 없습니다. 사이드바에서 프로젝트를 우클릭 → '조직에 공개'.
        </div>
      )}

      {orgProjects.map(project => {
        const joined = mine.has(project.id)
        // 이 프로젝트 멤버에게만 요청이 의미가 있습니다 — 승인할 사람이니까요.
        const requests = joined ? joinRequests.filter(r => r.projectId === project.id) : []
        return (
          <div key={project.id} style={{ padding: '2px 0' }}>
            <div style={ROW}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: project.color ?? 'var(--bd2)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {project.name}
                </span>
              </span>
              {joined ? (
                <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>참여 중</span>
              ) : asked.has(project.id) ? (
                <button
                  onClick={() => void clearJoinRequest(project.id, email)}
                  style={{ ...navBtn, padding: '3px 9px', fontSize: 11, borderColor: 'transparent', color: 'var(--t3)' }}
                >요청함 · 취소</button>
              ) : (
                <button
                  onClick={async () => {
                    setBusy(project.id)
                    await requestJoin(project.id, email, displayName ?? undefined)
                    setBusy(null)
                  }}
                  disabled={busy === project.id}
                  style={{ ...navBtn, padding: '3px 10px', fontSize: 11 }}
                >{busy === project.id ? '…' : '참여 요청'}</button>
              )}
            </div>

            {/*
              승인은 **초대장을 쓰는 것**입니다.

              이미 있는 초대 흐름을 그대로 씁니다 — 승인하면 그 사람의 초대함에
              초대가 놓이고, 그쪽 앱에 초대 창이 뜹니다. 참여 경로를 두 개 만들면
              하나는 언젠가 안 맞게 됩니다.
            */}
            {requests.map(r => (
              <div key={r.email} style={{ ...ROW, paddingLeft: 15, minHeight: 26 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name ? `${r.name} · ${r.email}` : r.email} 참여 요청
                </span>
                <button
                  onClick={async () => { addMember(project.id, r.email); await clearJoinRequest(project.id, r.email) }}
                  style={{ ...navBtn, padding: '2px 9px', fontSize: 11, borderColor: 'var(--ac)', color: 'var(--ac)' }}
                >승인</button>
                <button
                  onClick={() => void clearJoinRequest(project.id, r.email)}
                  style={{ ...navBtn, padding: '2px 8px', fontSize: 11, borderColor: 'transparent', color: 'var(--t3)' }}
                >거절</button>
              </div>
            ))}
          </div>
        )
      })}
      {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
    </Section>
  )
}

const INPUT: React.CSSProperties = {
  flex: 1, minWidth: 0, boxSizing: 'border-box',
  padding: '5px 8px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
  background: 'var(--bg2)', color: 'var(--t1)', fontSize: 12.5,
  outline: 'none', fontFamily: 'var(--font)',
}

const navBtn: React.CSSProperties = {
  padding: '5px 12px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
  background: 'transparent', color: 'var(--t2)', fontSize: 12,
  cursor: 'pointer', fontFamily: 'var(--font)', flexShrink: 0,
}
