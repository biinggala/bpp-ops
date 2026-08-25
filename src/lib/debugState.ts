import { useOrgStore } from '../store/orgStore'
import { usePrefsStore } from '../store/prefsStore'
import { useProjectStore } from '../store/projectStore'
import { useAuthStore } from '../store/authStore'
import { visibleProjects } from './visibleProjects'

/**
 * ── 콘솔에서 지금 상태를 봅니다 ──────────────────────────────────────────────
 *
 * 워크스페이스가 안 갈리는 문제를 세 번 고쳤는데 세 번 다 엉뚱한 자리였습니다.
 * 스토어 안을 볼 방법이 없어서 매번 코드만 읽고 짐작했고, 짐작은 배포한
 * 뒤에야 틀린 것이 드러났습니다.
 *
 * 콘솔에 `bpp()`를 치면 지금 무엇이 어떤 상태인지 그대로 나옵니다. 새로 읽는
 * 것은 없습니다 — 이미 화면이 쓰고 있는 값들이라 이 사람이 볼 수 없는 것은
 * 하나도 안 나옵니다.
 */
export function installDebug(): void {
  const w = window as unknown as { bpp?: () => unknown }
  w.bpp = () => {
    const org = useOrgStore.getState()
    const prefs = usePrefsStore.getState()
    const all = useProjectStore.getState().projects
    const standing = {
      orgId: org.orgId,
      myOrgs: org.myOrgs,
      ready: org.ready,
      preferred: prefs.activeOrg,
      prefsReady: prefs.ready,
    }
    const shown = new Set(visibleProjects(all, standing).map(p => p.id))
    return {
      나: useAuthStore.getState().email,
      서있는곳: { ...standing, 이름: org.name, 도메인: org.domain, 오류: org.error },
      프로젝트: all.map(p => ({
        이름: p.name,
        소속: p.orgId ?? '(없음 — 어디서나 보입니다)',
        보임: shown.has(p.id),
        보관: !!p.archived,
        그룹: p.group ?? '',
        id: p.id,
      })),
    }
  }
}
