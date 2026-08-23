import React, { useEffect, useState } from 'react'
import { setTheme, themeChoice, type ThemeChoice } from '../../lib/theme'
import { haptic } from '../../lib/haptics'
import { useMobile } from '../../hooks/useMobile'
import { useAuthStore } from '../../store/authStore'
import { disablePush, enablePush, pushEnabledHere, pushSupport, showLocalNotice } from '../../lib/push'
import { chimeEnabled, playChime, setChimeEnabled } from '../../lib/chime'
import { fileWatchEnabled, setFileWatchEnabled } from '../../lib/driveWatch'
import { useDriveStore } from '../../store/driveStore'
import { useMailStore } from '../../store/mailStore'
import { useOrgStore } from '../../store/orgStore'
import { showTestNotice } from '../layout/NoticeToast'
import { Icon, type IconName } from '../shared/Icon'

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

export function SettingsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9600, background: 'rgba(15,15,15,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg)', borderRadius: 'var(--r3)', boxShadow: 'var(--sh-lg)',
          border: '1px solid var(--bd)', width: '100%', maxWidth: 440,
          maxHeight: '86vh', overflowY: 'auto',
          padding: '20px 22px 22px', boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
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

        <Section title="화면 밝기" note="이 기기에서만 적용됩니다. 다른 사람 화면은 바뀌지 않습니다.">
          <ThemeChoiceRow />
        </Section>

        <Section title="알림" note="켜 두는 것이 기본입니다. 기기마다 따로 정합니다 — 노트북에서 켠다고 폰이 켜지지는 않습니다.">
          <PushRow />
          <ChimeRow />
          <FileWatchRow />
        </Section>

        <Section title="연동" note="받은 알림에 밖에서 온 소식을 들이는 통로입니다. 이 기기가 아니라 계정에 붙습니다.">
          <MailLinkRow />
        </Section>

        <OrgSection />

        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 18, paddingTop: 12, borderTop: '1px solid var(--bd)', userSelect: 'text' }}>
          빌드 {__BUILD_ID__}
        </div>
      </div>
    </div>
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
  const [error, setError] = useState<string | null>(null)
  const me = useAuthStore(s => s.displayName || s.email?.split('@')[0] || '나')
  const support = pushSupport()

  /**
   * Two notifications from one press, because they can fail separately.
   *
   * The banner is drawn by the app and always works. The OS notification needs a
   * real notification permission and a live worker — and *not* a push — so when
   * it fails it says which of the two is broken, which is the question
   * 'permission denied' on its own never answered.
   */
  const runTest = async () => {
    showTestNotice(me, !isMobile)
    const res = await showLocalNotice('테스트 알림', '이게 보이면 폰 알림은 정상입니다')

    // Measured rather than assumed. Four wrong guesses about the bottom bar
    // ended with one screenshot of real numbers; 'it does not appear' is the
    // same kind of claim and deserves the same treatment.
    await new Promise(r => setTimeout(r, 300))
    const box = document.querySelector('[data-notice-banner]')?.getBoundingClientRect()
    const where = box
      ? `배너 y=${Math.round(box.top)} h=${Math.round(box.height)} w=${Math.round(box.width)}`
      : '배너 없음(DOM에 안 그려짐)'
    setError(`${where} · OS 알림 ${res.ok ? 'ok' : `실패 — ${res.reason}`}`)
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
    <span style={{ display: 'block', fontSize: 11, marginTop: 3, lineHeight: 1.45, color: error.includes('실패') ? 'var(--danger)' : 'var(--t3)' }}>
      {error}
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
      else setError(res.reason)
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
function OrgSection() {
  const email = useAuthStore(s => s.email)
  const { orgId, name, rooms, ready, createOrg, addRoom, updateRoom, error } = useOrgStore()
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const domain = email?.split('@')[1] ?? ''

  if (!email || !ready) return null

  if (!orgId) {
    return (
      <Section title="조직" note={`${domain} 로 로그인한 사람들이 함께 쓰는 회의실을 등록해 둘 수 있습니다. 만들면 같은 도메인 전원이 바로 씁니다 — 초대는 없습니다.`}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="조직 이름 (예: 블랙페이퍼)"
            style={INPUT}
          />
          <button
            onClick={async () => { setBusy(true); await createOrg(newName, email); setBusy(false) }}
            disabled={busy}
            style={{ ...navBtn, borderColor: 'var(--ac)', background: 'var(--ac)', color: '#fff', opacity: busy ? .6 : 1 }}
          >{busy ? '만드는 중…' : '만들기'}</button>
        </div>
        {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
      </Section>
    )
  }

  return (
    <Section title="회의실" note={`${name || domain} 전체가 함께 보는 목록입니다. 여기서 고치면 모두의 화면이 바뀝니다.`}>
      {rooms.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--t3)', padding: '2px 0 8px' }}>
          아직 등록된 회의실이 없습니다
        </div>
      )}
      {rooms.map(room => (
        <div key={room.id} style={{ ...ROW, opacity: room.active === false ? .5 : 1 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--t1)' }}>
            {room.name}
            {room.note && (
              <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{room.note}</span>
            )}
          </span>
          {/* 지우지 않고 끕니다 — 지나간 예약이 이름을 잃으면 안 됩니다. */}
          <MiniSwitch
            on={room.active !== false}
            onClick={() => void updateRoom(room.id, { active: room.active === false })}
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && newName.trim()) { void addRoom(newName); setNewName('') }
          }}
          placeholder="회의실 이름 (예: 대회의실)"
          style={INPUT}
        />
        <button
          onClick={() => { if (newName.trim()) { void addRoom(newName); setNewName('') } }}
          style={navBtn}
        >추가</button>
      </div>
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
