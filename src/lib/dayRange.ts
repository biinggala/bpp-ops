// 끌어서 고른 날짜 두 개를 **기간 하나로** 바꿉니다. 값만 받고 값만 돌려줍니다.
//
// 사람은 뒤로도 끕니다 — 15일을 누르고 12일까지 끌면 그건 12~15일이지
// 잘못된 입력이 아닙니다. 그리고 구글의 종일 일정은 **끝 날짜가 배타적**
// 이라(19일 하루짜리의 end는 20일), 화면이 말하는 마지막 날과 API에 적는
// 날이 하루 다릅니다. 그 하루가 어긋나면 출장이 하루 짧게 잡히고, 아무도
// 그걸 만든 자리에서는 못 알아챕니다.

/** 'YYYY-MM-DD' 두 개를 앞뒤 정렬해 돌려줍니다. 날 수는 양 끝을 포함합니다. */
export function dayRange(a: string, b: string): { from: string; to: string; days: number } {
  const [from, to] = a <= b ? [a, b] : [b, a]
  return { from, to, days: countDays(from, to) }
}

/** 양 끝을 포함한 날 수. 같은 날이면 1입니다. */
export function countDays(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  if (!Number.isFinite(ms)) return 1
  return Math.max(1, Math.round(ms / 86_400_000) + 1)
}

/**
 * 화면이 말하는 마지막 날 → 구글에 적는 끝 날짜(그다음 날).
 *
 * 시간대를 안 씁니다. 종일 일정의 날짜는 'YYYY-MM-DD' 글자이지 순간이
 * 아니라서, Date로 바꿔 하루를 더하면 한국 시각으로는 맞고 UTC로는 하루
 * 어긋나는 자리가 생깁니다.
 */
export function exclusiveEnd(lastDay: string): string {
  const [y, m, d] = lastDay.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + 1))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`
}

/** 두 날짜 사이(양 끝 포함)에 그 날이 드는가 — 칸을 칠할 때 씁니다. */
export function withinRange(day: string, from: string, to: string): boolean {
  return day >= from && day <= to
}

/**
 * from부터 to까지(양 끝 포함)의 날짜들.
 *
 * 여러 날에 걸친 종일 일정을 달력 칸마다 세울 때 씁니다. 예전에는 시작한
 * 날에만 세웠고(“일주일짜리가 모든 칸을 채운다”는 걱정), 그래서 사흘짜리
 * 출장이 첫날에만 보였습니다 — 둘째 날 화면에는 아무 일도 없는 것처럼요.
 * 종일 일정은 그 날들에 걸쳐 있다는 것이 곧 그 일정의 뜻입니다.
 *
 * `max`는 화면 보호입니다. 달력 한 판이 마흔두 칸이라 그보다 길게 펼칠
 * 이유가 없고, 잘못 만들어진 몇 해짜리 일정 하나가 목록을 삼키지 않습니다.
 */
export function daysBetween(from: string, to: string, max = 60): string[] {
  const out: string[] = []
  const [y, m, d] = from.split('-').map(Number)
  if (!y || !m || !d) return [from]
  const p = (n: number) => String(n).padStart(2, '0')
  const cur = new Date(Date.UTC(y, m - 1, d))
  for (let i = 0; i < max; i++) {
    const day = `${cur.getUTCFullYear()}-${p(cur.getUTCMonth() + 1)}-${p(cur.getUTCDate())}`
    out.push(day)
    if (day >= to) break
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

/** 날짜에 며칠을 더합니다. 시간대를 안 씁니다 — 종일 날짜는 글자입니다. */
export function plusDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return day
  const t = new Date(Date.UTC(y, m - 1, d + n))
  const p = (v: number) => String(v).padStart(2, '0')
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`
}
