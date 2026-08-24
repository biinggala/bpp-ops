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
