/**
 * ── 장비 ─────────────────────────────────────────────────────────────────────
 *
 * 회의실과 닮았지만 세 군데가 다릅니다.
 *
 *   1. **하루를 넘깁니다.** 촬영을 나가면 카메라는 금요일에 빌려 월요일에
 *      돌아옵니다. 회의실 예약이 날짜별로 나뉘어 있는 것과 달리, 장비 예약은
 *      한 덩어리로 대여일과 반납일을 들고 있어야 합니다.
 *   2. **시간을 안 정하는 예약이 있습니다.** '장기 예약'은 날짜만 정합니다 —
 *      며칠 며칠, 그 사이에 몇 시인지는 아무도 묻지 않습니다.
 *   3. **왜 쓰는지를 적습니다.** 회의실은 회의 제목이면 충분한데, 장비는
 *      나갔다 오는 물건이라 '무엇 때문에'와 '뭘 같이 가져갔는지'가 남아야
 *      합니다.
 *
 * 그런데 겹침을 보는 눈은 **하나여야 합니다.** 두 종류를 따로 재기 시작하면
 * '시간 예약과 장기 예약이 겹치는가'를 물을 자리가 없어집니다. 그래서 둘 다
 * 같은 모양으로 저장합니다 — 장기 예약은 대여일 00:00부터 반납일 24:00까지인
 * 시간 예약입니다. 그러면 겹침 검사는 한 줄이면 됩니다.
 */

/** 하루의 분. 자정부터 셉니다 — 타임라인·회의실과 같은 단위입니다. */
export const DAY = 1440

export interface GearRange {
  /** 대여일 'YYYY-MM-DD' */
  from: string
  /** 반납일 'YYYY-MM-DD'. 하루짜리면 대여일과 같습니다. */
  to: string
  /** 대여일의 시각(분). 장기 예약은 0. */
  fromMin: number
  /** 반납일의 시각(분). 장기 예약은 1440. */
  toMin: number
  /** 날짜만 정한 예약. 화면이 시각을 안 그리게 하는 표시입니다. */
  long?: boolean
}

export interface GearBooking extends GearRange {
  id: string
  gearId: string
  /** 잡을 때의 장비 이름. 장비를 지워도 지난 예약이 이름을 안 잃습니다. */
  gearName?: string
  by: string
  byName?: string
  /**
   * 같이 잡은 것들이 나눠 갖는 표.
   *
   * 촬영 한 번에 카메라·조명·삼각대가 같이 나갑니다. 저장은 장비마다 한
   * 줄이지만(겹침을 재는 단위가 장비 하나라서), 사람이 보는 단위는 '그 촬영'
   * 하나입니다. 이 표가 그 둘을 잇습니다.
   */
  group?: string
  /** 소속팀 id와 그때의 이름. 이름은 사본입니다 — 팀이 사라져도 읽힙니다. */
  team?: string
  teamName?: string
  /** 사용 사유. 비워 둘 수 없습니다. */
  reason: string
  /** 기타 — 배터리·악세서리를 같이 들고 나가는 경우 같은 것. */
  extra?: string
  at: number
}

/** 1970-01-01부터 며칠째인가. 시간대를 안 탑니다 — 글자만 봅니다. */
export function dayNo(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Math.round(Date.UTC(y, (m || 1) - 1, d || 1) / 86400000)
}

/** 며칠째를 'YYYY-MM-DD'로. */
export function dayYMD(n: number): string {
  const d = new Date(n * 86400000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/**
 * 예약이 차지한 구간을 **하나의 수직선 위에** 올립니다.
 *
 * 날짜와 시각을 따로 비교하면 '금요일 15시부터 월요일 11시까지'와 '토요일
 * 종일'이 겹치는지를 물을 때 경우의 수가 넷으로 갈립니다. 분 하나로 펴 두면
 * 그냥 두 구간입니다.
 */
export function gearSpan(r: GearRange): { start: number; end: number } {
  return {
    start: dayNo(r.from) * DAY + (r.long ? 0 : r.fromMin),
    end: dayNo(r.to) * DAY + (r.long ? DAY : r.toMin),
  }
}

export function gearOverlaps(a: GearRange, b: GearRange): boolean {
  const x = gearSpan(a), y = gearSpan(b)
  return x.start < y.end && y.start < x.end
}

/**
 * **먼저 잡는 사람이 임자.**
 *
 * 승인하는 사람을 두지 않았습니다. 승인이 있으면 빌리는 사람은 기다려야 하고,
 * 담당자는 하루에 열 번 눌러야 하고, 주말에는 아무도 못 빌립니다. 대신 겹치면
 * 그 자리에서 막습니다 — 누가 이미 잡고 있는지를 보여 주면서요.
 *
 * 이 검사는 화면에서만 합니다. 데이터베이스 규칙은 형제 줄을 훑어볼 수 없어서
 * '겹치는가'를 물을 수 없습니다(회의실도 같습니다). 그래서 아주 드물게 두
 * 사람이 같은 순간에 같은 장비를 잡을 수는 있고, 그건 현황판에서 눈에
 * 띕니다 — 막지 못하는 것을 막는 척하지는 않습니다.
 */
export function gearClash(
  bookings: GearBooking[],
  gearId: string,
  range: GearRange,
  exceptId?: string,
): GearBooking | null {
  return bookings.find(b =>
    b.gearId === gearId && b.id !== exceptId && gearOverlaps(b, range),
  ) ?? null
}

/** 그 날짜에 걸쳐 있는가. 현황판이 칸을 칠할 때 씁니다. */
export function coversDay(r: GearRange, ymd: string): boolean {
  const d = dayNo(ymd)
  return d >= dayNo(r.from) && d <= dayNo(r.to)
}

/** 며칠짜리인가. 하루면 1. */
export function gearDays(r: GearRange): number {
  return dayNo(r.to) - dayNo(r.from) + 1
}

export function hhmm(m: number): string {
  const h = Math.floor(m / 60), mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

const md = (ymd: string): string => {
  const [, m, d] = ymd.split('-')
  return `${Number(m)}/${Number(d)}`
}

/** 사람이 읽는 한 줄. '8/27 10:00–12:00' 또는 '8/27 → 9/3 · 8일'. */
export function gearWhen(r: GearRange): string {
  if (r.long) return gearDays(r) === 1 ? `${md(r.from)} 종일` : `${md(r.from)} → ${md(r.to)} · ${gearDays(r)}일`
  if (r.from === r.to) return `${md(r.from)} ${hhmm(r.fromMin)}–${hhmm(r.toMin)}`
  return `${md(r.from)} ${hhmm(r.fromMin)} → ${md(r.to)} ${hhmm(r.toMin)}`
}

/** 최대 대여 기간. 반년을 넘겨 잡아 두면 그건 예약이 아니라 분실입니다. */
export const MAX_GEAR_DAYS = 180

/**
 * 이 예약이 말이 되는가. 되면 null, 안 되면 **사람에게 할 말**을 돌려줍니다.
 *
 * 참/거짓이 아니라 문장인 이유: 부르는 쪽이 셋(예약 화면, 스토어의 마지막 문,
 * 테스트)인데 문구를 각자 지으면 같은 거절이 세 가지 말로 나옵니다.
 */
export function gearRangeError(r: GearRange): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.from) || !/^\d{4}-\d{2}-\d{2}$/.test(r.to)) return '날짜를 골라 주세요.'
  const days = gearDays(r)
  if (days < 1) return '반납일이 대여일보다 빠릅니다.'
  if (days > MAX_GEAR_DAYS) return `한 번에 ${MAX_GEAR_DAYS}일까지 빌릴 수 있습니다.`
  if (r.long) return null
  if (r.fromMin < 0 || r.toMin > DAY) return '시간이 하루 범위를 벗어납니다.'
  const span = gearSpan(r)
  if (span.end <= span.start) return '끝나는 시각이 시작보다 빨라요.'
  return null
}

