import { useCallback } from 'react'
import { useProjectStore } from '../store/projectStore'
import { useUserProfileStore } from '../store/userProfileStore'
import { askConfirm } from '../components/shared/Confirm'
import { useToast } from '../components/shared/Toast'

/**
 * ── 초대하고 맡기기 ──────────────────────────────────────────────────────────
 *
 * 담당자 목록에 없는 동료를 골랐을 때 하는 일. 세 곳(새 업무·업무 창·목록)이
 * 같은 문장과 같은 순서를 쓰도록 여기 한 번만 적습니다.
 *
 * **묻고 나서 합니다.** 초대는 그 사람에게 앱 안에서 창이 뜨는 일이고, 그
 * 프로젝트의 모든 업무·자료·활동 기록이 그 사람에게 열리는 일입니다. 담당자
 * 하나 고르는 동작이 조용히 그걸 하면 안 됩니다 — 확인 창이 무엇이 열리는지
 * 한 줄로 말합니다.
 *
 * **초대와 배정은 한 동작입니다.** 초대만 하고 담당자는 그대로 두면 수락한
 * 뒤에 사람이 다시 와서 맡겨야 하고, 대개는 잊습니다. 아직 수락 전이라
 * 그 사람에게는 아직 안 보이지만, 초대장은 이미 그 사람 앞에 있습니다.
 */
export function useInviteAssign() {
  const addMember = useProjectStore(s => s.addMember)
  const projects = useProjectStore(s => s.projects)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)

  return useCallback(async (
    projectId: string,
    email: string,
    assign: (email: string) => void,
  ) => {
    const project = projects.find(p => p.id === projectId)
    const who = getNameByEmail(email) || email
    const ok = await askConfirm({
      message: `${who}님을 '${project?.name ?? '이 프로젝트'}'에 초대할까요?`,
      detail: '초대를 수락하면 이 프로젝트의 업무와 자료를 볼 수 있게 되고, 이 업무의 담당자가 됩니다. 수락 전까지는 담당자로 표시만 됩니다.',
      confirmLabel: '초대하고 맡기기',
      danger: false,
    })
    if (!ok) return

    addMember(projectId, email)
    assign(email)
    useToast.getState().show(`${who}님을 초대했습니다`)
  }, [projects, addMember, getNameByEmail])
}
