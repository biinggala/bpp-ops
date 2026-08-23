// Every database path the app touches, in one place.
//
// The layout is described in docs/data-model.md. Paths matter more than usual
// here because the security rules are attached to them: writing a task to the
// wrong path does not just misplace it, it is refused.

/** Firebase keys cannot contain '.', so addresses are stored with commas. */
export function emailKey(email: string): string {
  return email.toLowerCase().trim().replace(/\./g, ',')
}

/** 도메인도 키가 되어야 합니다 — 마침표는 Firebase 키에 못 들어갑니다. */
export function domainKey(email: string): string {
  const at = email.lastIndexOf('@')
  return at < 0 ? '' : email.slice(at + 1).toLowerCase().trim().replace(/\./g, ',')
}

export const P = {
  project:          (pid: string) => `projects/${pid}`,
  projectMeta:      (pid: string) => `projects/${pid}/meta`,
  projectMetaField: (pid: string, field: string) => `projects/${pid}/meta/${field}`,
  projectMembers:   (pid: string) => `projects/${pid}/members`,
  projectMember:    (pid: string, uid: string) => `projects/${pid}/members/${uid}`,
  projectTasks:     (pid: string) => `projects/${pid}/tasks`,
  projectTask:      (pid: string, tid: string) => `projects/${pid}/tasks/${tid}`,
  /**
   * Who changed what on a task. Inside the project node on purpose: that node
   * is already readable and writable by exactly its members, so a task's
   * history is visible to the same people the task is — no new rule, and no
   * new idea of who may see it.
   */
  activity:         (pid: string, tid: string) => `projects/${pid}/activity/${tid}`,
  projectMilestone: (pid: string, mid: string) => `projects/${pid}/milestones/${mid}`,

  personalTasks:    (uid: string) => `personalTasks/${uid}`,
  personalTask:     (uid: string, tid: string) => `personalTasks/${uid}/${tid}`,

  userProjects:     (uid: string) => `userIndex/${uid}/projects`,
  userProject:      (uid: string, pid: string) => `userIndex/${uid}/projects/${pid}`,

  inviteInbox:      (email: string) => `invitesByEmail/${emailKey(email)}`,
  inviteEntry:      (email: string, pid: string) => `invitesByEmail/${emailKey(email)}/${pid}`,

  space:            (sid: string) => `spaces/${sid}`,
  userProfile:      (uid: string) => `userProfiles/${uid}`,

  /** One person's inbox. Anyone may leave a notice here; only the owner reads it. */
  // Addressed by **email**, not uid. The sender knows the assignee's email —
  // it is what `assignee` stores — and would have to resolve a uid through the
  // project's member list to do anything else, which silently fails whenever
  // that list is thin. Rules check `auth.token.email`, so the key is one the
  // recipient can prove without anybody looking anything up.
  notices:          (email: string) => `notices/${emailKey(email)}`,
  /**
   * 데일리 노트. 하루에 하나, 사람마다 하나.
   *
   * 프로젝트 밑이 아니라 개인 가지에 삽니다. 여기 적히는 건 '커피 주문' 같은,
   * 오늘 하루가 지나면 아무 의미 없는 것들입니다 — 50명이 함께 보는 곳에 두면
   * 아무도 거기에 그런 걸 안 씁니다. 규칙도 본인만 읽고 씁니다.
   */
  dailyNote:        (email: string, date: string) => `dailyNotes/${emailKey(email)}/${date}`,
  /**
   * 드라이브를 어디까지 봤는지.
   *
   * 페이지 토큰 하나와, 파일마다 마지막으로 알린 시각. 기기가 아니라 사람에게
   * 붙어 있어야 합니다 — 노트북에서 본 변경을 폰에서 다시 알리면 같은 일이
   * 두 번 일어난 것처럼 보입니다.
   */
  driveWatch:       (email: string) => `driveWatch/${emailKey(email)}`,

  /**
   * ── 조직 ───────────────────────────────────────────────────────────────────
   *
   * 회사가 함께 쓰는 것들이 사는 곳입니다. 지금은 회의실 하나뿐입니다.
   *
   * **프로젝트 멤버십을 대신하지 않습니다.** 업무와 프로젝트는 계속 프로젝트
   * 멤버십만으로 정해집니다 — 조직은 '우리 회사에 회의실이 셋 있다' 같은
   * 공유된 사실을 담는 자리고, 누가 무슨 업무를 볼 수 있는지와는 아무 상관이
   * 없습니다. 여기에 접근 개념을 하나 더 만들면 두 축이 생기고, 두 축은
   * 언젠가 어긋납니다.
   *
   * 소속은 **이메일 도메인**입니다. 초대도 승인도 없습니다 — @bpp.co.kr로
   * 로그인했으면 우리 회사고, 그게 이미 참인 사실이라 따로 관리할 것이
   * 없습니다.
   */
  orgMeta:          (oid: string) => `orgs/${oid}/meta`,
  /**
   * 조직 설정을 고칠 수 있는 사람들. 이메일 키가 곧 목록입니다.
   *
   * **회의실 목록에만 미칩니다.** 업무·프로젝트가 누구에게 보이는지는 계속
   * 프로젝트 멤버십만으로 정해집니다 — 조직 관리자가 남의 업무를 볼 수 있게
   * 되면 접근 축이 두 개가 되고, 축이 두 개면 언젠가 어긋납니다.
   */
  orgAdmins:        (oid: string) => `orgs/${oid}/admins`,
  orgAdmin:         (oid: string, email: string) => `orgs/${oid}/admins/${emailKey(email)}`,
  /**
   * ── 조직에 공개된 프로젝트 목록 ──────────────────────────────────────────
   *
   * **경계가 아니라 라벨입니다.** 여기 이름이 올라와도 그 프로젝트의 업무는
   * 못 봅니다 — 접근은 계속 `projects/{pid}/members`가 정합니다. 이 목록이
   * 답하는 건 '우리 회사에 이런 프로젝트가 있고, 들어가려면 누구에게 말하면
   * 되는가' 하나입니다.
   *
   * 이름을 **한 벌 베껴 둡니다.** 프로젝트 노드는 멤버 아닌 사람에게 닫혀
   * 있어서, 목록을 그리려면 그 안을 읽지 않고도 이름을 알아야 합니다. 이미
   * 초대장(`invitesByEmail`)이 같은 이유로 같은 일을 하고 있습니다.
   */
  orgProjects:      (oid: string) => `orgs/${oid}/projects`,
  orgProject:       (oid: string, pid: string) => `orgs/${oid}/projects/${pid}`,
  /** 참여 요청. 프로젝트별로 모아 두고, 승인은 그 프로젝트 멤버가 합니다. */
  orgJoinRequests:  (oid: string) => `orgs/${oid}/joinRequests`,
  orgJoinRequest:   (oid: string, pid: string, email: string) => `orgs/${oid}/joinRequests/${pid}/${emailKey(email)}`,
  orgRooms:         (oid: string) => `orgs/${oid}/rooms`,
  orgRoom:          (oid: string, rid: string) => `orgs/${oid}/rooms/${rid}`,
  /** 예약은 **날짜가 먼저**입니다. 화면이 묻는 건 늘 '이 날 이 방 비었나'인데,
      방이 먼저면 방마다 리스너가 하나씩 필요합니다. 날짜가 먼저면 하루에
      하나로 모든 방을 덮습니다. */
  orgBookings:      (oid: string, date: string) => `orgs/${oid}/bookings/${date}`,
  orgBooking:       (oid: string, date: string, bid: string) => `orgs/${oid}/bookings/${date}/${bid}`,
  /** 내 도메인의 조직이 어느 것인가. 한 도메인에 하나입니다. */
  orgByDomain:      (email: string) => `orgByDomain/${domainKey(email)}`,

  /** Where a device's push subscription lives, so the server can reach it. */
  pushSubs:         (uid: string) => `pushSubs/${uid}`,
  pushSub:          (uid: string, id: string) => `pushSubs/${uid}/${id}`,
} as const

/**
 * Invite links carry the project id alongside the code.
 *
 * The old link held the code alone and the app found the project by scanning
 * every project it had loaded. Under the new rules a non-member cannot read the
 * project list at all, so the link has to say which project it is for; the code
 * is still what the rules check before letting someone in.
 */
export function buildInviteToken(projectId: string, inviteCode: string): string {
  return `${projectId}-${inviteCode}`
}

export function parseInviteToken(token: string): { projectId: string; inviteCode: string } | null {
  const at = token.lastIndexOf('-')
  if (at <= 0 || at === token.length - 1) return null
  return { projectId: token.slice(0, at), inviteCode: token.slice(at + 1) }
}
