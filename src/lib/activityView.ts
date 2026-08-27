/**
 * ── 시작이 없는 기록 ─────────────────────────────────────────────────────────
 *
 * 활동 기록은 '만들었습니다'로 시작해야 합니다. 그게 이 업무에 일어난 첫
 * 일이니까요. 그런데 그 줄이 없는 업무가 두 종류 있습니다 —
 *
 *   활동 기록이 생기기 전에 만든 것   그때는 아무것도 안 적혔습니다.
 *   커넥터로 만든 것                  MCP 서버는 업무만 쓰고 기록은 안 씁니다.
 *
 * 둘 다 **누가 만들었는지는 압니다**(`createdBy`). 언제인지만 모릅니다.
 * 그래서 그 줄을 맨 아래에 세우되 **시각은 안 적습니다.** 아는 것만 말하고
 * 모르는 것은 비워 두는 편이, 그럴듯한 시각을 하나 지어내는 것보다 낫습니다 —
 * 지어낸 시각은 나중에 누가 그걸 근거로 무언가를 따질 때 거짓말이 됩니다.
 */
import type { Activity } from './activity'

/** 시각을 모르는 줄. 화면은 이걸 보고 시각 자리를 비웁니다. */
export const ORIGIN_ID = 'origin'

export interface Creation {
  /** 만든 사람의 보이는 이름. 없으면 줄을 안 만듭니다. */
  by: string
  /** 그때의 이름을 모르므로 지금 이름을 씁니다. */
  title?: string
}

/**
 * 필요하면 '만들었습니다' 한 줄을 맨 뒤(가장 오래된 자리)에 붙입니다.
 *
 * 이미 진짜 기록이 있으면 아무것도 안 합니다 — 같은 문장이 두 번 서면
 * 둘 중 하나는 거짓으로 보입니다.
 */
export function withCreation(entries: Activity[], made: Creation | null): Activity[] {
  if (!made?.by) return entries
  if (entries.some(e => e.kind === 'created')) return entries
  return [
    ...entries,
    { id: ORIGIN_ID, kind: 'created', by: made.by, at: 0, ...(made.title ? { title: made.title } : {}) },
  ]
}

/** 한 줄이 읽히는 문장. 이름을 아는 것과 모르는 것을 가릅니다. */
export function activityLine(kind: Activity['kind'], title?: string): string {
  const what = title ? `'${title}' 업무를` : '업무를'
  if (kind === 'created') return `${what} 만들었습니다`
  if (kind === 'deleted') return `${what} 삭제했습니다`
  if (kind === 'restored') return '휴지통에서 되살렸습니다'
  return '수정했습니다'
}
