import type { Project } from '../types'

/**
 * ── 지금 서 있는 워크스페이스의 프로젝트만 ───────────────────────────────────
 *
 * 훅에서 떼어낸 판단 부분입니다. 이 자리를 세 번 틀렸고(전환이 아무것도 안
 * 가르던 것, 게스트가 남의 곳에 붙던 것, 켤 때 번쩍이던 것) 셋 다 같은
 * 실수였습니다 — **아직 안 온 것을 없는 것으로 읽기**. 스토어를 붙들고
 * 있으면 그 순간을 만들어 볼 수가 없어서, 값만 받는 함수로 내놓습니다.
 */
export interface Standing {
  /** 지금 붙어 있는 워크스페이스. 아직 안 붙었으면 null. */
  orgId: string | null
  /** 내가 멤버인 워크스페이스들. `ready`가 참일 때만 믿을 수 있습니다. */
  myOrgs: { id: string }[]
  /** 두 갈래(도메인·내 색인)가 각자 한 번씩 대답했는가. */
  ready: boolean
  /** 마지막으로 고른 곳. `prefsReady`가 참일 때만 믿을 수 있습니다. */
  preferred: string | null
  /** 그 설정이 오기는 했는가. 안 온 null과 고른 적 없는 null은 다릅니다. */
  prefsReady: boolean
}

export function visibleProjects(projects: Project[], s: Standing): Project[] {
  if (s.ready) {
    /**
     * 거르는 기준은 '이 프로젝트가 어느 워크스페이스 것인가'가 아니라
     * **'내가 지금 서 있지 않은 내 워크스페이스의 것인가'**입니다.
     *
     *   소속이 없는 프로젝트         늘 보입니다. 워크스페이스가 생기기 전에
     *                               만든 것들과 혼자 쓰는 것들 — 숨기면 갈
     *                               곳이 없습니다.
     *   내가 멤버인 다른 워크스페이스  숨깁니다. 이게 전환이 뜻하는 것입니다.
     *   게스트로 들어가 있는 곳   이제 목록에 섭니다(이름만 아는 자리로).
     *                               그러니 여기 규칙을 그대로 따릅니다 —
     *                               거기 서 있을 때만 보입니다. 그게 전환이
     *                               뜻하는 것이고, 손님으로 있는 회사의
     *                               프로젝트가 내 회사 화면에 섞여 있으면
     *                               '지금 어디에 서 있나'가 뜻을 잃습니다.
     *   목록에 아예 없는 워크스페이스  보입니다. 명단이 아직 안 따라온 옛
     *                               초대가 여기입니다 — 숨기면 어디에 서 있든
     *                               영영 안 보입니다.
     *
     * 마지막 줄이 이 함수의 전부입니다. '남의 워크스페이스 것은 숨긴다'로
     * 짜면 외부 협업자가 자기 화면에서 우리 프로젝트를 잃습니다.
     */
    const elsewhere = new Set(s.myOrgs.map(o => o.id).filter(id => id !== s.orgId))
    if (!elsewhere.size) return projects
    return projects.filter(p => !p.orgId || !elsewhere.has(p.orgId))
  }

  /**
   * ── 아직 다 못 찾아본 동안 ──────────────────────────────────────────────
   *
   * **소속이 찍힌 것을 전부 보류합니다.** 설 곳을 알면 그곳 것만 통과시키고,
   * 모르면 하나도 안 통과시킵니다.
   *
   * '모르면 다 보여 준다'로 두면 안 됩니다. 그 순간이 바로 앱을 켠 직후고,
   * 다른 워크스페이스의 프로젝트가 번쩍이는 것이 정확히 그때입니다. 늦게
   * 나타나는 편이 낫습니다 — 사라지는 것은 방금 본 것을 의심하게 만들고,
   * 늦는 것은 그냥 불러오는 중입니다.
   */
  const active = s.orgId ?? (s.prefsReady ? s.preferred : null)
  if (!active) return projects.filter(p => !p.orgId)
  return projects.filter(p => !p.orgId || p.orgId === active)
}
