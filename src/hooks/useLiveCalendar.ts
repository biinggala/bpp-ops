import { useEffect } from 'react'
import { useGCalStore } from '../store/gcalStore'

/**
 * ── 남이 옮긴 일정이 내 화면에도 옮겨집니다 ─────────────────────────────────
 *
 * 구글 캘린더 쪽은 즉시입니다 — 일정을 옮기면 그 순간 구글에 반영되고,
 * 초대받은 사람의 구글 캘린더와 알림은 구글이 알아서 처리합니다. **우리
 * 화면만 늦었습니다.**
 *
 * 읽어 둔 일정에는 5분짜리 유효기간이 붙어 있고(STALE_MS), 그걸 다시 읽는
 * 계기는 '다른 기간으로 옮길 때'뿐이었습니다. 그래서 한 화면을 보고 앉아
 * 있으면 남이 방금 옮긴 회의가 몇 분이고 옛 자리에 그대로 있었습니다.
 * 새로고침해야 맞아지는 화면은 사람에게 '이 화면은 못 믿는다'를 가르칩니다.
 *
 * 세 가지 계기로 다시 읽습니다:
 *
 *   - 창으로 **돌아왔을 때** (탭 전환, 폰에서 앱 다시 열기). 그 순간이 바로
 *     '그동안 뭐가 바뀌었나'를 기대하는 순간입니다.
 *   - 보고 있는 동안 **1분마다**.
 *   - 화면이 안 보이는 동안에는 아무것도 안 합니다. 주머니 속의 폰이 구글에
 *     계속 묻고 있을 이유가 없습니다.
 *
 * **진짜 밀어 넣기(push)는 아닙니다.** 그러려면 구글의 watch 채널을 받을
 * 공개 주소와, 사람마다 채널을 걸고 이레마다 갱신하는 일이 필요합니다.
 * 1분이면 '실시간'으로 읽히고, 그 값에 비해 그 공사는 큽니다.
 *
 * 토큰이 없거나 만료됐으면 건너뜁니다. 뒤에서 도는 타이머가 재연동을
 * 끌고 오면, 사람이 아무것도 안 눌렀는데 구글 창이 뜨는 일이 생깁니다.
 */
const EVERY_MS = 60_000

export function useLiveCalendar(): void {
  useEffect(() => {
    const pull = (force: boolean) => {
      if (document.hidden) return
      const s = useGCalStore.getState()
      if (!s.token || !s.expiry || s.expiry < Date.now()) return
      if (!s.loadedFrom || !s.loadedTo || s.loading) return
      if (!force && Date.now() - s.fetchedAt < EVERY_MS) return
      void s.refreshEvents(true)
    }

    // 돌아왔을 때는 기다리지 않습니다 — 방금 바뀐 것을 보러 온 것입니다.
    const back = () => pull(true)
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    const timer = setInterval(() => pull(false), EVERY_MS)

    return () => {
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
      clearInterval(timer)
    }
  }, [])
}
