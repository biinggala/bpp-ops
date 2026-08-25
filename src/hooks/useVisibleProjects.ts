import { useMemo } from 'react'
import { useProjectStore } from '../store/projectStore'
import { useOrgStore } from '../store/orgStore'
import { useShallow } from 'zustand/react/shallow'
import type { Project } from '../types'

/**
 * ── 지금 서 있는 워크스페이스의 프로젝트만 ───────────────────────────────────
 *
 * 전환 단추를 만들어 놓고 목록은 안 갈랐습니다. 그래서 워크스페이스를 바꾸면
 * 이름과 회의실은 바뀌는데 프로젝트는 그대로였고, 전환이 **약속한 것을 안
 * 지키는 단추**가 됐습니다.
 *
 * 거르는 기준은 '이 프로젝트가 어느 워크스페이스 것인가'가 아니라 **'내가
 * 지금 서 있지 않은 내 워크스페이스의 것인가'**입니다. 셋을 갈라야 합니다:
 *
 *   소속이 없는 프로젝트        늘 보입니다. 워크스페이스가 생기기 전에
 *                              만든 것들, 그리고 혼자 쓰는 것들입니다.
 *                              여기서 숨기면 갈 곳이 없어집니다.
 *
 *   내가 멤버인 다른 워크스페이스  숨깁니다. 이게 전환이 뜻하는 것입니다.
 *
 *   내가 멤버가 아닌 워크스페이스  보입니다. 게스트로 초대받아 들어간 남의
 *                              회사가 여기입니다 — 나는 그곳에 '서 있을' 수
 *                              없으므로(전환 목록에 안 뜹니다), 숨기면
 *                              어디에 서 있든 영영 안 보입니다.
 *
 * 마지막 줄이 이 훅의 전부입니다. '남의 워크스페이스 것은 숨긴다'로 짜면
 * 외부 협업자가 자기 화면에서 우리 프로젝트를 잃습니다.
 *
 * **아직 안 왔을 때는 아무것도 안 숨깁니다.** `myOrgs`가 비어 있으면 숨길
 * 목록도 비어 있어서 자연히 그렇게 됩니다 — 목록이 오는 중이라는 이유로
 * 프로젝트가 사라졌다 나타나는 일이 없습니다.
 */
export function useVisibleProjects(): Project[] {
  const projects = useProjectStore(s => s.projects)
  const { orgId, myOrgs } = useOrgStore(useShallow(s => ({ orgId: s.orgId, myOrgs: s.myOrgs })))

  return useMemo(() => {
    const elsewhere = new Set(myOrgs.map(o => o.id).filter(id => id !== orgId))
    if (!elsewhere.size) return projects
    return projects.filter(p => !p.orgId || !elsewhere.has(p.orgId))
  }, [projects, orgId, myOrgs])
}
