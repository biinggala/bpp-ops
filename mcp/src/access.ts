// Access control for the MCP server.
//
// This matters more here than anywhere else in the codebase. The database rules
// are `auth != null` for the whole `cringe` subtree, so a service account — or
// any signed-in user — can read and write everything. All real scoping lives in
// client code. A server that skipped these checks would hand an AI every
// project in the workspace, including ones the caller has no part in.
//
// Every tool therefore resolves data through this module, scoped to the calling
// operator's email. The rules below intentionally mirror canAccessProject() and
// useFilteredTasks() in the web app.

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

export function accessibleProjectIds(projects: Project[], email: string): Set<string> {
  return new Set(projects.filter(p => canAccessProject(p, email)).map(p => p.id))
}

/**
 * Whether a task may be surfaced to this operator.
 *
 * Project tasks follow the project's membership. Tasks with no project are
 * private: visible only to their creator or an assignee — never to unrelated
 * people who merely happen to have some project access.
 */
export function isTaskVisible(task: Task, email: string, accessibleIds: Set<string>): boolean {
  if (task.projectId) return accessibleIds.has(task.projectId)
  const e = email.toLowerCase()
  if (task.createdBy && task.createdBy.toLowerCase() === e) return true
  return isAssignedTo(task, email)
}
