import type { Express, Request, Response } from 'express'
import { getAuth } from 'firebase-admin/auth'
import webpush, { WebPushError } from 'web-push'
import { initDb, readProjects, readTasks, readUserProfiles } from './store.js'
import { assigneeKeyToEmail, parseAssignees } from './access.js'
import type { Task } from './types.js'

/**
 * ── 푸시 보내는 쪽 ───────────────────────────────────────────────────────────
 *
 * Two endpoints, and they are trusted in completely different ways.
 *
 * `POST /push/notify` is called by the app, by a person, right after they
 * assigned something to somebody. It carries that person's Firebase ID token
 * and pushes to exactly one recipient. It cannot be used to say anything about
 * anybody else's work — the text is the caller's to choose, but the audience is
 * one uid, and the caller is named in the payload, so this is the same trust
 * level as the notice already written into that person's inbox.
 *
 * `POST /push/brief` is called by Cloud Scheduler, once each working morning,
 * and sends everybody one line about their own day. Nobody's word is taken for
 * this one: it is guarded by a shared secret, and the contents come from the
 * database rather than the request.
 *
 * Subscriptions that Google or Apple have retired answer 404/410. Those are
 * deleted on the spot — a dead endpoint that is retried every morning is how a
 * sender ends up rate-limited.
 */

const PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const PUBLIC = process.env.VAPID_PUBLIC_KEY ?? ''
const SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:heegun@bpp.co.kr'
const BRIEF_SECRET = process.env.PUSH_BRIEF_SECRET ?? ''

export function pushConfigured(): boolean {
  return !!PRIVATE && !!PUBLIC
}

if (pushConfigured()) webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE)

interface StoredSub {
  endpoint: string
  keys?: { p256dh?: string; auth?: string }
}

interface Payload {
  title: string
  body: string
  url?: string
  tag?: string
  unread?: number
  renotify?: boolean
}

/** Sends to every device one person has, dropping the ones that have died. */
async function sendTo(uid: string, payload: Payload): Promise<number> {
  const db = initDb()
  const snap = await db.ref(`pushSubs/${uid}`).get()
  const subs = (snap.val() ?? {}) as Record<string, StoredSub>
  let sent = 0

  await Promise.all(Object.entries(subs).map(async ([id, sub]) => {
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 12, urgency: 'normal' },
      )
      sent++
    } catch (e) {
      const status = e instanceof WebPushError ? e.statusCode : 0
      // Gone for good — the app was deleted, or the subscription expired.
      if (status === 404 || status === 410) {
        await db.ref(`pushSubs/${uid}/${id}`).remove().catch(() => {})
      } else {
        console.error('[push]', uid, status || (e instanceof Error ? e.message : e))
      }
    }
  }))

  return sent
}

/** Unread inbox count, so the app icon's badge can be set by the push itself. */
async function unreadFor(uid: string): Promise<number> {
  const snap = await initDb().ref(`notices/${uid}`).get()
  const notices = (snap.val() ?? {}) as Record<string, { read?: boolean }>
  return Object.values(notices).filter(n => !n?.read).length
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Assignees are stored comma-separated, and older rows hold a legacy key. */
function assigneesOf(task: Task): string[] {
  return parseAssignees(task.assignee).map(assigneeKeyToEmail)
}

/**
 * One line per person: what is due today, what is already late, what is coming.
 *
 * Deliberately a count rather than a list. A morning notification that names
 * three tasks is a notification people swipe away; one that says "3건" is a
 * question they answer by opening the app, which is where the answer actually
 * is.
 */
export interface Brief { today: number; overdue: number; week: number }

export function briefsByUid(
  tasks: Task[],
  profiles: Record<string, { email?: string }>,
  today: Date,
): Map<string, Brief> {
  const uidByEmail = new Map<string, string>()
  for (const [uid, profile] of Object.entries(profiles)) {
    if (profile?.email) uidByEmail.set(profile.email.toLowerCase(), uid)
  }

  const todayStr = ymd(today)
  const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7)
  const weekStr = ymd(weekEnd)

  const out = new Map<string, Brief>()
  for (const task of tasks) {
    if (task.status === '완료' || !task.due) continue
    for (const who of assigneesOf(task)) {
      const uid = uidByEmail.get(who)
      if (!uid) continue
      const brief = out.get(uid) ?? { today: 0, overdue: 0, week: 0 }
      if (task.due < todayStr) brief.overdue++
      else if (task.due === todayStr) brief.today++
      else if (task.due <= weekStr) brief.week++
      out.set(uid, brief)
    }
  }
  return out
}

export function briefLine(b: Brief): string | null {
  const parts: string[] = []
  if (b.overdue) parts.push(`지난 일 ${b.overdue}건`)
  if (b.today) parts.push(`오늘 마감 ${b.today}건`)
  if (b.week) parts.push(`이번 주 ${b.week}건`)
  // Nothing due and nothing late is not worth waking a phone for.
  if (!b.overdue && !b.today) return null
  return parts.join(' · ')
}

export function registerPushRoutes(app: Express): void {
  app.post('/push/notify', async (req: Request, res: Response) => {
    if (!pushConfigured()) return void res.status(503).json({ error: 'push is not configured' })

    const header = req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return void res.status(401).json({ error: 'no token' })

    let caller: string
    try {
      caller = (await getAuth().verifyIdToken(token)).uid
    } catch {
      return void res.status(401).json({ error: 'bad token' })
    }

    const { toUid, title, body, url } = (req.body ?? {}) as Record<string, unknown>
    if (typeof toUid !== 'string' || typeof title !== 'string' || typeof body !== 'string') {
      return void res.status(400).json({ error: 'toUid, title, body are required' })
    }
    // Pushing to yourself is what the app does when it has nothing to say.
    if (toUid === caller) return void res.json({ sent: 0 })

    const sent = await sendTo(toUid, {
      title: title.slice(0, 120),
      body: body.slice(0, 220),
      url: typeof url === 'string' ? url : '/',
      tag: `notice:${toUid}`,
      renotify: true,
      unread: await unreadFor(toUid),
    })
    res.json({ sent })
  })

  app.post('/push/brief', async (req: Request, res: Response) => {
    if (!pushConfigured()) return void res.status(503).json({ error: 'push is not configured' })
    if (!BRIEF_SECRET) return void res.status(503).json({ error: 'PUSH_BRIEF_SECRET is not set' })
    if (req.header('x-brief-secret') !== BRIEF_SECRET) {
      return void res.status(403).json({ error: 'forbidden' })
    }

    const [tasks, profiles, projects] = await Promise.all([
      readTasks(), readUserProfiles(), readProjects(),
    ])
    // Archived projects are not somebody's morning problem.
    const live = new Set(projects.filter(p => !p.archived).map(p => p.id))
    const relevant = tasks.filter(t => !t.projectId || live.has(t.projectId))

    const briefs = briefsByUid(relevant, profiles, new Date())
    let sent = 0
    for (const [uid, brief] of briefs) {
      const line = briefLine(brief)
      if (!line) continue
      sent += await sendTo(uid, {
        title: '오늘의 업무',
        body: line,
        url: '/?mine=1',
        // One tag for the brief, so today's replaces yesterday's rather than
        // stacking into a column of identical notifications.
        tag: 'brief',
        unread: await unreadFor(uid),
      })
    }
    res.json({ people: briefs.size, sent })
    console.error(`[brief] ${briefs.size} people, ${sent} devices`)
  })

  // Lets the app (and a human with curl) see whether the sender is ready.
  app.get('/push/health', (_req, res) => {
    void res.json({ configured: pushConfigured(), brief: !!BRIEF_SECRET })
  })
}
