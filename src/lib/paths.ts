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

  /**
   * ── 휴지통 ────────────────────────────────────────────────────────────────
   *
   * 지운 업무가 30일쯤 머무는 곳. 되살릴 수 있어야 하기 때문입니다 — 지금까지
   * 삭제는 되돌릴 방법이 없었고, ⌘Z는 그 화면을 떠나면 사라집니다.
   *
   * **프로젝트 노드 안에 넣지 않습니다.** 활동 기록이 그렇게 되어 있는데,
   * syncStore는 프로젝트를 통째로 구독하므로 그 안에 있는 것은 **모두가 늘
   * 내려받습니다.** 지운 업무까지 그렇게 되면, 안 쓰는 데이터가 앱을 켤
   * 때마다 오갑니다. 휴지통은 그 화면을 열 때만 읽습니다.
   *
   * 대신 규칙을 한 줄 더 씁니다. 경계는 새로 만들지 않았습니다 — 그 프로젝트
   * 멤버가 곧 그 휴지통을 여는 사람입니다.
   */
  trash:            (pid: string) => `trash/${pid}`,
  trashItem:        (pid: string, tid: string) => `trash/${pid}/${tid}`,
  /** 프로젝트 없는 업무의 휴지통. 본인만. */
  personalTrash:    (uid: string) => `personalTrash/${uid}`,
  personalTrashItem:(uid: string, tid: string) => `personalTrash/${uid}/${tid}`,

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
   * 사람마다 하나, 본인만 보는 작은 기록.
   *
   * `userProfiles`가 아니라 여기입니다 — 그건 이름을 찾으려고 **모두가**
   * 구독하는 노드라, 거기에 '온보딩 봤음' 같은 걸 쓰면 쉰 명의 화면이
   * 다시 그려집니다. 남이 알 필요 없는 값은 남이 안 보는 곳에 둡니다.
   */
  userPrefs:        (email: string) => `userPrefs/${emailKey(email)}`,

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
  /** 워크스페이스 자체. 지우는 것 말고는 이 자리에 쓸 일이 없습니다. */
  org:              (oid: string) => `orgs/${oid}`,
  orgMeta:          (oid: string) => `orgs/${oid}/meta`,
  /**
   * 조직 설정을 고칠 수 있는 사람들. 이메일 키가 곧 목록입니다.
   *
   * **회의실 목록에만 미칩니다.** 업무·프로젝트가 누구에게 보이는지는 계속
   * 프로젝트 멤버십만으로 정해집니다 — 조직 관리자가 남의 업무를 볼 수 있게
   * 되면 접근 축이 두 개가 되고, 축이 두 개면 언젠가 어긋납니다.
   */
  /**
   * ── 조직 명단 ────────────────────────────────────────────────────────────
   *
   * 소속을 **계산하지 않고 적어 둡니다.** 값은 `member` · `guest` · `removed`.
   *
   * 지금까지 소속은 이메일 도메인이었습니다. 관리할 것이 없어서 좋은
   * 규칙이었지만, 도메인이 다른 외부 협업자가 프로젝트에 들어오는 순간
   * 답이 없습니다 — 벽을 도메인으로 세우면 그 사람들이 튕기고, 예외를 두면
   * 벽이 그 자리에서 뚫립니다. 명단이면 게스트는 예외가 아니라 이름이
   * 적힌 사람입니다.
   *
   * 도메인은 사라지지 않고 **명단에 자동으로 적히는 방법**으로 남습니다.
   * 자동 가입은 행이 아예 없을 때만 일어납니다 — 그래야 명단에서 뺀 사람이
   * 다음 로그인에 스스로 돌아오지 않습니다. 그래서 빼는 것은 지우는 것이
   * 아니라 `removed`입니다.
   *
   * 아직 **벽이 아닙니다.** 접근은 계속 프로젝트 멤버십이 정합니다.
   * docs/tenants.md의 1단계 — 명단을 채우는 중입니다.
   */
  orgMembers:       (oid: string) => `orgs/${oid}/members`,
  orgMember:        (oid: string, email: string) => `orgs/${oid}/members/${emailKey(email)}`,
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
  /**
   * ── 이 회사의 프로젝트 전부 ───────────────────────────────────────────────
   *
   * 바로 위 `orgProjects`와 헷갈리기 쉬운데, 다른 것입니다. 저건 **공개하기로
   * 한** 프로젝트의 이름표고 라벨입니다. 이건 **소속**입니다 — 공개했든 안
   * 했든, 이 회사의 것이면 여기 있습니다. 값은 true 하나뿐이라 이름도 안
   * 새 나갑니다.
   *
   * 왜 필요하냐면, 지금은 "이 회사의 프로젝트"를 물을 곳이 없어서 **전부 읽고
   * 걸러야** 하기 때문입니다. MCP 서버가 정확히 그렇게 하고 있습니다
   * (`readProjectNodes`) — 관리자 SDK라 규칙을 안 지나가므로, 회사가 둘이
   * 되는 순간 그건 '남의 회사 데이터를 메모리로 가져온 뒤 거르는 것'이 됩니다.
   * 거르는 코드가 한 번만 틀리면 그대로 샙니다.
   *
   * 소속은 프로젝트 쪽에도 `meta.orgId`로 한 벌 적힙니다. 규칙이 검사할 때
   * 프로젝트에서 시작해 조직을 묻는 길과, 조직에서 시작해 프로젝트를 세는
   * 길이 둘 다 필요해서입니다. 사본이라 늙을 수 있고, 그래서 **둘 다 한 번만
   * 쓰입니다** — 한 번 정해진 프로젝트의 소속은 안 바뀝니다.
   */
  orgOwns:          (oid: string) => `orgs/${oid}/owns`,
  orgOwn:           (oid: string, pid: string) => `orgs/${oid}/owns/${pid}`,
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

  /**
   * 내가 속한 조직들. 로그인 직후 제일 먼저 읽는 색인입니다.
   *
   * 조직 밑에 둘 수 없습니다 — 어느 조직인지 몰라서 묻는 질문이니까요.
   * 본인만 읽고 씁니다. **목록인 이유**는 한 사람이 두 회사에 걸칠 수 있기
   * 때문입니다(외주, 겸직). 값은 들어온 시각.
   */
  userOrgs:         (uid: string) => `userOrgs/${uid}`,
  userOrg:          (uid: string, oid: string) => `userOrgs/${uid}/${oid}`,

  /** Where a device's push subscription lives, so the server can reach it. */
  pushSubs:         (uid: string) => `pushSubs/${uid}`,
  pushSub:          (uid: string, id: string) => `pushSubs/${uid}/${id}`,

  /**
   * 노션이 연결됐는지 — **여기만 앱이 읽습니다.**
   *
   * 노션 열쇠 자체는 `notionAuth/{uid}`에 있고 그 자리는 규칙이 아무에게도
   * 안 열어 줍니다(서버만 관리자 권한으로 씁니다). 앱이 알아야 하는 건
   * '붙었는가'뿐이라, 그 한 줄만 따로 내놓습니다.
   */
  notionLinked:     (uid: string) => `notionLinked/${uid}`,
} as const

