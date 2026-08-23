// Every database path the app touches, in one place.
//
// The layout is described in docs/data-model.md. Paths matter more than usual
// here because the security rules are attached to them: writing a task to the
// wrong path does not just misplace it, it is refused.

/** Firebase keys cannot contain '.', so addresses are stored with commas. */
export function emailKey(email: string): string {
  return email.toLowerCase().trim().replace(/\./g, ',')
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