/**
 * ── 종류로 묶기 ──────────────────────────────────────────────────────────────
 *
 * 카메라 넷, 렌즈 여섯, 조명 여덟이 한 줄로 늘어서면 목록이 아니라 벽입니다.
 * 빌리러 온 사람은 늘 종류를 먼저 정하고("조명 뭐 있지") 그 안에서 고릅니다.
 *
 * **종류 목록을 따로 관리하지 않습니다.** 장비에 적힌 값에서 그때그때 뽑아
 * 냅니다. 관리하는 목록을 하나 더 두면 두 가지가 생깁니다 — 아무것도 없는
 * 빈 종류와, 지워진 종류를 가리키는 장비. 뽑아내면 둘 다 있을 수 없습니다.
 *
 * 종류의 순서는 **그 안에서 제일 먼저 만들어진 장비**를 따릅니다. 가나다순은
 * 예측은 되지만 뜻이 없고(조명이 카메라보다 앞설 이유가 없습니다), 만든 순서는
 * 대개 중요한 것부터입니다. 종류 없는 것들은 맨 아래 한 묶음으로 갑니다 —
 * 아직 정리 안 된 것들이라 위에 있으면 눈이 거기서 걸립니다.
 */
export interface GearLike {
  name: string
  kind?: string
  order?: number
}

/** 종류가 안 적힌 것들이 서는 자리. 화면에도 이 이름으로 뜹니다. */
export const NO_KIND = '종류 없음'

export function groupGear<T extends GearLike>(gear: T[]): { kind: string; items: T[] }[] {
  const buckets = new Map<string, { kind: string; rank: number; items: T[] }>()
  gear.forEach((item, i) => {
    const kind = item.kind?.trim() || NO_KIND
    // 자리는 목록에 놓인 차례로 정합니다 — 부르는 쪽이 이미 order로 정렬해
    // 두었고, order가 없는 옛 장비도 여기서는 뒤로 갑니다.
    const rank = kind === NO_KIND ? Number.MAX_SAFE_INTEGER : i
    const found = buckets.get(kind)
    if (found) found.items.push(item)
    else buckets.set(kind, { kind, rank, items: [item] })
  })
  return [...buckets.values()]
    .sort((a, b) => a.rank - b.rank)
    .map(({ kind, items }) => ({ kind, items }))
}

/** 지금까지 쓴 종류들. 새 장비를 더할 때 고르라고 보여 줍니다. */
export function gearKinds(gear: GearLike[]): string[] {
  return groupGear(gear).map(g => g.kind).filter(k => k !== NO_KIND)
}

/**
 * 그 날 나가 있는 대수.
 *
 * 조금이라도 걸쳐 있으면 셉니다 — 오후 두 시간만 쓰는 것도 그날 그 카메라를
 * 노리던 사람에게는 '나가 있는' 것입니다. 한 대에 예약이 둘이어도 한 대로
 * 셉니다(연달아 두 팀이 쓰는 날).
 *
 * 접힌 줄이 보여 주는 숫자가 이것입니다. 장비가 서른 개면 한 대에 한 줄씩
 * 주는 순간 화면이 벽이 되고, 정작 묻고 싶은 '송수신기 두 대 빌릴 수 있나'는
 * 네 줄을 눈으로 세어야 답이 나옵니다.
 */
export function busyCount(bookings: GearBooking[], gearIds: string[], ymd: string): number {
  const want = new Set(gearIds)
  const out = new Set<string>()
  for (const b of bookings) {
    if (want.has(b.gearId) && coversDay(b, ymd)) out.add(b.gearId)
  }
  return out.size
}
