import { useEffect, useState } from 'react'
import { useAuthStore } from '../../store/authStore'
import { useUiStore } from '../../store/uiStore'
import { CMD } from '../shared/Tip'
import { usePrefsStore } from '../../store/prefsStore'
import { useGCalStore } from '../../store/gcalStore'
import { useDriveStore } from '../../store/driveStore'
import { useMobile } from '../../hooks/useMobile'
import { haptic } from '../../lib/haptics'
import { Icon, type IconName } from '../shared/Icon'
import { RELEASES, LATEST } from '../../lib/whatsNew'

/**
 * ── 처음 온 사람과, 오랜만에 온 사람 ─────────────────────────────────────────
 *
 * 한 창이 두 가지 일을 합니다. 둘은 같은 질문에 답하기 때문입니다 —
 * "여기서 뭘 하면 되지."
 *
 * **소개**는 처음 들어온 사람에게 한 번. 기능 목록이 아니라 **어디서 무엇을
 * 하는가** 네 장입니다. 처음 온 사람에게 '드래그로 일정 만들기'를 알려 주는
 * 건 이르고, 알아도 갈 곳을 모르면 못 씁니다.
 *
 * **업데이트 노트**는 이미 쓰던 사람에게, 방식이 달라졌을 때만. 처음 온
 * 사람에게는 안 뜹니다 — 써 본 적 없는 것이 '달라졌다'고 하면 그건 소개도
 * 소식도 아닙니다. 그래서 소개를 마치는 순간 최신 노트까지 읽은 것으로
 * 표시합니다.
 *
 * 둘 다 계정에 붙습니다(prefsStore). 노트북에서 읽은 걸 폰에서 또 읽으라고
 * 하면 그건 안내가 아니라 방해입니다.
 */

// ── 소개: 진짜 화면을 가리킵니다 ──────────────────────────────────────────────

interface Step {
  /** 사이드바·툴바에 붙여 둔 data-tour 이름. 없으면 화면 가운데에 섭니다. */
  tour?: string
  /**
   * 이 장에 들어설 때 **실제로 그 화면을 틉니다.**
   *
   * 줄만 밝히고 뒤에는 딴 화면이 있으면, 가리키기만 하고 보여주지는 않는
   * 설명입니다 — "캘린더는 여기입니다" 하는데 뒤에 오늘 노트가 깔려 있으면
   * 캘린더가 어떻게 생겼는지는 여전히 모릅니다.
   */
  enter?: () => void
  eyebrow: string
  title: string
  body: string
  /** 마지막 장. 여기서 실제로 연결까지 끝냅니다. */
  connect?: boolean
}

/**
 * 그림이 아니라 **그 자리**를 가리킵니다.
 *
 * 처음엔 아이콘 하나와 설명 문단으로 만들었는데, 그건 코끼리를 본 적 없는
 * 사람에게 "이게 다리고 이게 코야" 하고 코끼리를 그려 보라는 것과 같습니다.
 * 읽고 나서도 어디를 눌러야 하는지는 여전히 모릅니다.
 *
 * 그래서 화면을 어둡게 덮고 **진짜 그 줄만 밝혀 둡니다.** 설명은 그 옆에
 * 붙습니다. 소개가 끝나면 방금 본 그 자리가 그대로 거기 있습니다 — 옮겨
 * 적을 것이 없습니다.
 */
