import { useMemo } from 'react'
import { useDailyNote } from '../../../hooks/useDailyNote'
import { useTaskStore } from '../../../store/taskStore'
import { fmtYMD } from '../../../lib/utils'

/**
 * 오늘 노트에서 아직 안 끝난 줄의 수.
 *
 * 사이드바의 숫자가 답해야 하는 질문은 '오늘 담은 게 몇 개냐'가 아니라 '아직
 * 몇 개 남았냐'입니다. 담아 놓고 다 끝냈는데도 8이 붙어 있으면 그 숫자는
 * 하루 종일 아무 말도 안 하는 셈입니다.
 *
 * 두 가지를 셉니다: 손으로 친 체크박스 중 안 눌린 것, 그리고 업무 참조 중
 * 완료가 아닌 것. 참조는 id만 저장돼 있으니 상태는 태스크에서 읽습니다 —
 * 남이 끝내 주면 이 숫자도 같이 줄어듭니다.
 */
export function useTodayCount(): number {
  const { html } = useDailyNote(fmtYMD(new Date()))
  const tasks = useTaskStore(s => s.tasks)

  /**
   * 글자를 훑는 일과 상태를 읽는 일을 갈라 둡니다.
   *
   * 한 덩어리였을 때는 **누군가 어딘가에서 업무 하나만 고쳐도** 노트 전체를
   * 다시 정규식으로 훑었습니다. tasks는 50명이 쓰는 앱에서 하루 종일 바뀌는
   * 값이고, 노트의 글자는 그동안 그대로입니다.
   */
  const parsed = useMemo(() => {
    if (!html) return { open: 0, ids: [] as string[] }
    return {
      open: (html.match(/data-checked="false"/g) ?? []).length,
      ids: [...html.matchAll(/data-task-id="([^"]+)"/g)].map(m => m[1]),
    }
  }, [html])

  return useMemo(() => {
    if (!parsed.ids.length) return parsed.open
    // 참조 하나마다 전체 목록을 훑던 것(O(참조×업무))을 한 번의 색인으로
    // 바꿉니다. 업무가 수천 개가 되면 그 차이가 눈에 보입니다.
    const byId = new Map(tasks.map(t => [t.id, t]))
    let refs = 0
    for (const id of parsed.ids) {
      const t = byId.get(id)
      if (t && t.status !== '완료') refs++
    }
    return parsed.open + refs
  }, [parsed, tasks])
}
