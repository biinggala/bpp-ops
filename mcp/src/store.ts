import { applicationDefault, cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app'
import { getDatabase, type Database } from 'firebase-admin/database'
import type { Milestone, Project, Task } from './types.js'

const ROOT = 'cringe'

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

/** RTDB stores these as arrays, but sparse writes can turn them into objects. */
function toList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value.filter(Boolean) as T[]
  if (value && typeof value === 'object') return Object.values(value as Record<string, T>).filter(Boolean)
  return []
}

export async function readTasks(): Promise<Task[]> {
  const snap = await initDb().ref(`${ROOT}/tasks`).get()
  return toList<Task>(snap.val())
}

export async function readProjects(): Promise<Project[]> {
  const snap = await initDb().ref(`${ROOT}/projects`).get()
  return toList<Project>(snap.val())
}

export async function readMilestones(): Promise<Milestone[]> {
  const snap = await initDb().ref(`${ROOT}/milestones`).get()
  return toList<Milestone>(snap.val())
}

/**
 * Applies `mutate` to the task list inside an RTDB transaction.
 *
 * The web app stores every task in a single array and rewrites the whole thing
 * on each change, so a naive read-modify-write here would silently discard any
 * edit made while we were thinking. A transaction re-runs on conflict, which
 * closes that window against other transactional writers.
 *
 * It cannot protect against the app's own plain `set()` overwrite landing in the
 * same instant — fixing that properly means moving to per-task keys
 * (`cringe/tasks/<id>`), which is a data-model change, not a server change.
 *
 * Writes land on `cringe/tasks` and `cringe/savedAt` separately; never on the
 * `cringe` root, which would clobber projects, milestones and profiles.
 */
export async function mutateTasks<T>(
  mutate: (tasks: Task[]) => { tasks: Task[]; result: T }
): Promise<T> {
  const database = initDb()
  let captured: T | undefined
  let ran = false

  const outcome = await database.ref(`${ROOT}/tasks`).transaction(current => {
    const tasks = toList<Task>(current)
    const { tasks: next, result } = mutate(tasks)
    captured = result
    ran = true
    return next
  })

  if (!outcome.committed) throw new Error('write conflict — the task list changed mid-update; retry')
  if (!ran) throw new Error('transaction did not execute')

  // The app only accepts remote data when savedAt is newer than its local copy.
  await database.ref(`${ROOT}/savedAt`).set(Date.now())
  return captured as T
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}