const STEPS: Step[] = [
  {
    tour: 'today',
    enter: () => useUiStore.getState().setScreen('today'),
    eyebrow: '아침에 여는 곳',
    title: '오늘',
    body: '날짜 하나에 노트 한 장입니다. 왼쪽에 오늘 봐야 할 업무가 서 있고, 끌어다 놓으면 오늘 할 일이 됩니다. 오른쪽에는 오늘의 일정이 있습니다.',
  },
  {
    tour: 'calendar',
    enter: () => useUiStore.getState().openCalendar(),
    eyebrow: '내 일정 전부',
    title: '캘린더',
    body: '구글 캘린더 일정과 업무 마감이 한 화면에 놓입니다. 빈 시간을 끌면 그 자리에 일정이 만들어지고, 회의실도 같이 잡을 수 있습니다.',
  },
  {
    tour: 'mine',
    enter: () => {
      const ui = useUiStore.getState()
      ui.setPersonalOnly(false); ui.setProject(null); ui.setMyTasksOnly(true)
    },
    eyebrow: '일이 사는 곳',
    title: '내 할 일, 그리고 아래 프로젝트들',
    body: '내 할 일은 나에게 온 것 전부, 그 아래는 그 일이 속한 프로젝트입니다. 같은 업무를 리스트·캘린더·간트 어느 쪽으로 봐도 됩니다 — 보는 방법이 다를 뿐 같은 목록입니다.',
  },
  {
    tour: 'inbox',
    enter: () => useUiStore.getState().setSidebarPane('inbox'),
    eyebrow: '나를 부르는 것들',
    title: '받은 알림',
    body: '나에게 배정된 업무, 멘션, 구글 캘린더 초대가 여기 모입니다. 초대는 이 목록에서 바로 수락하거나 거절할 수 있습니다.',
  },
  {
    // 이 장만은 사이드바의 버튼이 아니라 **열린 창 자체**를 밝힙니다.
    // 여기서 보여줄 것은 누르는 자리가 아니라 열리는 것이니까요.
    tour: 'palette',
    enter: () => {
      const ui = useUiStore.getState()
      ui.setSidebarPane('home')
      ui.openCommandPalette()
    },
    eyebrow: '기억이 안 날 때',
    title: '검색',
    body: `사이드바의 돋보기, 또는 ${CMD}K. 업무·프로젝트·데일리 노트에 더해 붙여 둔 자료와 드라이브 파일까지 한 번에 찾습니다. 어디에 뒀는지 몰라도 이름 일부만 알면 됩니다.`,
  },
  {
    enter: () => useUiStore.getState().closeCommandPalette(),
    eyebrow: '한 번만 하면 됩니다',
    title: '구글 연결하기',
    body: '캘린더를 연결하면 일정이 보이고 회의실을 여기서 잡을 수 있습니다. 드라이브를 연결하면 문서를 업무에 붙이고 검색으로 찾을 수 있습니다.',
    connect: true,
  },
]

export function Welcome() {
  const email = useAuthStore(s => s.email)
  const { onboardedAt, seenVersion, ready, replay, setReplay, markOnboarded, markSeenVersion } = usePrefsStore()

  const needsIntro = ready && !onboardedAt
  const needsNews = ready && !!onboardedAt && !!LATEST && seenVersion !== LATEST.id

  const mode = replay ?? (needsIntro ? 'intro' : needsNews ? 'whatsNew' : null)
  if (!email || !mode) return null

  const close = () => {
    if (replay) { setReplay(null); return }
    if (mode === 'intro') {
      markOnboarded(email)
      // 처음 온 사람에게 '달라진 점'은 뜻이 없습니다. 소개를 마치는 순간
      // 최신 노트까지 읽은 것으로 둡니다.
      if (LATEST) markSeenVersion(email, LATEST.id)
    } else if (LATEST) {
      markSeenVersion(email, LATEST.id)
    }
  }

  return <Sheet mode={mode} onClose={close} />
}

function Sheet({ mode, onClose }: { mode: 'intro' | 'whatsNew'; onClose: () => void }) {
  const isMobile = useMobile()

  // 창이 떠 있는 동안은 Esc로 닫힙니다. 읽기 싫은 사람을 붙잡아 두지 않습니다.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  if (mode === 'intro') return <Tour onClose={onClose} isMobile={isMobile} />

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 300, backdropFilter: 'blur(3px)' }} />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed', zIndex: 301,
          ...(isMobile
            ? { inset: 0, borderRadius: 0 }
            : { top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 480, maxHeight: '82vh', borderRadius: 'var(--r4)' }),
          background: 'var(--bg)',
          boxShadow: '0 32px 80px rgba(0,0,0,.34), 0 0 0 1px var(--bd)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          paddingTop: isMobile ? 'env(safe-area-inset-top, 0px)' : 0,
          paddingBottom: isMobile ? 'env(safe-area-inset-bottom, 0px)' : 0,
        }}
      >
        <News onClose={onClose} />
      </div>
    </>
  )
}

// ── 투어 ──────────────────────────────────────────────────────────────────────

