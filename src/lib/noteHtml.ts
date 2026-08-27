/**
 * ── 노트에 넣을 줄을 글자로 만들 때 ─────────────────────────────────────────
 *
 * 편집기(프로즈미러)는 아무 `<li>`나 체크박스 줄로 읽지 않습니다. **`data-type`
 * 이 붙은 것만** 읽습니다:
 *
 *     ul[data-type="taskList"] > li[data-type="taskItem"]
 *
 * `data-checked`는 눌렸는지를 말할 뿐, 이게 체크박스 줄이라는 말이 아닙니다.
 * 그래서 `<li data-type="${TASK_ITEM}" data-checked="false">`만 적어 두면 그 줄은 taskItem이 아니고,
 * taskList 안에 taskItem이 하나도 없는 모양이 됩니다. 프로즈미러는 그걸
 * 조용히 버리지 않고 **던집니다** — `Invalid content for node taskList: <>`.
 * 넣는 코드가 그 예외를 안 받으면 누른 사람 눈에는 **단추가 안 눌립니다.**
 * '어제 못 끝낸 것 가져오기'가 딱 그 상태였습니다.
 *
 * 그래서 이 글자를 손으로 적지 않고 여기서 만듭니다. 두 값 중 하나만 빠져도
 * 안 되는 일이라, 한 곳에서 같이 붙입니다.
 *
 * (편집기가 살아 있는 곳에서는 스키마로 노드를 만드는 편이 더 낫습니다 —
 * markdown.ts가 그렇게 합니다. 여기는 저장된 글자를 다루는 자리입니다.)
 */

export const TASK_LIST = 'taskList'
export const TASK_ITEM = 'taskItem'

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

/** 자유 체크리스트. 노트에만 살고 태스크가 되지 않습니다. */
export function checklistHtml(lines: string[]): string {
  if (!lines.length) return ''
  const items = lines
    .map(l => `<li data-type="${TASK_ITEM}" data-checked="false"><p>${escapeHtml(l)}</p></li>`)
    .join('')
  return `<ul data-type="${TASK_LIST}">${items}</ul>`
}

/** 진짜 태스크를 가리키는 줄. 이름은 안 넣습니다 — 화면이 그때그때 읽습니다. */
export function taskRefHtml(taskIds: string[]): string {
  return taskIds.map(id => `<div data-task-ref data-task-id="${escapeHtml(id)}"></div>`).join('')
}
