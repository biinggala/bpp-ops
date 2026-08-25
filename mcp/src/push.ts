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
 * and pushes to exactly one recipient.
 *
 * **여기 이렇게 적혀 있었습니다:** '알림함에 이미 들어간 것과 같은 신뢰
 * 수준이다.' 그 말이 이 문을 정당화하고 있었고, 두 가지가 틀렸습니다.
 *
 * 하나. 알림함 쪽은 그 뒤에 조였습니다 — 이제 보낸 사람 주소가 로그인한
 * 주소와 맞아야 합니다. 같은 수준이 아니라 이쪽이 더 헐거웠습니다.
 *
 * 둘. 같은 수준이었다 해도 **울리는 것과 적히는 것은 다릅니다.** 알림함 한
 * 줄은 앱을 열어야 보이고, 푸시는 한밤중에 잠긴 화면에 뜹니다.
 *
 * 지금은 부르는 사람과 받는 사람이 **같은 프로젝트의 멤버**일 때만 보냅니다.
 * 이 앱에서 남에게 알림이 갈 일은 전부 어떤 프로젝트의 업무 때문입니다.
 *
 * 대신 프로젝트 없는 개인 업무를 같은 프로젝트가 하나도 없는 사람에게
 * 맡기면 버즈가 안 갑니다. 알림함에는 그대로 들어갑니다 — 잃는 것이
 * 정보가 아니라 진동 하나라, 모르는 사람이 폰을 울리는 것보다 낫습니다.
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

/**
 * ── 부르는 사람과 받는 사람이 같이 일하는 사이인가 ──────────────────────────
 *
 * 이 검사가 없었습니다. 로그인만 했으면 **uid를 아는 아무에게나** 아무 문구로
 * 폰을 울릴 수 있었습니다. 위에 적혀 있던 '알림함에 쓰는 것과 같은 신뢰
 * 수준'이라는 말은 그때는 맞았지만, 알림함 쪽을 조인 지금은 여기가 더
 * 헐거운 문입니다.
 *
 * **색인만 보면 안 됩니다.** `userIndex/{uid}`는 그 사람이 자기 손으로 쓰는
 * 자리라, 남의 프로젝트 id를 자기 색인에 적어 넣을 수 있습니다. 그래서
 * 색인은 후보를 좁히는 데만 쓰고, 정말 둘 다 멤버인지는 프로젝트의 명단에
 * 물어봅니다 — 그건 규칙이 지키는 자리입니다.
 *
 * 색인이 낡아 있을 때도 같은 검사가 답합니다. 나간 사람의 색인에는 그
 * 프로젝트가 남아 있을 수 있지만 명단에는 없습니다.
 */

/** 두 색인이 같이 가리키는 프로젝트들. 여기까지는 자기 신고입니다. */
export function sharedCandidates(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): string[] {
  if (!a || !b) return []
  const other = new Set(Object.keys(b))
  return Object.keys(a).filter(pid => other.has(pid))
}

/**
 * 후보를 몇 개까지 확인할 것인가.
 *
 * 겹치는 프로젝트가 하나라도 있으면 대개 첫 번째에서 끝납니다. 상한을 두는
 * 것은 색인을 부풀려 놓고 읽기를 잔뜩 시키는 것을 막기 위해서입니다.
 */
const MAX_CHECKS = 10

async function sharesProject(callerUid: string, toUid: string): Promise<boolean> {
  const db = initDb()
  const [mine, theirs] = await Promise.all([
    db.ref(`userIndex/${callerUid}/projects`).get(),
    db.ref(`userIndex/${toUid}/projects`).get(),
  ])
  const candidates = sharedCandidates(
    mine.val() as Record<string, unknown> | null,
    theirs.val() as Record<string, unknown> | null,
  )
  for (const pid of candidates.slice(0, MAX_CHECKS)) {
    const members = (await db.ref(`projects/${pid}/members`).get()).val() as Record<string, unknown> | null
    if (members && members[callerUid] !== undefined && members[toUid] !== undefined) return true
  }
  return false
}

/**
 * Unread inbox count, so the app icon's badge can be set by the push itself.
 *
 * 알림함은 **주소**로 나뉩니다(`notices/{주소}`). 여기서는 uid로 읽고 있어서
 * 언제나 빈 객체가 돌아왔고, 배지는 늘 0이었습니다. 조용히 틀린 숫자라
 * 아무도 몰랐습니다.
 */
async function unreadFor(uid: string): Promise<number> {
  const db = initDb()
  const email = (await db.ref(`userProfiles/${uid}/email`).get()).val() as string | null
  if (!email) return 0
  const key = email.toLowerCase().replace(/\./g, ',')
  const snap = await db.ref(`notices/${key}`).get()
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

    /**
     * 같이 일하는 사이일 때만 울립니다.
     *
     * 이 앱에서 남에게 알림이 갈 일은 전부 어떤 프로젝트의 업무 때문입니다 —
     * 담당자 지정, 상태 변경, 마감, 언급. 그 프로젝트를 같이 안 하는 사람에게
     * 보낼 일이 없습니다.
     *
     * 조용히 실패하지 않고 403으로 답합니다. 부르는 쪽은 실패를 삼키게
     * 되어 있지만(알림함에는 이미 들어가 있으니까요), 서버 로그에서 '안
     * 보냈다'와 '못 보냈다'가 같아 보이면 안 됩니다.
     */
    if (!(await sharesProject(caller, toUid))) {
      return void res.status(403).json({ error: 'not a collaborator' })
    }

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
      // **일부러 전부 읽습니다.** 아침 브리핑은 한 사람이 부르는 일이 아니라
      // 모두를 대신해 도는 일이고, 그래서 부르는 사람이 없습니다.
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