/** 밝힌 자리 둘레의 여백. 줄에 딱 붙으면 밝힌 게 아니라 잘라 낸 것처럼 보입니다. */
const HALO = 6
/** 설명 카드 폭. 사이드바(240 남짓) 옆에 놓여도 화면을 안 넘기는 크기. */
const CARD_W = 320

function findRect(tour: string | undefined): DOMRect | null {
  if (!tour) return null
  const el = document.querySelector(`[data-tour="${tour}"]`)
  return el ? el.getBoundingClientRect() : null
}

function Tour({ onClose, isMobile }: { onClose: () => void; isMobile: boolean }) {
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const sidebarHidden = useUiStore(s => s.sidebarHidden)
  const toggleSidebarHidden = useUiStore(s => s.toggleSidebarHidden)

  /**
   * 가리킬 것이 화면에 있어야 가리킬 수 있습니다.
   *
   * 사이드바를 접어 둔 사람에게는 밝힐 줄 자체가 없으므로 펴 놓고 시작합니다.
   *
   * **끝나도 다시 접지 않습니다.** 처음엔 원래대로 되돌렸는데, 그러면 방금
   * "여기가 오늘이고 여기가 캘린더입니다" 하고 보여준 열이 소개가 끝나는
   * 순간 사라집니다 — 배운 것을 곧바로 감추는 셈입니다. 이 앱의 기본 화면은
   * 사이드바가 펴져 있는 화면이고, 접는 건 ⌘\로 언제든 됩니다.
   */
  useEffect(() => {
    if (isMobile || !sidebarHidden) return
    toggleSidebarHidden()
    // 처음 한 번만. 투어 도중 사람이 직접 접었다면 그건 그 사람의 뜻입니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const current = STEPS[step]

  /**
   * 장에 들어서면 그 화면을 틉니다. 그리고 투어가 끝나면 투어가 열어 둔
   * 것들(검색 창, 받은 알림 열)을 치웁니다 — 소개가 남기고 간 창을 사람이
   * 닫아야 하면 그건 소개가 아니라 뒷정리입니다.
   */
  useEffect(() => { current.enter?.() }, [current])
  useEffect(() => () => {
    const ui = useUiStore.getState()
    ui.closeCommandPalette()
    ui.setSidebarPane('home')
  }, [])

  /**
   * 검색 장에서는 창이 열려 있고 그 안의 입력칸에 커서가 가 있습니다.
   * 그대로 두면 Enter 한 번에 첫 항목('새 업무 추가')이 실행돼서, 설명을
   * 읽던 사람 앞에 난데없이 업무 만들기 창이 뜹니다. 그 장 동안만 방향키와
   * Enter를 잡아 둡니다 — Esc는 통과시킵니다. 나가는 문은 늘 열려 있어야
   * 합니다.
   */
  useEffect(() => {
    if (current.tour !== 'palette') return
    const hold = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation()
      }
    }
    document.addEventListener('keydown', hold, true)
    return () => document.removeEventListener('keydown', hold, true)
  }, [current.tour])

  /**
   * 자리를 잽니다.
   *
   * 두 번 잽니다 — 지금 한 번, 그리고 다음 그림 뒤에 한 번. 사이드바를 방금
   * 펴 준 경우 첫 번째 측정은 아직 접혀 있던 화면의 값입니다.
   */
  useEffect(() => {
    const measure = () => setRect(findRect(current.tour))
    measure()
    const raf = requestAnimationFrame(measure)
    // enter()가 방금 연 것(검색 창, 받은 알림 열)은 다음 그림에도 아직
    // 자리를 못 잡았을 수 있습니다. 한 번 더 재 봅니다.
    const late = window.setTimeout(measure, 60)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf); clearTimeout(late)
      window.removeEventListener('resize', measure)
    }
  }, [current.tour, step, sidebarHidden])

  const last = step === STEPS.length - 1
  const next = () => { haptic('tap'); last ? onClose() : setStep(step + 1) }

  // 폰에는 사이드바가 서랍 안에 있어서 가리킬 자리가 없습니다. 거기서는
  // 밝히지 않고 화면 가운데에 두되, 설명은 그대로입니다.
  const spot = isMobile ? null : rect

  const card: React.CSSProperties = spot
    ? placeCard(spot)
    : { top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: Math.min(CARD_W, window.innerWidth - 32) }

  return (
    <>
      {/* 뒤를 못 누르게 막는 판. 밝힌 자리도 지금은 누르는 곳이 아닙니다 —
          투어 중에 눌러서 화면이 바뀌면 다음 장이 가리킬 곳이 사라집니다. */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 300 }} />

      {spot ? (
        <div style={{
          position: 'fixed', pointerEvents: 'none', zIndex: 301,
          left: spot.left - HALO, top: spot.top - HALO,
          width: spot.width + HALO * 2, height: spot.height + HALO * 2,
          borderRadius: 8,
          boxShadow: '0 0 0 9999px rgba(0,0,0,.58), 0 0 0 2px var(--ac)',
          transition: 'left .2s, top .2s, width .2s, height .2s',
        }} />
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.58)', zIndex: 301, pointerEvents: 'none' }} />
      )}

      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed', zIndex: 302, ...card,
          background: 'var(--bg)', borderRadius: 'var(--r3)',
          boxShadow: '0 24px 60px rgba(0,0,0,.34), 0 0 0 1px var(--bd)',
          padding: 18, boxSizing: 'border-box',
          maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ac)', letterSpacing: '.05em', marginBottom: 5 }}>
          {current.eyebrow}
        </div>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--t1)', marginBottom: 7, lineHeight: 1.35 }}>
          {current.title}
        </h2>
        <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.7 }}>
          {current.body}
        </p>

        {current.connect && <ConnectRow />}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{
              border: 'none', background: 'transparent', color: 'var(--t3)',
              fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)', padding: '4px 2px',
            }}
          >
            {/* 마지막 장에서까지 '건너뛰기'라고 하면 다 읽은 사람에게 안 읽은
                것처럼 말하는 셈입니다. */}
            {last ? '나중에' : '건너뛰기'}
          </button>

          <div style={{ margin: '0 auto', display: 'flex', gap: 5 }}>
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                aria-label={`${i + 1}번째`}
                style={{
                  width: i === step ? 16 : 5, height: 5, borderRadius: 999, padding: 0,
                  border: 'none', cursor: 'pointer',
                  background: i === step ? 'var(--ac)' : 'var(--bd2)',
                  transition: 'width .16s, background .16s',
                }}
              />
            ))}
          </div>

          <button
            onClick={next}
            style={{
              padding: '7px 14px', borderRadius: 'var(--r2)', border: 'none',
              background: 'var(--ac)', color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'var(--font)',
            }}
          >
            {last ? '시작하기' : '다음'}
          </button>
        </div>
      </div>
    </>
  )
}

