import { useEffect, useState } from 'react'
import { watchDailyNote, peekDailyNote, editDailyNote } from './useDailyNote'
import { checksIn, setCheck, parseNoteRef } from '../lib/noteChecks'
import { useAuthStore } from '../store/authStore'

/**
 * ── 시간 축이 노트의 체크박스를 비춥니다 ────────────────────────────────────
 *
 * 업무 블록은 그 업무의 상태를 그대로 보여 줍니다. 체크박스 줄에서 온 블록은
 * 가리킬 업무가 없어서 **눌리지 않는 네모**였고, 시간까지 잡아 둔 일을 끝내도
 * 노트의 그 줄은 안 눌린 채였습니다. 둘이 같은 하나여야 합니다.
 *
 * 훅으로 못 하는 이유가 하나 있었습니다: 화면에 선 날짜가 하루일 수도
 * 이레일 수도 있고, 훅은 개수가 변하는 목록에 못 걸립니다. 그래서 구독을
 * 손으로 걸고 풉니다 — **캐시는 노트 훅과 같은 하나**라, 옆에 열려 있는
 * 편집기가 보는 그 글을 다시 내려받지 않습니다.
 */
export function useNoteChecks(dates: string[]) {
  const email = useAuthStore(s => s.email)
  // 날짜 배열은 매 렌더 새로 만들어집니다. 내용이 같으면 다시 걸지 않도록
  // 글자 하나로 눌러서 의존성으로 씁니다.
  const key = dates.join(',')
  const [checks, setChecks] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!email) { setChecks({}); return }
    const days = key ? key.split(',') : []
    if (!days.length) { setChecks({}); return }

    /**
     * **정말 바뀌었을 때만 새 값을 냅니다.**
     *
     * 노트는 글자를 칠 때마다 구독자에게 알립니다(저장은 미뤄도 화면은 먼저
     * 바뀌어야 하니까요). 여기서 매번 새 객체를 내놓으면 시간 축이 타자
     * 속도로 다시 그려집니다 — 옆에서 메모를 적는 동안 하루 격자가 계속
     * 다시 세워지는 것이고, 그건 이 화면에서 제일 무거운 일입니다.
     */
    const recompute = () => {
      const next: Record<string, boolean> = {}
      for (const date of days) {
        for (const [bid, done] of Object.entries(checksIn(peekDailyNote(email, date)))) {
          next[`${date}|${bid}`] = done
        }
      }
      setChecks(prev => {
        const keys = Object.keys(next)
        if (keys.length === Object.keys(prev).length && keys.every(k => prev[k] === next[k])) return prev
        return next
      })
    }

    const offs = days.map(date => watchDailyNote(email, date, recompute))
    recompute()
    return () => offs.forEach(off => off())
  }, [email, key])

  return checks
}

/**
 * 블록의 네모를 눌렀을 때.
 *
 * 돌려주는 값은 '정말 그 줄을 눌렀는가'입니다. 줄이 지워졌으면 false —
 * 부르는 쪽이 그걸 알아야 사람에게 말해 줄 수 있습니다. 못 찾은 것을 조용히
 * 성공으로 치면, 눌리지 않는 네모가 눌리는 척하는 것이 됩니다.
 */
export async function toggleNoteCheck(
  email: string | null, noteRef: string | undefined, checked: boolean,
): Promise<boolean> {
  const parsed = parseNoteRef(noteRef)
  if (!email || !parsed) return false
  return editDailyNote(email, parsed.date, html => setCheck(html, parsed.bid, checked))
}
