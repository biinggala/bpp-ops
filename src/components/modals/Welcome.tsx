import { useEffect, useState } from 'react'
import { useAuthStore } from '../../store/authStore'
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

// ── 소개 네 장 ────────────────────────────────────────────────────────────────

interface Page {
  icon: IconName
  eyebrow: string
  title: string
  body: string
  /** 마지막 장에만. 여기서 실제로 연결까지 끝냅니다. */
  connect?: boolean
}

const PAGES: Page[] = [
  {
    icon: 'today',
    eyebrow: '아침에 여는 곳',
    title: '오늘',
    body: '날짜 하나에 노트 한 장입니다. 왼쪽에 오늘 봐야 할 업무가 서 있고, 끌어다 놓으면 오늘 할 일이 됩니다. 오른쪽에는 오늘의 일정이 있습니다.',
  },
  {
    icon: 'layers',
    eyebrow: '일이 사는 곳',
    title: '내 할 일 · 프로젝트',
    body: '내 할 일은 나에게 온 것 전부, 프로젝트는 그 일이 속한 곳입니다. 같은 업무를 리스트·캘린더·간트 어느 쪽으로 봐도 됩니다 — 보는 방법이 다를 뿐 같은 목록입니다.',
  },
  {
    icon: 'inbox',
    eyebrow: '나를 부르는 것들',
    title: '받은 알림',
    body: '나에게 배정된 업무, 멘션, 구글 캘린더 초대가 한곳에 모입니다. 캘린더 초대는 여기서 바로 수락하거나 거절할 수 있습니다.',
  },
  {
    icon: 'external',
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
  const [step, setStep] = useState(0)

  // 창이 떠 있는 동안은 Esc로 닫힙니다. 읽기 싫은 사람을 붙잡아 두지 않습니다.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

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
        {mode === 'intro'
          ? <Intro step={step} setStep={setStep} onClose={onClose} />
          : <News onClose={onClose} />}
      </div>
    </>
  )
}

// ── 소개 ──────────────────────────────────────────────────────────────────────

function Intro({ step, setStep, onClose }: { step: number; setStep: (n: number) => void; onClose: () => void }) {
  const page = PAGES[step]
  const last = step === PAGES.length - 1

  return (
    <>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '40px 32px 24px', textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, margin: '0 auto 20px', borderRadius: 16,
          background: 'var(--ac-l)', color: 'var(--ac)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name={page.icon} size={26} />
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', letterSpacing: '.06em', marginBottom: 6 }}>
          {page.eyebrow}
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--t1)', marginBottom: 10 }}>
          {page.title}
        </h2>
        <p style={{ fontSize: 14, color: 'var(--t2)', lineHeight: 1.7, maxWidth: 360, margin: '0 auto' }}>
          {page.body}
        </p>

        {page.connect && <ConnectRow />}
      </div>

      <div style={{
        flexShrink: 0, padding: '12px 16px', borderTop: '1px solid var(--bd)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <button
          onClick={onClose}
          style={{
            border: 'none', background: 'transparent', color: 'var(--t3)',
            fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font)', padding: '6px 4px',
          }}
        >
          {/* 마지막 장에서까지 '건너뛰기'라고 하면 다 읽은 사람에게 안 읽은
              것처럼 말하는 셈입니다. */}
          {last ? '나중에' : '건너뛰기'}
        </button>

        <div style={{ margin: '0 auto', display: 'flex', gap: 6 }}>
          {PAGES.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              aria-label={`${i + 1}번째`}
              style={{
                width: i === step ? 18 : 6, height: 6, borderRadius: 999, padding: 0,
                border: 'none', cursor: 'pointer',
                background: i === step ? 'var(--ac)' : 'var(--bd2)',
                transition: 'width .16s, background .16s',
              }}
            />
          ))}
        </div>

        <button
          onClick={() => { haptic('tap'); last ? onClose() : setStep(step + 1) }}
          style={{
            padding: '8px 16px', borderRadius: 'var(--r2)', border: 'none',
            background: 'var(--ac)', color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'var(--font)',
          }}
        >
          {last ? '시작하기' : '다음'}
        </button>
      </div>
    </>
  )
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
