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

import { LEGACY_MEMBERS, type Project, type Task } from './types.js'

export function canAccessProject(p: Project, email: string): boolean {
  const e = email.toLowerCase()
  if (!e) return false
  if (p.memberEmails?.some(m => m.toLowerCase() === e)) return true
  if (p.creatorEmail && p.creatorEmail.toLowerCase() === e) return true
  return false
}

/** Resolves an assignee token (email or legacy key like 'HC') to a lowercased email. */
export function assigneeKeyToEmail(key: string): string {
  return (LEGACY_MEMBERS[key] ?? key).toLowerCase()
}

export function parseAssignees(assignee: string | undefined): string[] {
  return assignee ? assignee.split(',').map(s => s.trim()).filter(Boolean) : []
}

/** Every token that refers to the same person — email plus any legacy key. */
export function assigneeAliases(email: string): string[] {
  const target = email.toLowerCase()
  const out = new Set<string>([target])
  for (const [key, mail] of Object.entries(LEGACY_MEMBERS)) {
    if (mail.toLowerCase() === target) out.add(key)
  }
  return [...out]
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
