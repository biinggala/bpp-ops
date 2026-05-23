import { useUiStore } from '../../store/uiStore'
import { useSpaceStore } from '../../store/spaceStore'

export function EmptyState() {
  const { openTaskModal } = useUiStore()
  const { spaces } = useSpaceStore()
  const hasSpaces = spaces.length > 0

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 28,
      padding: 40,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 56, userSelect: 'none', lineHeight: 1 }}>📋</div>

      {!hasSpaces ? (
        <>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--t1)', marginBottom: 10 }}>
              시작해볼까요?
            </div>
            <div style={{ fontSize: 14, color: 'var(--t3)', lineHeight: 1.7, maxWidth: 340 }}>
              왼쪽 사이드바에서 <strong style={{ color: 'var(--t2)' }}>스페이스</strong>를 먼저 만들어보세요.<br />
              스페이스는 팀의 업무 카테고리입니다.
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Step n={1} label="사이드바 하단 '스페이스 추가' 클릭" />
            <Arrow />
            <Step n={2} label="스페이스 이름 입력" />
            <Arrow />
            <Step n={3} label="업무 추가로 시작" />
          </div>
        </>
      ) : (
        <>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--t1)', marginBottom: 10 }}>
              업무가 없어요
            </div>
            <div style={{ fontSize: 14, color: 'var(--t3)', lineHeight: 1.6 }}>
              첫 번째 업무를 추가해보세요
            </div>
          </div>

          <button
            onClick={() => openTaskModal()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '14px 32px',
              borderRadius: 14,
              background: 'var(--ac)',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(35,131,226,.35)',
              transition: 'transform .12s, box-shadow .12s',
              fontFamily: 'var(--font)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 8px 28px rgba(35,131,226,.4)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(35,131,226,.35)'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v10M1 6h10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            업무 추가
          </button>
        </>
      )}
    </div>
  )
}

function Step({ n, label }: { n: number; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        background: 'rgba(35,131,226,.1)', color: 'var(--ac)',
        fontSize: 14, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {n}
      </div>
      <div style={{ fontSize: 12, color: 'var(--t3)', maxWidth: 110, lineHeight: 1.5 }}>{label}</div>
    </div>
  )
}

function Arrow() {
  return (
    <div style={{ color: 'var(--bd2)', fontSize: 20, marginBottom: 20, flexShrink: 0 }}>→</div>
  )
}
