import { useMemo } from 'react'
import { useProjectStore } from '../store/projectStore'
import { useOrgStore } from '../store/orgStore'
import { usePrefsStore } from '../store/prefsStore'
import { useShallow } from 'zustand/react/shallow'
import { visibleProjects } from '../lib/visibleProjects'
import type { Project } from '../types'

/**
 * 지금 서 있는 워크스페이스의 프로젝트만. 판단은 `lib/visibleProjects`에
 * 있습니다 — 거기 주석과 테스트가 무엇을 왜 숨기는지 말합니다. 여기서는
 * 스토어 넷을 그 함수에 이어 주기만 합니다.
 *
 * 사이드바·업무 목록·필터 메뉴·찾기·가져올 것이 전부 이것 하나를 씁니다.
 * 한 곳만 거르면 사이드바에서 사라진 프로젝트의 업무가 다른 화면에 남고,
 * 그러면 갈린 것이 아니라 한 곳에서만 안 보이는 것이 됩니다.
 */
export function useVisibleProjects(): Project[] {
  const projects = useProjectStore(s => s.projects)
  const { orgId, myOrgs, ready } = useOrgStore(useShallow(s => ({ orgId: s.orgId, myOrgs: s.myOrgs, ready: s.ready })))
  const { preferred, prefsReady } = usePrefsStore(useShallow(s => ({ preferred: s.activeOrg, prefsReady: s.ready })))

  return useMemo(
    () => visibleProjects(projects, { orgId, myOrgs, ready, preferred, prefsReady }),
    [projects, orgId, myOrgs, ready, preferred, prefsReady],
  )
}
