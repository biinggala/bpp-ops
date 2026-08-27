import { useEffect, useMemo, useRef } from 'react'
import { useGCalStore } from '../store/gcalStore'

/**
 * ── 부르는 사람의 달력을 잠깐 겹쳐 봅니다 ────────────────────────────────────
 *
 * 회의를 잡으며 사람을 넣는 순간 알고 싶은 건 하나입니다 — **그 시간에 비었나.**
 * 그 답이 손이 있는 자리에 있어야 합니다. 창을 닫고 캘린더 메뉴를 열어 '같이 볼
 * 사람'을 켜고 돌아오는 네 걸음이 지나면, 원래 무엇을 물으려 했는지도 잊습니다.
 *
 * '같이 볼 사람'(`peeking`)과 **다릅니다.** 저쪽은 내가 켜 둔 것이라 끌 때까지
 * 남고, 이쪽은 열려 있는 화면에 붙어서 닫으면 사라집니다. 둘을 한 목록으로
 * 만들면 회의 하나 잡을 때마다 켜 둔 사람이 하나씩 늘고, 한 달 뒤 내 달력은
 * 남의 일정으로 덮여 있습니다.
 *
 * 이걸 쓰는 화면이 둘입니다(타임라인 카드, 업무의 일정 패널). 그래서 훅으로
 * 둡니다 — 같은 일을 하는 코드가 둘이면 둘 중 하나는 언젠가 뒤처집니다.
 */
export function usePeekPreview(emails: string[], from: string, to: string, active = true) {
  const setPreview = useGCalStore(s => s.setPreview)
  const list = useMemo(
    () => (active ? [...new Set(emails.map(e => e.toLowerCase().trim()).filter(Boolean))] : []),
    [emails, active],
  )
  const key = list.join(' ')
  /** 내가 세워 둔 목록. 걷을 때 남의 것인지 가리는 데 씁니다. */
  const mine = useRef<string[]>([])

  useEffect(() => {
    mine.current = key ? key.split(' ') : []
    setPreview(mine.current, from, to)
    // key가 곧 list입니다 — 배열을 그대로 걸면 렌더마다 새 배열이라 매번 돕니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, from, to, setPreview])

  useEffect(() => () => {
    /*
      **내가 세워 둔 것만 걷습니다.**

      두 화면이 같은 자리를 씁니다. 업무 창을 닫을 때 무조건 비우면, 그 뒤에
      아직 열려 있는 타임라인 카드의 사람들까지 같이 사라집니다 — 그쪽에서는
      아무것도 안 했는데 회색 블록이 조용히 없어지는 일이고, 조용히 사라지는
      것은 고장으로 보입니다.
    */
    const store = useGCalStore.getState()
    const now = store.preview
    const same = now.length === mine.current.length && now.every(e => mine.current.includes(e))
    if (same && now.length) store.setPreview([])
  }, [])
}
