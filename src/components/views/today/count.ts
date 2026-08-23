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

  return useMemo(() => {
    if (!html) return 0
    const open = (html.match(/data-checked="false"/g) ?? []).length
    let refs = 0
    for (const m of html.matchAll(/data-task-id="([^"]+)"/g)) {
      const t = tasks.find(t => t.id === m[1])
      if (t && t.status !== '완료') refs++
    }
    return open + refs
  }, [html, tasks])
}
