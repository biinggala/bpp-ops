/**
 * ── 회의실은 붐비는 시간에 오래 못 잡습니다 ─────────────────────────────────
 *
 * 방은 몇 개뿐이고 낮에는 모두가 씁니다. 한 팀이 오전 내내 잡아 두면 나머지는
 * 그날 방이 없습니다.
 *
 * **10시부터 18시까지를 두 시간 넘게 차지할 수 없습니다.** 규칙이 재는 것은
 * 회의의 길이가 아니라 **그 시간대를 차지한 만큼**입니다 — 그래야 17시에
 * 시작해 20시에 끝나는 회의가 막히지 않습니다. 그 회의가 낮에서 가져가는 것은
 * 한 시간뿐이니까요. 저녁과 이른 아침은 붐비지 않아서 얼마든지 잡습니다.
 *
 * 길이로 재면 이 두 가지가 같아집니다: 10–13시(낮을 세 시간 차지)와
 * 17–20시(한 시간). 앞은 막아야 하고 뒤는 막을 이유가 없습니다.
 */

/** 붐비는 시간. 분 단위, 자정부터. */
export const PRIME_FROM = 10 * 60
export const PRIME_TO = 18 * 60
/** 그 시간대에서 한 번에 차지할 수 있는 최대. */
export const PRIME_MAX = 2 * 60

/** 이 예약이 붐비는 시간을 몇 분이나 차지하는가. */
export function primeMinutes(range: { from: number; to: number }): number {
  return Math.max(0, Math.min(range.to, PRIME_TO) - Math.max(range.from, PRIME_FROM))
}

/** 규칙에 걸리는가. */
export function roomTooLong(range: { from: number; to: number }): boolean {
  return primeMinutes(range) > PRIME_MAX
}

/**
 * 사람에게 하는 말.
 *
 * **무엇이 안 되는지가 아니라 어떻게 하면 되는지를 말합니다.** '2시간을
 * 넘었습니다'만 적으면 남는 질문이 '그래서 어쩌라고'입니다 — 저녁으로 옮기는
 * 길이 있다는 것을 같이 말해야 그 자리에서 끝납니다.
 */
export function roomRuleNote(): string {
  return '회의실은 낮 10–18시를 2시간까지만 잡을 수 있습니다. 더 길게 쓰려면 18시 이후로 옮겨 주세요.'
}