/**
 * 밝힌 자리 **옆**에 붙입니다. 위나 아래가 아니라 옆인 이유는, 여기서
 * 가리키는 것들이 전부 왼쪽 열의 줄들이기 때문입니다 — 아래에 놓으면
 * 다음 장에서 가리킬 줄을 카드가 덮습니다.
 *
 * 오른쪽이 좁으면 왼쪽으로, 세로로는 그 줄 높이에 맞춰 두되 화면을
 * 넘지 않게 당깁니다.
 */
function placeCard(spot: DOMRect): React.CSSProperties {
  const M = 12
  const w = Math.min(CARD_W, window.innerWidth - M * 2)
  const rightRoom = window.innerWidth - spot.right - M * 2
  const left = rightRoom >= w
    ? spot.right + M
    : Math.max(M, spot.left - w - M)
  // 카드 높이를 모르므로 240쯤으로 보고 화면 안에 넣습니다. 넘치면 카드가
  // 제 안에서 스크롤합니다 — 재서 다시 놓으면 열릴 때 한 번 덜컹거립니다.
  const top = Math.max(M, Math.min(window.innerHeight - 240 - M, spot.top - 8))
  return { left, top, width: w }
}

/**
 * 마지막 장의 연결 버튼들.
 *
 * 여기서 누른 연결은 **이 기기의 것**입니다 — 토큰이 이 브라우저에 살기
 * 때문에 폰에서는 폰에서 한 번 더 눌러야 합니다. 그래서 '연결됨'을 소개를
 * 봤다는 표시와 묶지 않고, 설정에도 같은 버튼을 그대로 둡니다.
 */