/**
 * Invite links carry the project id alongside the code.
 *
 * The old link held the code alone and the app found the project by scanning
 * every project it had loaded. Under the new rules a non-member cannot read the
 * project list at all, so the link has to say which project it is for; the code
 * is still what the rules check before letting someone in.
 */
export function buildInviteToken(projectId: string, inviteCode: string, orgId?: string): string {
  const base = `${projectId}-${inviteCode}`
  return orgId ? `${base}~${orgId}` : base
}

/**
 * 회사 id는 **물결표 뒤에** 붙습니다.
 *
 * 붙임표를 또 쓸 수는 없습니다 — 프로젝트 id를 찾는 방법이 '마지막 붙임표'라,
 * 하나 더 붙이면 이미 돌아다니는 링크의 코드 자리가 밀립니다. 물결표는 지금
 * 어느 자리에도 안 쓰이므로, **없으면 옛 링크**이고 그때는 회사를 모른 채
 * 예전처럼 동작합니다.
 *
 * 회사를 싣는 이유는 받는 사람이 **프로젝트를 읽기 전에** 자기 자리를 조직
 * 명단에 앉힐 수 있어야 하기 때문입니다. 소속은 프로젝트 안에 적혀 있는데,
 * 명단에 없으면 그 프로젝트가 안 열립니다 — 링크가 회사를 안 말해 주면
 * 그 사람은 영영 못 들어옵니다. docs/tenants.md의 3.5단계.
 */
export function parseInviteToken(token: string): { projectId: string; inviteCode: string; orgId?: string } | null {
  const tilde = token.indexOf('~')
  const orgId = tilde >= 0 ? token.slice(tilde + 1) : undefined
  const head = tilde >= 0 ? token.slice(0, tilde) : token
  const at = head.lastIndexOf('-')
  if (at <= 0 || at === head.length - 1) return null
  return { projectId: head.slice(0, at), inviteCode: head.slice(at + 1), ...(orgId ? { orgId } : {}) }
}

/**
 * ── 업무로 바로 가는 링크 ────────────────────────────────────────────────────
 *
 * "그 업무 어디 있죠"에 답하려면 지금은 말로 길을 알려 줘야 합니다 —
 * 프로젝트를 고르고, 마일스톤을 펴고, 목록에서 이름을 찾으라고. 주소 하나면
 * 끝날 일입니다.
 *
 * **주소는 이 배포의 것을 씁니다.** 상수로 박아 두면 미리보기 채널이나 다른
 * 배포에서 만든 링크가 늘 운영 쪽을 가리켜서, 시험 중에 만든 링크가 진짜
 * 화면을 엽니다. 지금 서 있는 곳이 답입니다.
 *
 * **권한은 링크가 주지 않습니다.** 초대 링크와 다른 점입니다 — 저건 코드를
 * 들고 있어서 들여보내 주지만, 이건 가리키기만 합니다. 그 프로젝트의 멤버가
 * 아니면 열어도 못 봅니다. 그래서 링크를 아무에게나 보내도 새는 것이 없고,
 * 반대로 받은 사람이 못 볼 수도 있습니다.
 */
export function taskLinkFor(taskId: string): string {
  return `${window.location.origin}/?task=${encodeURIComponent(taskId)}`
}

/** 주소에 실려 온 업무 id. 로그인 과정에서 주소가 날아가므로 한 번만 읽습니다. */
export const PENDING_TASK_KEY = 'pending_task'
