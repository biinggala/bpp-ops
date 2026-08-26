import { applicationDefault, cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app'
import { getDatabase, type Database } from 'firebase-admin/database'
import type { Milestone, Project, Task } from './types.js'
import { readableAssignee } from './access.js'

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

/**
 * ── 부르는 사람 것만 읽습니다 ────────────────────────────────────────────────
 *
 * 예전에는 `projects`를 통째로 읽고 메모리에서 걸렀습니다. 한 회사만 쓰는
 * 동안에는 낭비였을 뿐이지만, 회사가 둘이 되면 그건 **남의 회사 데이터를
 * 서버 메모리로 가져온 뒤 거르는 것**이 됩니다. 관리자 SDK는 규칙을 안
 * 지나가므로, 거르는 코드가 한 번만 틀리면 그대로 샙니다.
 *
 * 좁히는 근거로 `orgs/{oid}/owns`(그 회사의 프로젝트 목록)를 쓰려다 그만
 * 뒀습니다. 워크스페이스 없이 자기 프로젝트만 쓰는 사람 — 소속이 안 적힌
 * 프로젝트 — 이 그 목록에 없어서, 그런 분이 커넥터를 붙이면 **아무것도 안
 * 보입니다.** 실제로 그렇게 쓰는 분이 있습니다.
 *
 * `userIndex/{계정}/projects`가 정확합니다. 앱이 "내 프로젝트"를 찾는 데 쓰는
 * 바로 그 목록이라, 소속이 있든 없든 맞고 회사가 몇 개든 자기 것만 나옵니다.
 *
 * 이메일을 안 주면 예전처럼 전부 읽습니다 — 아침 브리핑처럼 **모두를 대신해
 * 도는 일**이 있어서고, 그런 일에는 부르는 사람이 없습니다.
 */
async function readProjectNodes(email?: string): Promise<Record<string, ProjectNode>> {
  const database = initDb()

  if (email) {
    const uid = await uidForEmail(email)
    if (uid) {
      const indexSnap = await database.ref(`userIndex/${uid}/projects`).get()
      const ids = Object.keys((indexSnap.val() ?? {}) as Record<string, unknown>)
      // 색인이 비었다는 건 프로젝트가 없다는 뜻입니다. 전부 읽기로 물러나면
      // 그 사람에게 남의 프로젝트를 보여 주려 시도하게 됩니다 — 접근 검사가
      // 막긴 하지만, 애초에 가져오지 않는 편이 맞습니다.
      const entries = await Promise.all(ids.map(async pid => {
        const snap = await database.ref(`projects/${pid}`).get()
        return [pid, snap.val() as ProjectNode | null] as const
      }))
      const out: Record<string, ProjectNode> = {}
      for (const [pid, node] of entries) if (node) out[pid] = node
      return out
    }
    // 프로필이 없는 계정입니다. 한 번도 앱을 안 켰다는 뜻이고, 그러면 프로젝트도
    // 없습니다.
    return {}
  }

  const snap = await database.ref('projects').get()
  return (snap.val() ?? {}) as Record<string, ProjectNode>
}

export async function readProjects(email?: string): Promise<Project[]> {
  const nodes = await readProjectNodes(email)
  return entries(nodes)
    .filter(([, node]) => !!node.meta)
    .map(([pid, node]) => ({ ...(node.meta as Project), id: pid }))
}

export async function readMilestones(email?: string): Promise<Milestone[]> {
  const nodes = await readProjectNodes(email)
  return entries(nodes).flatMap(([pid, node]) =>
    entries(node.milestones).map(([mid, m]) => ({ ...m, id: mid, projectId: pid }))
  )
}

/** Where each task is stored, so a change can be written back to the right key. */
interface TaskLocation {
  task: Task
  path: string
}

async function readTaskLocations(email?: string): Promise<TaskLocation[]> {
  const database = initDb()
  const [nodes, personalSnap, profilesSnap] = await Promise.all([
    readProjectNodes(email),
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

export async function readTasks(email?: string): Promise<Task[]> {
  return (await readTaskLocations(email)).map(l => l.task)
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
  mutate: (tasks: Task[]) => { tasks: Task[]; result: T },
  /** 부르는 사람. 그 사람 프로젝트만 읽어 옵니다. */
  email?: string,
): Promise<T> {
  const database = initDb()
  const locations = await readTaskLocations(email)
  const before = new Map(locations.map(l => [l.task.id, l]))

  const { tasks: mutated, result } = mutate(locations.map(l => l.task))

  // Where a task is stored decides who can read it, so it also decides who can
  // be its assignee. A tool call cannot name somebody who would never see the
  // task — see readableAssignee. Checking it here covers every tool at once,
  // including the bulk ones, and it is the same place the path is decided.
  const next = mutated.map(t => {
    const kept = readableAssignee(t.projectId, t.assignee, t.createdBy)
    return kept === (t.assignee ?? '') ? t : { ...t, assignee: kept }
  })
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

/* ── 데일리 노트 ─────────────────────────────────────────────────────────── */

/**
 * 하루치 노트. 사람마다, 날짜마다 하나.
 *
 * 프로젝트가 아니라 개인 가지에 삽니다. 웹은 규칙이 막아 자기 것만 읽지만,
 * 이 서버는 관리자 SDK라 규칙을 지나칩니다 — 그래서 **부르는 쪽의 이메일로만
 * 경로를 만든다는 것**이 여기서는 유일한 울타리입니다. 다른 인자로 남의 노트를
 * 가리킬 수 있게 두면 안 됩니다.
 */
const noteKey = (email: string) => email.toLowerCase().trim().replace(/\./g, ',')

export async function readDailyNote(email: string, date: string): Promise<string> {
  const snap = await initDb().ref(`dailyNotes/${noteKey(email)}/${date}`).get()
  return (snap.val()?.html as string | undefined) ?? ''
}

export async function writeDailyNote(email: string, date: string, html: string): Promise<void> {
  await initDb().ref(`dailyNotes/${noteKey(email)}/${date}`).set({ html, at: Date.now() })
}

/** 어떤 날에 노트가 있는지. 검색과 '최근에 뭐 적었더라'에 씁니다. */
export async function readDailyNoteDates(email: string): Promise<string[]> {
  const snap = await initDb().ref(`dailyNotes/${noteKey(email)}`).get()
  return Object.keys((snap.val() ?? {}) as Record<string, unknown>).sort().reverse()
}
