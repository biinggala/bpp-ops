/**
 * ── 어느 워크스페이스에 붙을 것인가 ──────────────────────────────────────────
 *
 * 답이 셋에서 옵니다: 이 사람이 **고른 곳**, **도메인**이 가리키는 곳, 그리고
 * 내 색인의 **첫 곳**. 셋 다 내가 멤버인 목록(`ids`) 안에 있어야 합니다 —
 * 게스트로 들어가 있는 곳에 붙으면 회의실도 공개 목록도 못 읽어서 화면이
 * 권한 오류로 채워집니다.
 *
 * **고른 곳이 아직 안 왔으면 아무 데도 안 붙습니다.** 이 한 줄이 없어서
 * 새 워크스페이스에 서 있는 사람이 앱을 켤 때마다 회사 프로젝트가 한 번
 * 떴다가 사라졌습니다 — 설정보다 도메인 색인이 먼저 오니까, 그 사이에
 * 도메인이 가리키는 곳에 진짜로 붙어 있었습니다. 화면은 잘못한 게 없습니다.
 */
export interface OrgCandidates {
  /** 마지막으로 고른 곳. `prefsSeen`이 참일 때만 뜻이 있습니다. */
  preferred: string | null
  /** 그 설정이 오기는 했는가. 안 온 null과 고른 적 없는 null은 다릅니다. */
  prefsSeen: boolean
  /** 이메일 도메인 색인이 가리키는 곳. */
  fromDomain: string | null
  /** 내 색인에서 찾은 첫 곳. */
  fromIndex: string | null
  /** 내가 **멤버인** 워크스페이스들. 여기 없는 곳에는 안 붙습니다. */
  ids: string[]
}

export function pickOrg(c: OrgCandidates): string | null {
  if (!c.prefsSeen) return null
  return [c.preferred, c.fromDomain, c.fromIndex].find(o => o && c.ids.includes(o)) ?? null
}

/**
 * ── '다 찾아봤다'가 되려면 네 곳이 대답해야 합니다 ───────────────────────────
 *
 * 이 값이 참이 되는 순간부터 화면은 목록을 믿습니다. 그래서 **하나라도 아직
 * 안 왔는데 참이 되면, 안 온 것이 없는 것으로 읽힙니다.**
 *
 *   domain  이메일 도메인 색인. 회사 계정에 즉시 답합니다.
 *   index   내 색인(`userOrgs`). 도메인 없이 초대만으로 만든 워크스페이스는
 *           **이 길밖에 없습니다.**
 *   roster  그 후보들 중 내가 정말 멤버인 곳을 골라낸 결과.
 *   prefs   마지막으로 고른 곳. 이것도 데이터베이스에서 옵니다.
 *
 * `index`가 빠져 있었습니다. 도메인이 대답하는 순간 후보 목록을 만들기
 * 시작하는데, 그때 내 색인은 아직 안 와서 후보가 비어 있습니다. 결과도
 * 비고, 그런데 '다 찾아봤다'가 참이 됩니다 — 그러면 거르는 쪽이 '숨길 곳이
 * 하나도 없다'로 읽어서 **모든 워크스페이스의 프로젝트가 한 번 보입니다.**
 *
 * 빈 목록이 '없다'가 아니라 '아직 안 왔다'인 자리입니다.
 */
export interface SeenGates {
  domain: boolean
  index: boolean
  roster: boolean
  prefs: boolean
}

export function orgsSettled(g: SeenGates): boolean {
  return g.domain && g.index && g.roster && g.prefs
}
