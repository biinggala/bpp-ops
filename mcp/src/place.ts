// 업무가 **어디에 저장되는가** — 값만 받고 값만 돌려줍니다.
//
// 저장 위치가 곧 누가 읽는가입니다. `projects/{pid}/tasks`는 그 프로젝트
// 멤버가, `personalTasks/{uid}`는 그 사람 혼자 읽습니다. 그래서 이 판단이
// 틀리면 접근 검사가 다 맞아도 데이터가 남의 자리에 떨어집니다.
//
// 예전에는 개인 업무의 자리를 그 업무에 적힌 `createdBy`로 정했습니다. 그런데
// 그 칸은 그냥 글자입니다 — 앱에서 자기 개인 업무에 남의 주소를 적어 두고
// 마일스톤 하나를 지우면, 서버가 그 업무를 **남의 개인 목록으로 옮겼습니다.**
// 이제 이미 있는 업무는 읽힌 자리에 그대로 두고, 새로 개인 자리로 가는
// 업무는 **부른 사람** 자리에만 둡니다.

export interface Placeable {
  id: string
  projectId?: string
}

/**
 * @param task         저장할 업무(바뀐 뒤 모습)
 * @param existingPath 읽힌 자리. 새 업무면 undefined.
 * @param callerUid    부른 사람의 uid. 개인 자리로 갈 때만 필요합니다.
 */
export function placeTask(task: Placeable, existingPath: string | undefined, callerUid: string | null): string {
  if (task.projectId) return `projects/${task.projectId}/tasks/${task.id}`
  // 개인 업무는 있던 자리에 그대로. 자리를 바꿀 근거가 되는 칸이 없습니다.
  if (existingPath?.startsWith('personalTasks/')) return existingPath
  if (!callerUid) throw new Error(`cannot place task ${task.id}: no caller to own it`)
  return `personalTasks/${callerUid}/${task.id}`
}
