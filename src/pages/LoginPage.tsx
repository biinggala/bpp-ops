import { useAuthStore } from '../store/authStore'

export function LoginPage() {
  const { signIn, error } = useAuthStore()
  const hasPendingInvite = !!sessionStorage.getItem('pending_invite')

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(145deg, #f0f4ff 0%, #e8edf7 50%, #f0f0f5 100%)',
      padding: 24,
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: 24,
        padding: '52px 44px 44px',
        width: '100%',
        maxWidth: 420,
        boxShadow: '0 24px 80px rgba(0,0,0,.13), 0 4px 24px rgba(0,0,0,.06)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
        <div style={{ fontSize: 52, lineHeight: 1, marginBottom: 24, userSelect: 'none' }}>🎯</div>

        <div style={{ fontSize: 28, fontWeight: 700, color: '#1c1b18', marginBottom: 8, letterSpacing: '-.3px' }}>
          크린지 플로우
        </div>
        <div style={{ fontSize: 15, color: '#a8a29e', marginBottom: 40, lineHeight: 1.6, textAlign: 'center' }}>
          팀 업무 보드에 로그인하세요
        </div>

        {hasPendingInvite && (
          <div style={{
            width: '100%',
            marginBottom: 28,
            padding: '14px 18px',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 12,
            fontSize: 13,
            color: '#1d4ed8',
            lineHeight: 1.65,
            textAlign: 'center',
          }}>
            프로젝트 초대 링크로 접속하셨습니다.<br />
            로그인하면 자동으로 참여됩니다.
          </div>
        )}

        <button
          onClick={signIn}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: '15px 24px',
            borderRadius: 14,
            border: '1.5px solid rgba(0,0,0,.1)',
            background: '#ffffff',
            cursor: 'pointer',
            fontSize: 15,
            fontWeight: 600,
            color: '#3c4043',
            boxShadow: '0 2px 10px rgba(0,0,0,.08)',
            transition: 'box-shadow .15s, background .15s, transform .1s',
            fontFamily: 'var(--font)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,.13)'
            e.currentTarget.style.background = '#fafafa'
            e.currentTarget.style.transform = 'translateY(-1px)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,.08)'
            e.currentTarget.style.background = '#ffffff'
            e.currentTarget.style.transform = 'translateY(0)'
          }}
        >
          <svg width="22" height="22" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
          </svg>
          Google로 로그인
        </button>

        {error && (
          <div style={{ marginTop: 18, fontSize: 13, color: '#ef4444', textAlign: 'center', lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 36, fontSize: 12, color: '#d4d0cc', textAlign: 'center' }}>
          팀원 초대 시 프로젝트 초대 링크를 공유하세요
        </div>
      </div>
    </div>
  )
}