function ConnectRow() {
  const cal = useGCalStore()
  const drive = useDriveStore()

  return (
    <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 300, marginLeft: 'auto', marginRight: 'auto' }}>
      <ConnectBtn
        label="구글 캘린더"
        done={!!cal.token}
        busy={cal.loading || cal.autoRefreshing}
        onClick={() => void cal.connect()}
      />
      <ConnectBtn
        label="구글 드라이브"
        done={!!drive.token}
        busy={drive.connecting}
        onClick={() => void drive.connect()}
      />
      <div style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.6, marginTop: 2 }}>
        나중에 설정에서도 할 수 있습니다. 기기마다 한 번씩 필요합니다.
      </div>
    </div>
  )
}

function ConnectBtn({ label, done, busy, onClick }: {
  label: string; done: boolean; busy: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={done ? undefined : onClick}
      disabled={done || busy}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 12px', borderRadius: 'var(--r2)',
        border: `1px solid ${done ? 'rgba(68,131,97,.35)' : 'var(--bd)'}`,
        background: done ? 'rgba(68,131,97,.08)' : 'var(--bg2)',
        color: done ? '#448361' : 'var(--t1)',
        fontSize: 13, fontFamily: 'var(--font)',
        cursor: done || busy ? 'default' : 'pointer',
        opacity: busy ? .6 : 1,
      }}
    >
      <span style={{
        width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: done ? '#448361' : 'var(--bd2)', color: '#fff', fontSize: 11,
      }}>
        {done ? '✓' : ''}
      </span>
      <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
      <span style={{ fontSize: 12, color: done ? '#448361' : 'var(--t3)' }}>
        {done ? '연결됨' : busy ? '연결 중…' : '연결'}
      </span>
    </button>
  )
}

// ── 업데이트 노트 ─────────────────────────────────────────────────────────────

function News({ onClose }: { onClose: () => void }) {
  // 여러 판을 건너뛴 사람도 있습니다. 최신 것을 펼쳐 두고, 지난 것들은
  // 목록 아래에 접어 둡니다 — 있는 줄은 알되 읽기를 강요하지 않습니다.
  const [showOld, setShowOld] = useState(false)
  const [latest, ...older] = RELEASES
  if (!latest) return null

  return (
    <>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '32px 28px 20px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ac)', letterSpacing: '.06em', marginBottom: 6 }}>
          업데이트 · {latest.date}
        </div>
        <h2 style={{ fontSize: 21, fontWeight: 700, color: 'var(--t1)', marginBottom: 8 }}>
          {latest.title}
        </h2>
        <p style={{ fontSize: 13.5, color: 'var(--t2)', lineHeight: 1.7, marginBottom: 22 }}>
          {latest.lead}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {latest.items.map(item => (
            <div key={item.title} style={{ display: 'flex', gap: 12 }}>
              <span style={{
                width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                background: 'var(--bg3)', color: 'var(--t2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name={item.icon} size={17} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', marginBottom: 3 }}>
                  {item.title}
                </div>
                <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.65 }}>
                  {item.body}
                </div>
              </div>
            </div>
          ))}
        </div>

        {older.length > 0 && (
          <div style={{ marginTop: 24, borderTop: '1px solid var(--bd)', paddingTop: 12 }}>
            <button
              onClick={() => setShowOld(v => !v)}
              style={{
                border: 'none', background: 'transparent', color: 'var(--t3)',
                fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)', padding: 0,
              }}
            >
              {showOld ? '지난 업데이트 접기' : `지난 업데이트 ${older.length}건 보기`}
            </button>
            {showOld && older.map(rel => (
              <div key={rel.id} style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4 }}>{rel.date}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', marginBottom: 6 }}>{rel.title}</div>
                {rel.items.map(item => (
                  <div key={item.title} style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.7 }}>
                    · {item.title}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid var(--bd)', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => { haptic('tap'); onClose() }}
          style={{
            padding: '8px 18px', borderRadius: 'var(--r2)', border: 'none',
            background: 'var(--ac)', color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'var(--font)',
          }}
        >
          확인
        </button>
      </div>
    </>
  )
}
