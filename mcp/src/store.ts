import { applicationDefault, cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app'
import { getDatabase, type Database } from 'firebase-admin/database'
import { getAuth } from 'firebase-admin/auth'
import { placeTask } from './place.js'
import type { Milestone, Project, Task } from './types.js'
import { readableAssignee, orgAllows } from './access.js'
import { emailKey } from './backfill.js'

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
      /*
        ── 명단이 한 겹 더 있습니다 ──────────────────────────────────────────
        프로젝트에 소속이 적혀 있으면, 그 워크스페이스 명단에서도 살아 있어야
        읽힙니다. 웹 규칙이 그렇게 되어 있고, 관리자 SDK는 그 규칙을 안
        지나가므로 여기서 다시 봅니다 — 안 보면 내보낸 사람이 웹에서는
        닫히는데 커넥터로는 계속 읽습니다.

        워크스페이스마다 한 번만 묻습니다. 프로젝트가 스무 개여도 회사는
        보통 하나입니다.
      */
      const seats = new Map<string, Promise<boolean>>()
      const allowed = (oid: string): Promise<boolean> => {
        const known = seats.get(oid)
        if (known) return known
        const asking = (async () => {
          const [roleSnap, domainSnap] = await Promise.all([
            database.ref(`orgs/${oid}/members/${emailKey(email)}/role`).get(),
            database.ref(`orgs/${oid}/meta/domain`).get(),
          ])
          return orgAllows(roleSnap.val() as string | null, domainSnap.val() as string | null, email)
        })()
        seats.set(oid, asking)
        return asking
      }

      const out: Record<string, ProjectNode> = {}
      for (const [pid, node] of entries) {
        if (!node) continue
        /*
          규칙이 세운 벽은 `members/{uid}`입니다. 여기서도 같은 벽을 봅니다 —
          `meta.memberEmails`는 멤버 누구나 고칠 수 있는 표시 목록이라, 그것만
          믿으면 멤버 한 사람이 바깥 주소를 적어 넣는 것으로 커넥터에 문을
          열어 줄 수 있습니다. 색인(userIndex)도 본인이 쓰는 자리입니다.
        */
        const members = (node as { members?: Record<string, unknown> }).members ?? {}
        if (!(uid in members)) continue
        const oid = node.meta?.orgId
        // 소속이 안 적힌 프로젝트는 이 겹이 없습니다 — 혼자 쓰는 것들과
        // 워크스페이스가 생기기 전의 것들입니다.
        if (oid && !(await allowed(oid))) continue
        out[pid] = node
      }
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

/**
 * ── 개인 업무는 부르는 사람 것만 ────────────────────────────────────────────
 *
 * 예전에는 `personalTasks`를 통째로 읽고 내보낼 때 걸렀습니다. 거르는 코드가
 * 맞게 돌아도, **모두의 개인 업무가 서버 메모리에 올라와 있는 상태**를 계속
 * 만들 이유가 없습니다 — 거르는 자리를 한 곳만 빠뜨리면 그대로 나갑니다
 * (실제로 노트 쪽이 그랬습니다).
 *
 * 부르는 사람이 없는 일(아침 브리핑)만 예전처럼 전부 읽습니다.
 */
async function readTaskLocations(email?: string): Promise<TaskLocation[]> {
  const database = initDb()
  const out: TaskLocation[] = []

  const nodes = await readProjectNodes(email)
  for (const [pid, node] of entries(nodes)) {
    for (const [tid, task] of entries(node.tasks)) {
      // The path is what decides which project a task belongs to; a stale
      // projectId on the record itself must not override it.
      out.push({ task: { ...task, id: tid, projectId: pid }, path: `projects/${pid}/tasks/${tid}` })
    }
  }

  const push = (uid: string, tid: string, task: Task, owner: string | undefined) => {
    out.push({
      // 개인 업무의 주인은 **자리**가 말합니다. 안에 적힌 createdBy는 그 사람이
      // 쓴 글자라, 자리와 다르면 자리가 맞습니다.
      task: { ...task, id: tid, projectId: undefined, createdBy: owner ?? task.createdBy },
      path: `personalTasks/${uid}/${tid}`,
    })
  }

  if (email) {
    const uid = await uidForEmail(email)
    if (!uid) return out
    const snap = await database.ref(`personalTasks/${uid}`).get()
    for (const [tid, task] of entries((snap.val() ?? {}) as Record<string, Task>)) {
      push(uid, tid, task, email.toLowerCase())
    }
    return out
  }

  const [personalSnap, profilesSnap] = await Promise.all([
    database.ref('personalTasks').get(),
    database.ref('userProfiles').get(),
  ])
  const profiles = (profilesSnap.val() ?? {}) as Record<string, { email?: string }>
  const emailByUid = new Map(Object.entries(profiles).map(([uid, p]) => [uid, (p?.email ?? '').toLowerCase()]))
  const personal = (personalSnap.val() ?? {}) as Record<string, Record<string, Task>>
  for (const [uid, tasks] of entries(personal)) {
    for (const [tid, task] of entries(tasks)) push(uid, tid, task, emailByUid.get(uid))
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

/**
 * 이메일 → uid. **Firebase 인증이 답합니다.**
 *
 * 예전에는 `userProfiles`를 훑어 `email`이 같은 첫 프로필의 uid를 썼습니다.
 * 그 칸은 각자 자기 프로필에 자기가 쓰는 값이라, 아무 계정이 남의 주소를
 * 적어 두면 그 사람의 개인 업무가 **적어 둔 사람의 자리**에 떨어졋습니다
 * (규칙도 이제 그 값을 자기 주소로 못 박지만, 서버가 그것에 기대면 안 됩니다).
 * 인증 서비스의 주소는 계정마다 하나고 남이 못 씁니다.
 *
 * 인증 조회가 안 될 때(권한이 없는 서비스 계정)만 프로필로 물러나되, **정확히
 * 하나**일 때만 답합니다. 둘이면 누가 진짜인지 서버가 정할 수 없습니다.
 */
export async function uidForEmail(email: string): Promise<string | null> {
  const target = email.toLowerCase().trim()
  try {
    return (await getAuth().getUserByEmail(target)).uid
  } catch (e) {
    const code = (e as { code?: string })?.code ?? ''
    if (code === 'auth/user-not-found') return null
    console.error('[bpp-ops-mcp] auth lookup failed, falling back to profiles:', code || (e instanceof Error ? e.message : e))
  }
  const snap = await initDb().ref('userProfiles').get()
  const profiles = (snap.val() ?? {}) as Record<string, { email?: string }>
  const hits = Object.entries(profiles).filter(([, p]) => (p?.email ?? '').toLowerCase() === target).map(([uid]) => uid)
  return hits.length === 1 ? hits[0] : null
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

  // 개인 자리로 가는 업무는 **부른 사람** 것입니다. 업무에 적힌 주소가 아니라요
  // (place.ts 맨 위 주석). 부른 사람이 없는 일(아침 브리핑)은 개인 업무를
  // 새로 만들지 않으니 그때는 자리를 못 정해도 됩니다.
  let callerUid: string | null | undefined
  const pathFor = async (task: Task): Promise<string> => {
    if (!task.projectId && callerUid === undefined) callerUid = email ? await uidForEmail(email) : null
    return placeTask(task, before.get(task.id)?.path, callerUid ?? null)
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
