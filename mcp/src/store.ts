import { applicationDefault, cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app'
import { getDatabase, type Database } from 'firebase-admin/database'
import type { Milestone, Project, Task } from './types.js'

/**
 * Data access for the per-project layout described in docs/data-model.md.
 *
 * Tasks live at projects/$pid/tasks/$id or personalTasks/$uid/$id. The Admin SDK
 * bypasses the security rules, so the scoping in access.ts is still what keeps
 * an operator from seeing projects they have no part in — the rules protect the
 * web clients, not this server.
 */

let db: Database | null = null

/**
 * Initialises the Admin SDK against FIREBASE_DATABASE_URL.
 *
 * Credentials come from FIREBASE_SERVICE_ACCOUNT when set (raw JSON or base64),
 * which is how the stdio server runs on a laptop. On Cloud Run the variable is
 * left unset and the runtime's own service account is used instead, so there is
 * no key file to hand around or rotate.
 */
export function initDb(): Database {
  if (db) return db
  if (!getApps().length) {
    const databaseURL = process.env.FIREBASE_DATABASE_URL
    if (!databaseURL) throw new Error('FIREBASE_DATABASE_URL is not set')

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT
    const credential = raw
      ? cert(JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')) as ServiceAccount)
      : applicationDefault()

    initializeApp({ credential, databaseURL })
  }
  db = getDatabase()
  return db
}

interface ProjectNode {
  meta?: Partial<Project>
  members?: Record<string, string>
  tasks?: Record<string, Task>
  milestones?: Record<string, Milestone>
}

const entries = <T,>(record: Record<string, T> | undefined): [string, T][] =>
  record ? Object.entries(record).filter(([, v]) => !!v) : []

async function readProjectNodes(): Promise<Record<string, ProjectNode>> {
  const snap = await initDb().ref('projects').get()
  return (snap.val() ?? {}) as Record<string, ProjectNode>
}

export async function readProjects(): Promise<Project[]> {
  const nodes = await readProjectNodes()
  return entries(nodes)
    .filter(([, node]) => !!node.meta)
    .map(([pid, node]) => ({ ...(node.meta as Project), id: pid }))
}

export async function readMilestones(): Promise<Milestone[]> {
  const nodes = await readProjectNodes()
  return entries(nodes).flatMap(([pid, node]) =>
    entries(node.milestones).map(([mid, m]) => ({ ...m, id: mid, projectId: pid }))
  )
}

/** Where each task is stored, so a change can be written back to the right key. */
interface TaskLocation {
  task: Task
  path: string
}

async function readTaskLocations(): Promise<TaskLocation[]> {
  const database = initDb()
  const [nodes, personalSnap, profilesSnap] = await Promise.all([
    readProjectNodes(),
    database.ref('personalTasks').get(),
    database.ref('userProfiles').get(),
  ])

  const out: TaskLocation[] = []
  for (const [pid, node] of entries(nodes)) {
    for (const [tid, task] of entries(node.tasks)) {
      // The path is what decides which project a task belongs to; a stale
      // projectId on the record itself must not override it.
      out.push({ task: { ...task, id: tid, projectId: pid }, path: `projects/${pid}/tasks/${tid}` })
    }
  }

  const profiles = (profilesSnap.val() ?? {}) as Record<string, { email?: string }>
  const emailByUid = new Map(Object.entries(profiles).map(([uid, p]) => [uid, (p?.email ?? '').toLowerCase()]))
  const personal = (personalSnap.val() ?? {}) as Record<string, Record<string, Task>>
  for (const [uid, tasks] of entries(personal)) {
    for (const [tid, task] of entries(tasks)) {
      out.push({
        task: { ...task, id: tid, projectId: undefined, createdBy: task.createdBy ?? emailByUid.get(uid) },
        path: `personalTasks/${uid}/${tid}`,
      })
    }
  }
  return out
}

export async function readTasks(): Promise<Task[]> {
  return (await readTaskLocations()).map(l => l.task)
}

export async function readUserProfiles(): Promise<Record<string, { email?: string; name?: string; photoURL?: string }>> {
  const snap = await initDb().ref('userProfiles').get()
  return (snap.val() ?? {}) as Record<string, { email?: string; name?: string; photoURL?: string }>
}

export async function uidForEmail(email: string): Promise<string | null> {
  const snap = await initDb().ref('userProfiles').get()
  const profiles = (snap.val() ?? {}) as Record<string, { email?: string }>
  const target = email.toLowerCase()
  for (const [uid, profile] of Object.entries(profiles)) {
    if ((profile?.email ?? '').toLowerCase() === target) return uid
  }
  return null
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = stripUndefined(v)
    return out as T
  }
  return value
}

/**
 * Applies `mutate` to the task list and writes back only what changed.
 *
 * The signature is unchanged from when everything lived in one array, but the
 * write is no longer a wholesale replacement: the before and after lists are
 * compared and each difference lands on its own key. That is what stops a tool
 * call from overwriting edits someone made in the app while it was thinking —
 * the failure the old transaction could only narrow, not close.
 */
export async function mutateTasks<T>(
  mutate: (tasks: Task[]) => { tasks: Task[]; result: T }
): Promise<T> {
  const database = initDb()
  const locations = await readTaskLocations()
  const before = new Map(locations.map(l => [l.task.id, l]))

  const { tasks: next, result } = mutate(locations.map(l => l.task))
  const after = new Map(next.map(t => [t.id, t]))

  const updates: Record<string, unknown> = {}

  const pathFor = async (task: Task): Promise<string> => {
    if (task.projectId) return `projects/${task.projectId}/tasks/${task.id}`
    const owner = task.createdBy ? await uidForEmail(task.createdBy) : null
    if (!owner) throw new Error(`cannot place task ${task.id}: no account matches its creator`)
    return `personalTasks/${owner}/${task.id}`
  }

  const record = (task: Task, path: string) => {
    const { projectId: _pid, ...rest } = task
    updates[path] = stripUndefined(rest)
  }

  for (const [id, existing] of before) {
    const updated = after.get(id)
    if (!updated) { updates[existing.path] = null; continue }

    const path = await pathFor(updated)
    if (path !== existing.path) {
      // A move changes where the record lives, so the old key has to go.
      updates[existing.path] = null
      record(updated, path)
    } else if (JSON.stringify(updated) !== JSON.stringify(existing.task)) {
      record(updated, path)
    }
  }
  for (const [id, task] of after) {
    if (before.has(id)) continue
    record(task, await pathFor(task))
  }

  if (Object.keys(updates).length) await database.ref().update(updates)
  return result
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

// ── Milestones ────────────────────────────────────────────────────────────────

/**
 * Applies `mutate` to one project's milestones and writes back only what moved.
 *
 * Same shape as mutateTasks and for the same reason: a wholesale replacement
 * would silently discard whatever somebody changed in the app while the tool
 * was deciding what to do.
 */
export async function mutateMilestones<T>(
  projectId: string,
  mutate: (milestones: Milestone[]) => { milestones: Milestone[]; result: T }
): Promise<T> {
  const database = initDb()
  const snap = await database.ref(`projects/${projectId}/milestones`).get()
  const raw = (snap.val() ?? {}) as Record<string, Milestone>
  const before = new Map(
    Object.entries(raw).filter(([, v]) => !!v).map(([id, m]) => [id, { ...m, id, projectId }])
  )

  const { milestones: next, result } = mutate([...before.values()])
  const after = new Map(next.map(m => [m.id, m]))

  const updates: Record<string, unknown> = {}
  for (const id of before.keys()) {
    if (!after.has(id)) updates[`projects/${projectId}/milestones/${id}`] = null
  }
  for (const [id, m] of after) {
    const prev = before.get(id)
    if (prev && JSON.stringify(prev) === JSON.stringify(m)) continue
    const { projectId: _p, ...rest } = m
    updates[`projects/${projectId}/milestones/${id}`] = stripUndefined(rest)
  }

  if (Object.keys(updates).length) await database.ref().update(updates)
  return result
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function writeProjectMeta(projectId: string, patch: Partial<Project>): Promise<void> {
  const clean = stripUndefined(patch) as Record<string, unknown>
  if (!Object.keys(clean).length) return
  const updates: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(clean)) updates[`projects/${projectId}/meta/${k}`] = v
  await initDb().ref().update(updates)
}

/**
 * Creates a project owned by `creatorEmail`.
 *
 * Three things have to land together or the project exists but nobody can see
 * it: meta, the creator's uid under members (which is what the database rules
 * actually check), and the userIndex entry the app follows to know which
 * projects to subscribe to. Writing them in one update keeps that from being
 * half-true.
 */
export async function createProject(
  meta: Omit<Project, 'id'> & { id: string; inviteCode: string },
  creatorEmail: string,
): Promise<Project> {
  const uid = await uidForEmail(creatorEmail)
  if (!uid) throw new Error('no account matches the caller, so the project would be invisible to them')
  const { id, ...rest } = meta
  await initDb().ref().update({
    [`projects/${id}`]: {
      meta: stripUndefined({ id, ...rest, teamId: null }),
      members: { [uid]: meta.inviteCode },
    },
    [`userIndex/${uid}/projects/${id}`]: true,
  })
  return { id, ...rest } as Project
}
