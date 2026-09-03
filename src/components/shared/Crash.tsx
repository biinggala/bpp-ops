import React from 'react'
import { copyText } from '../../lib/utils'

/**
 * ── 깨졌을 때 ────────────────────────────────────────────────────────────────
 *
 * 리액트는 렌더 중에 예외가 나면 그 화면을 통째로 지웁니다. 그게 사용자에게는
 * **하얀 화면**입니다 — 무슨 일이 났는지, 뭘 하면 되는지, 심지어 앱이 죽은
 * 건지 인터넷이 끊긴 건지도 알 수 없습니다.
 *
 * 그래서 두 가지를 합니다.
 *
 * **다음에 할 일을 줍니다.** 대부분의 깨짐은 새로 열면 지나갑니다. 그 버튼이
 * 첫 번째로 있어야 합니다.
 *
 * **무엇이 났는지 적어 둡니다.** 개발자에게 "앱이 깨졌어요"는 아무것도
 * 아니지만 한 줄짜리 오류 메시지는 거의 전부입니다. 접어 두고, 누르면 펴지고,
 * 복사 버튼이 있습니다 — 스크린샷을 찍어 옮겨 적는 일이 없어야 합니다.
 */

interface State { error: Error | null }

export class Crash extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 콘솔에도 남깁니다. 화면의 접힌 칸은 요약이고, 스택 전체는 여기 있습니다.
    console.error('[crash]', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <CrashScreen error={this.state.error} onRetry={() => this.setState({ error: null })} />
  }
}

function CrashScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const detail = `${error.name}: ${error.message}\n${error.stack ?? ''}`

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16,
      padding: 32, background: 'var(--bg)', textAlign: 'center',
    }}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--t1)', marginBottom: 7 }}>
          화면을 그리다 멈췄습니다
        </div>
        <div style={{ fontSize: 13, color: 'var(--t3)', lineHeight: 1.7, maxWidth: 340 }}>
          적어 둔 것은 그대로 있습니다. 새로 열면 대부분 지나갑니다.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => window.location.reload()}
          style={{
            height: 32, padding: '0 16px', borderRadius: 'var(--r2)', border: 'none',
            background: 'var(--ac)', color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'var(--font)',
          }}
        >
          새로 열기
        </button>
        {/* 되돌아가 보는 것도 한 번은 해 볼 만합니다 — 방금 누른 것만 문제였다면
            새로고침 없이 이어서 쓸 수 있습니다. */}
        <button
          onClick={onRetry}
          style={{
            height: 32, padding: '0 14px', borderRadius: 'var(--r2)',
            border: '1px solid var(--bd)', background: 'transparent',
            color: 'var(--t2)', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font)',
          }}
        >
          다시 시도
        </button>
      </div>

      <div style={{ maxWidth: 520, width: '100%' }}>
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            border: 'none', background: 'transparent', color: 'var(--t3)',
            fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)', padding: 4,
          }}
        >
          {open ? '오류 내용 접기' : '오류 내용 보기'}
        </button>
        {open && (
          <div style={{ marginTop: 6 }}>
            <pre style={{
              textAlign: 'left', fontSize: 11, lineHeight: 1.6,
              color: 'var(--t2)', background: 'var(--bg2)',
              border: '1px solid var(--bd)', borderRadius: 'var(--r2)',
              padding: 12, maxHeight: 220, overflow: 'auto',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'text',
            }}>{detail}</pre>
            <button
              onClick={() => {
                void copyText(detail).then(ok => { if (ok) setCopied(true) })
              }}
              style={{
                marginTop: 6, height: 26, padding: '0 10px', borderRadius: 'var(--r1)',
                border: '1px solid var(--bd)', background: 'transparent',
                color: 'var(--t2)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)',
              }}
            >
              {copied ? '복사했습니다' : '오류 내용 복사'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
