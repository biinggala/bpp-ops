/**
 * ── 목록에 아직 없는 프로젝트 ────────────────────────────────────────────────
 *
 * 워크스페이스 안의 프로젝트는 목록에 있습니다. 그런데 이 규칙이 생기기 전에
 * 만들어진 것들은 **올린 적이 없어서** 아무에게도 안 보입니다 — 만든 사람
 * 화면에는 멀쩡히 있으니 빠졌다는 사실조차 안 보입니다.
 *
 * 소속 도장과 같은 방식으로 맞춥니다: 스크립트 한 번이 아니라, 그 프로젝트의
 * 멤버가 앱을 켤 때마다 지나가면서 채웁니다. 규칙이 '이 프로젝트의 멤버인가'를
 * 보기 때문에 어차피 멤버만 쓸 수 있고, 그러니 관리자가 할 수 있는 일도
 * 아닙니다.
 *
 * 지금 서 있는 워크스페이스 것만입니다. 다른 곳 프로젝트를 여기 목록에 올리면
 * 그 이름이 엉뚱한 회사에 걸립니다.
 */
export function projectsToList(
  projects: { id: string; orgId?: string }[],
  orgId: string,
  listed: { id: string }[],
): string[] {
  const already = new Set(listed.map(p => p.id))
  return projects
    .filter(p => p.orgId === orgId)
    .filter(p => !already.has(p.id))
    .map(p => p.id)
}
