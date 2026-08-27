/**
 * ── 겹치는 것들을 층으로 ─────────────────────────────────────────────────────
 *
 * 한 회의실에 같은 시간이 둘 잡힐 수 있습니다. 규칙은 형제 줄을 훑을 수 없어서
 * 겹침을 막지 못하고(화면이 먼저 막지만 그 사이에 틈이 있습니다), 그러면
 * 현황판에서 하나가 다른 하나를 덮습니다 — **덮인 예약은 화면에 없는 것과
 * 같습니다.** 겹쳤다는 사실 자체가 제일 알려야 하는 것인데요.
 *
 * 그래서 위아래로 비켜 놓습니다. 층은 '앞의 것이 끝난 자리'에 다시 씁니다 —
 * 안 겹치는 하루는 층이 하나고 줄 높이도 그대로입니다.
 *
 * 끝과 시작이 같은 것은 겹침이 아닙니다. 2시에 끝나는 회의와 2시에 시작하는
 * 회의는 같은 방을 쓰고, 그게 회의실이 돌아가는 방식입니다.
 */
export interface Span {
  from: number
  to: number
}

export function assignLanes<T extends Span>(items: T[]): { item: T; lane: number; lanes: number }[] {
  const sorted = [...items].sort((a, b) => a.from - b.from || a.to - b.to)
  /** 층마다 '지금까지 찬 끝 시각'. */
  const ends: number[] = []
  const placed = sorted.map(item => {
    let lane = ends.findIndex(end => end <= item.from)
    if (lane < 0) { lane = ends.length; ends.push(item.to) }
    else ends[lane] = item.to
    return { item, lane }
  })
  const lanes = Math.max(1, ends.length)
  return placed.map(p => ({ ...p, lanes }))
}
