import { useCallback, useEffect, useRef, useState } from 'react'
import { onValue, ref, set as fbSet } from 'firebase/database'
import { db } from '../lib/firebase'
import { P } from '../lib/paths'
import { useAuthStore } from '../store/authStore'

/**
 * ── 오늘 노트 ────────────────────────────────────────────────────────────────
 *
 * 하루치 노트를 읽고 씁니다. 하나의 날짜, 한 사람.
 *
 * 저장은 타이핑이 멎고 1.2초 뒤에 한 번. 글자마다 쓰면 한 문장에 스무 번
 * 쓰게 되고, 저장 버튼을 두면 안 누른 사람이 오늘 적은 걸 잃습니다.
 *
 * 구독은 계속 살아 있습니다. 데스크톱에서 적은 줄이 폰에서도 보여야 하니까요.
 * 다만 **내가 방금 쓴 값이 되돌아오는 것**은 무시합니다 — 그러지 않으면 커서가
 * 문장 앞으로 튑니다. 그래서 마지막으로 보낸 값을 기억해 두고 비교합니다.
 */
export function useDailyNote(date: string) {
  const email = useAuthStore(s => s.email)
  const [html, setHtml] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /** 내가 보낸 마지막 값. 이게 되돌아오면 화면을 건드리지 않습니다. */
  const mine = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!email) return
    setHtml(null)
    mine.current = null
    const node = ref(db, P.dailyNote(email, date))
    return onValue(node, snap => {
      const next = (snap.val()?.html as string | undefined) ?? ''
      if (next === mine.current) return
      setHtml(next)
    }, e => {
      console.warn('[dailyNote]', e)
      setHtml('')
    })
  }, [email, date])

  const save = useCallback((next: string) => {
    if (!email) return
    mine.current = next
    if (timer.current) clearTimeout(timer.current)
    setSaving(true)
    timer.current = setTimeout(() => {
      fbSet(ref(db, P.dailyNote(email, date)), { html: next, at: Date.now() })
        .catch(e => console.warn('[dailyNote save]', e))
        .finally(() => setSaving(false))
    }, 1200)
  }, [email, date])

  // 날짜를 넘기거나 화면을 떠날 때, 아직 안 나간 저장을 밀어 보냅니다.
  useEffect(() => () => {
    if (!timer.current) return
    clearTimeout(timer.current)
    if (email && mine.current !== null) {
      void fbSet(ref(db, P.dailyNote(email, date)), { html: mine.current, at: Date.now() })
    }
  }, [email, date])

  return { html, save, saving }
}
