// Access control for the MCP server.
//
// This matters more here than anywhere else in the codebase. The database rules
// enforce project membership for the web clients, but this server connects with
// the Admin SDK and bypasses them entirely — a service account sees everything.
// A server that skipped these checks would hand an AI every project in the
// workspace, including ones the caller has no part in.
//
// Every tool therefore resolves data through this module, scoped to the calling
// operator's email, matching the membership the rules apply to the app.

import { type Project, type Task } from './types.js'

export function canAccessProject(p: Project, email: string): boolean {
  const e = email.toLowerCase()
  if (!e) return false
  if (p.memberEmails?.some(m => m.toLowerCase() === e)) return true
  if (p.creatorEmail && p.creatorEmail.toLowerCase() === e) return true
  return false
}

/**
 * ── 담당자로 지정할 수 있는 사람 ─────────────────────────────────────────────
 *
 * 이 검사가 없었습니다. 커넥터로 업무를 만들면서 아무 주소나 담당자로 적을
 * 수 있었고, 그러면 **그 사람은 그 업무를 못 봅니다** — 프로젝트 멤버가
 * 아니니까요. 화면에는 그 사람 이름이 붙어 있는데 본인은 초대받은 적도
 * 없습니다. 아무에게도 안 맡겨진 일이 맡겨진 것처럼 보입니다.
 *
 * 누가 프로젝트를 볼 수 있는지는 사람이 직접 정할 일입니다. 담당자도 같은
 * 문이라 여기서 몰래 멤버로 넣어 주지 않고 **거절합니다.** 프로젝트를 만드는
 * 도구를 아예 뺀 것도 같은 이유입니다(tools.ts).
 *
 * 초대만 받고 아직 안 들어온 사람(`pendingEmails`)은 됩니다. 사람이 이미
 * 부른 사람이고, 들어오는 순간 그 업무가 보입니다.
 */
export function assignableEmails(p: Project | undefined): Set<string> {
  const out = new Set<string>()
  for (const m of p?.memberEmails ?? []) out.add(m.toLowerCase().trim())
  for (const m of p?.pendingEmails ?? []) out.add(m.toLowerCase().trim())
  if (p?.creatorEmail) out.add(p.creatorEmail.toLowerCase().trim())
  return out
}

/**
 * 담당자로 못 세우는 주소들. 비어 있으면 통과입니다.
 *
 * **프로젝트가 없는 업무는 나만 담당자가 될 수 있습니다.** 남을 적어 봐야
 * 그 사람은 개인 업무를 못 봅니다(`personalTasks/{내 계정}`에 삽니다).
 */
export function unassignable(
  assignee: string | undefined,
  project: Project | undefined,
  caller: string,
): string[] {
  const wanted = parseAssignees(assignee).map(assigneeKeyToEmail).filter(Boolean)
  if (!wanted.length) return []
  const allowed = project ? assignableEmails(project) : new Set([caller.toLowerCase().trim()])
  return [...new Set(wanted.filter(w => !allowed.has(w)))]
}

/**
 * 담당자 토큰을 정규화합니다. 소문자로 내리는 것이 전부입니다.
 *
 * 두 글자 별칭('HC')을 이메일로 바꾸는 표가 여기 있었습니다. 회사가 도메인을
 * 옮긴 뒤로 그 주소를 쓰는 사람이 없어서 표는 아무와도 안 맞았고, 앱 쪽과
 * 같이 지웠습니다.
 */
export function assigneeKeyToEmail(key: string): string {
  return key.toLowerCase().trim()
}

export function parseAssignees(assignee: string | undefined): string[] {
  return assignee ? assignee.split(',').map(s => s.trim()).filter(Boolean) : []
}

/** 같은 사람을 가리키는 모든 토큰. 지금은 원래 글자와 소문자 둘뿐입니다. */
export function assigneeAliases(email: string): string[] {
  return [...new Set([email, email.toLowerCase().trim()])]
}

export function isAssignedTo(task: Task, email: string): boolean {
  const aliases = new Set(assigneeAliases(email))
  return parseAssignees(task.assignee).some(tok => aliases.has(tok) || aliases.has(assigneeKeyToEmail(tok)))
}

/**
 * The assignees a task can actually keep, given where it is stored.
 *
 * A task with no project lives at `personalTasks/$uid` and the database rules
 * let only that account read it. Naming somebody else there does not share the
 * work: they never see the task, it never joins their list, and they cannot
 * change its state. The notice still arrives — those are addressed by email and
 * know nothing about projects — so the whole effect is a notification that
 * opens onto nothing.
 *
 * The Admin SDK here bypasses those rules, so this is the only thing standing
 * between a tool call and that state. Project tasks are left alone: their
 * boundary is project membership, and the rules keep it.
 */
export function readableAssignee(
  projectId: string | undefined | null,
  assignee: string | undefined,
  owner: string | undefined,
): string {
  if (projectId) return assignee ?? ''
  if (!assignee || !owner) return ''
  const aliases = new Set(assigneeAliases(owner))
  return parseAssignees(assignee)
    .filter(tok => aliases.has(tok) || aliases.has(assigneeKeyToEmail(tok)))
    .join(',')
}

export function accessibleProjectIds(projects: Project[], email: string): Set<string> {
  return new Set(projects.filter(p => canAccessProject(p, email)).map(p => p.id))
}

/**
 * Whether a task may be surfaced to this operator.
 *
 * Project tasks follow the project's membership. Tasks with no project are
 * private to the account they are stored under — `personalTasks/$uid`, which
 * the database rules open to that account and nobody else.
 *
 * This used to also count being named as an assignee, which made assignment a
 * way to grant a read the rules themselves would refuse. The app could never
 * honour it — it reads through the rules, so the task simply was not there —
 * and it left this server as the one place in the product where a label was a
 * boundary. Now the two agree, and `readableAssignee` keeps that state from
 * being written in the first place.
 */
export function isTaskVisible(task: Task, email: string, accessibleIds: Set<string>): boolean {
  if (task.projectId) return accessibleIds.has(task.projectId)
  return !!task.createdBy && task.createdBy.toLowerCase() === email.toLowerCase()
}
