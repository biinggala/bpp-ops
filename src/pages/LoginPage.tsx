import { useAuthStore } from '../store/authStore'

export function LoginPage() {
  const { signIn, error } = useAuthStore()
  const hasPendingInvite = !!sessionStorage.getItem('pending_invite')

  return (
    <div className="flex items-center justify-center h-full bg-[#f2f2f7]">
      <div className="bg-white/88 backdrop-blur-[40px] rounded-[24px] px-[40px] py-[48px] text-center shadow-[0_20px_60px_rgba(0,0,0,.12)] max-w-[360px] w-[90%]">
        <div className="text-[36px] mb-[12px]">🎯</div>
        <div className="text-[22px] font-bold text-gray-900 mb-1">크린지 프렌즈</div>
        <div className="text-[13px] text-gray-400 mb-[32px]">업무 보드에 로그인하세요</div>

        {hasPendingInvite && (
          <div style={{ marginBottom: 20, padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, fontSize: 13, color: '#1d4ed8', lineHeight: 1.5 }}>
            프로젝트 초대 링크로 접속하셨습니다.<br />
            로그인하면 자동으로 참여됩니다.
          </div>
        )}

        <button
          onClick={signIn}
          className="flex items-center gap-[10px] justify-center w-full px-[20px] py-[13px] rounded-[12px] border border-black/[.1] bg-white/90 cursor-pointer text-[14px] font-semibold text-gray-800 transition-all hover:shadow-md hover:bg-white"
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
          </svg>
          Google로 로그인
        </button>

        {error && (
          <div className="mt-[16px] text-[12px] text-red-500">{error}</div>
        )}
      </div>
    </div>
  )
}
