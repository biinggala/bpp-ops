import type { Express, Request, Response } from 'express'
import { getAuth } from 'firebase-admin/auth'
import { initDb } from './store.js'
import { randomBytes } from 'node:crypto'

/**
 * ── 노션 찾기 ────────────────────────────────────────────────────────────────
 *
 * 드라이브는 브라우저가 직접 구글에 묻습니다. 노션은 그럴 수가 없습니다 —
 * 노션 API는 브라우저에서 오는 호출을 CORS로 막아 두었고, 그건 우리가 켤 수
 * 있는 스위치가 아닙니다. 그래서 **이 서버가 대신 묻습니다.**
 *
 * 대신 묻는 순간 생기는 위험이 하나 있습니다: 서버가 남의 노션 열쇠를 들고
 * 있게 됩니다. 그래서 열쇠는 **사람마다 하나씩** 받고(`owner=user`), DB의
 * `notionAuth/{uid}`에 둡니다 — 클라이언트는 그 자리를 아예 못 읽습니다
 * (database.rules.json). 회사 하나에 열쇠 하나를 두면, 그 열쇠를 가진 서버가
 * 한 번만 잘못 걸러도 남의 페이지가 남의 화면에 뜹니다.
 *
 * **찾는 것은 제목입니다.** 노션 검색 API는 제목만 봅니다 — 본문에만 있는
 * 낱말로는 페이지가 안 걸립니다(드라이브와 다른 점입니다). 대신 제목으로
 * 걸린 페이지의 본문에서 그 낱말이 있는 문장을 찾아 붙여 줍니다.
 */

const CLIENT_ID = process.env.NOTION_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.NOTION_CLIENT_SECRET ?? ''
const API = 'https://api.notion.com/v1'
/** 버전은 고정합니다. 노션은 이 헤더로 응답 모양을 정하므로, 안 보내면 거절합니다. */
const VERSION = '2022-06-28'

export function notionConfigured(): boolean {
  return !!CLIENT_ID && !!CLIENT_SECRET
}

/* ── 노션이 주는 것들 (필요한 만큼만) ──────────────────────────────────────── */

interface RichText { plain_text?: string }
interface NotionIcon { type?: string; emoji?: string; external?: { url?: string }; file?: { url?: string } }
interface NotionParent { type?: string; database_id?: string; page_id?: string }
interface NotionTitleProp { type?: string; title?: RichText[] }
interface NotionPage {
  object?: string
  id?: string
  url?: string
  icon?: NotionIcon | null
  parent?: NotionParent
  properties?: Record<string, NotionTitleProp>
  title?: RichText[]
  last_edited_time?: string
  in_trash?: boolean
  archived?: boolean
}

export interface NotionHit {
  id: string
  title: string
  url: string
  /** 어디 아래에 있는 페이지인지. 이름이 같은 페이지가 여럿일 때 이게 구별합니다. */
  parent?: string
  emoji?: string
  editedAt?: string
}

const plain = (rich: RichText[] | undefined): string =>
  (rich ?? []).map(r => r.plain_text ?? '').join('').trim()

/**
 * 페이지 제목.
 *
 * 페이지는 속성 중 `type === 'title'`인 것 하나가 제목이고, 그 속성의 **이름은
 * 데이터베이스마다 다릅니다**('이름', 'Name', '제목'…). 그래서 이름으로 찾지
 * 않고 타입으로 찾습니다. 데이터베이스 자체는 최상위 `title`에 들어 있습니다.
 */
export function titleOf(page: NotionPage): string {
  if (page.title) return plain(page.title) || '제목 없음'
  for (const prop of Object.values(page.properties ?? {})) {
    if (prop?.type === 'title') return plain(prop.title) || '제목 없음'
  }
  return '제목 없음'
}

export function emojiOf(page: NotionPage): string | undefined {
  return page.icon?.type === 'emoji' ? page.icon.emoji : undefined
}

/* ── 노션에 묻기 ───────────────────────────────────────────────────────────── */

async function notion(token: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': VERSION,
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`notion ${res.status}: ${body.slice(0, 300)}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return res.json()
}

/**
 * 부모 이름은 서버가 기억해 둡니다.
 *
 * 검색 결과 열 줄이 전부 같은 데이터베이스 아래일 때가 흔합니다. 그때마다
 * 부모를 다시 물으면 한 번 검색에 요청이 열 번 더 붙습니다. 열쇠(id)를 이미
 * 가진 사람만 그 이름을 보게 되므로 — 남의 검색 결과에서 나온 id를 알 방법이
 * 없습니다 — 사람별로 나눠 담을 이유는 없습니다.
 */
const parentNames = new Map<string, string>()
const PARENT_CACHE_MAX = 500

async function parentName(token: string, parent: NotionParent | undefined): Promise<string | undefined> {
  const id = parent?.type === 'database_id' ? parent.database_id
    : parent?.type === 'page_id' ? parent.page_id
    : undefined
  if (!id) return parent?.type === 'workspace' ? '워크스페이스' : undefined

  const known = parentNames.get(id)
  if (known !== undefined) return known || undefined

  const where = parent?.type === 'database_id' ? `/databases/${id}` : `/pages/${id}`
  try {
    const name = titleOf(await notion(token, where) as NotionPage)
    if (parentNames.size > PARENT_CACHE_MAX) parentNames.clear()
    parentNames.set(id, name)
    return name
  } catch {
    // 못 읽는 부모(권한 밖, 지워짐)는 없는 것으로 둡니다. 다만 **기억은
    // 해 둡니다** — 안 그러면 같은 부모를 검색할 때마다 다시 물어 실패합니다.
    parentNames.set(id, '')
    return undefined
  }
}

export async function searchPages(token: string, query: string, limit = 12): Promise<NotionHit[]> {
  const body = JSON.stringify({
    query,
    page_size: Math.min(30, limit * 2),
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
  })
  const data = await notion(token, '/search', { method: 'POST', body }) as { results?: NotionPage[] }
  const pages = (data.results ?? [])
    .filter(p => !p.in_trash && !p.archived && !!p.id)
    .slice(0, limit)

  return Promise.all(pages.map(async p => ({
    id: p.id!,
    title: titleOf(p),
    url: p.url ?? `https://www.notion.so/${p.id!.replace(/-/g, '')}`,
    parent: await parentName(token, p.parent),
    emoji: emojiOf(p),
    editedAt: p.last_edited_time,
  })))
}

/* ── 본문 한 조각 ──────────────────────────────────────────────────────────── */

interface Block {
  type?: string
  has_children?: boolean
  [key: string]: unknown
}

/** 블록 한 개의 글자. 종류가 스무 개 남짓인데 전부 같은 자리에 `rich_text`를 둡니다. */
function blockText(block: Block): string {
  const body = block[block.type ?? ''] as { rich_text?: RichText[]; title?: string } | undefined
  if (!body) return ''
  if (Array.isArray(body.rich_text)) return plain(body.rich_text)
  return typeof body.title === 'string' ? body.title : ''
}

export interface Passage { before: string; match: string; after: string }

/** 검색어가 있는 자리를 앞뒤 조금과 함께. 드라이브 쪽 `passageIn`과 같은 모양입니다. */
export function passageIn(text: string, term: string, pad = 60): Passage | null {
  const at = text.toLowerCase().indexOf(term.toLowerCase())
  if (at < 0) return null
  const start = Math.max(0, at - pad)
  const end = Math.min(text.length, at + term.length + pad)
  return {
    before: (start > 0 ? '…' : '') + text.slice(start, at),
    match: text.slice(at, at + term.length),
    after: text.slice(at + term.length, end) + (end < text.length ? '…' : ''),
  }
}

/**
 * 페이지 본문에서 검색어가 있는 문장.
 *
 * 한 겹만 읽습니다. 토글이나 표 안까지 따라 들어가면 페이지 하나에 요청이
 * 수십 번 붙고, 그건 사람이 기다려 주는 시간이 아닙니다 — 안 나오면 안
 * 보여 줄 뿐이고, 줄 자체는 제목으로 이미 서 있습니다.
 */
export async function pageSnippet(token: string, pageId: string, term: string): Promise<Passage | null> {
  const data = await notion(token, `/blocks/${pageId}/children?page_size=100`) as { results?: Block[] }
  for (const block of data.results ?? []) {
    const found = passageIn(blockText(block), term)
    if (found) return found
  }
  return null
}

/* ── 열쇠 보관 ─────────────────────────────────────────────────────────────── */

interface StoredAuth {
  accessToken?: string
  workspaceName?: string
  at?: number
}

async function tokenFor(uid: string): Promise<string | null> {
  const snap = await initDb().ref(`notionAuth/${uid}`).get()
  const row = snap.val() as StoredAuth | null
  return row?.accessToken ?? null
}

/** 로그인한 사람이 맞는지. 틀리면 여기서 끝냅니다 — 아래로 uid가 안 내려갑니다. */
async function callerUid(req: Request): Promise<string | null> {
  const header = req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return null
  try {
    return (await getAuth().verifyIdToken(token)).uid
  } catch {
    return null
  }
}

/**
 * 돌아올 때 들고 오는 쪽지.
 *
 * 노션에서 돌아오는 요청에는 로그인 정보가 없습니다 — 브라우저가 노션에서
 * 우리 서버로 곧장 오는 길이라 헤더에 아무것도 안 실립니다. 그래서 **나갈 때
 * 만든 일회용 쪽지**로 누구인지 알아냅니다. 한 번 쓰면 지우고, 10분이 지나면
 * 안 받습니다 — 남아 있는 쪽지는 남의 노션을 내 계정에 붙일 수 있는 종이라서.
 */
const STATE_TTL = 10 * 60_000

function randomState(): string {
  // CSRF 쪽지입니다. 맞히면 남의 노션 계정을 이 사람 자리에 붙일 수 있어서,
  // 여기도 Math.random()은 안 됩니다.
  return randomBytes(24).toString('base64url')
}

export function registerNotionRoutes(app: Express, publicUrl: string): void {
  const redirectUri = new URL('/notion/callback', publicUrl).toString()

  const needsSetup = (res: Response): boolean => {
    if (notionConfigured()) return false
    res.status(503).json({ error: 'notion is not configured' })
    return true
  }

  // 연결 시작 — 주소만 만들어 줍니다. 창은 브라우저(또는 데스크톱 셸)가 엽니다.
  app.post('/notion/start', async (req: Request, res: Response) => {
    if (needsSetup(res)) return
    const uid = await callerUid(req)
    if (!uid) return void res.status(401).json({ error: 'bad token' })

    const state = randomState()
    await initDb().ref(`notionAuth/pending/${state}`).set({ uid, at: Date.now() })

    const url = new URL(`${API}/oauth/authorize`)
    url.searchParams.set('client_id', CLIENT_ID)
    url.searchParams.set('response_type', 'code')
    // owner=user — 회사 하나에 열쇠 하나가 아니라 사람마다 하나.
    url.searchParams.set('owner', 'user')
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('state', state)
    res.json({ url: url.toString() })
  })

  // 노션이 돌려보내는 자리. 사람이 보는 화면이므로 JSON이 아니라 글로 답합니다.
  app.get('/notion/callback', async (req: Request, res: Response) => {
    const { code, state, error } = req.query as Record<string, string | undefined>
    if (error) return void res.status(400).send(page(`노션 연결이 취소되었습니다 (${error})`))
    if (!code || !state) return void res.status(400).send(page('잘못된 요청입니다'))

    const db = initDb()
    const ref = db.ref(`notionAuth/pending/${state}`)
    const pending = (await ref.get()).val() as { uid?: string; at?: number } | null
    await ref.remove().catch(() => {})
    if (!pending?.uid || Date.now() - (pending.at ?? 0) > STATE_TTL) {
      return void res.status(400).send(page('연결 시간이 지났습니다. 앱에서 다시 눌러 주세요.'))
    }

    try {
      const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
      const tokenRes = await fetch(`${API}/oauth/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', 'Notion-Version': VERSION },
        body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
      })
      if (!tokenRes.ok) throw new Error(await tokenRes.text().catch(() => 'token exchange failed'))
      const granted = await tokenRes.json() as {
        access_token?: string; workspace_name?: string; workspace_icon?: string; workspace_id?: string
      }
      if (!granted.access_token) throw new Error('no access token')

      const at = Date.now()
      await db.ref(`notionAuth/${pending.uid}`).set({
        accessToken: granted.access_token,
        workspaceName: granted.workspace_name ?? '',
        workspaceId: granted.workspace_id ?? '',
        at,
      })
      // 열쇠와 달리 **이건 본인이 읽습니다.** 앱은 이 줄이 생기는 것만 보고
      // '연결됐다'로 바뀝니다 — 창을 닫고 돌아왔는지 물어볼 필요가 없습니다.
      await db.ref(`notionLinked/${pending.uid}`).set({
        workspace: granted.workspace_name ?? '',
        icon: granted.workspace_icon ?? '',
        at,
      })
      res.send(page('노션이 연결되었습니다. 이 창을 닫고 앱으로 돌아가세요.', true))
    } catch (e) {
      console.error('[notion]', e instanceof Error ? e.message : e)
      res.status(400).send(page('노션 연결에 실패했습니다. 다시 시도해 주세요.'))
    }
  })

  app.post('/notion/search', async (req: Request, res: Response) => {
    if (needsSetup(res)) return
    const uid = await callerUid(req)
    if (!uid) return void res.status(401).json({ error: 'bad token' })

    const { query, limit } = (req.body ?? {}) as { query?: unknown; limit?: unknown }
    if (typeof query !== 'string' || query.trim().length < 2) return void res.json({ results: [] })

    const token = await tokenFor(uid)
    if (!token) return void res.status(412).json({ error: 'not connected' })

    try {
      const results = await searchPages(token, query.trim(), Math.min(20, Number(limit) || 12))
      res.json({ results })
    } catch (e) {
      const status = (e as { status?: number }).status
      // 노션에서 연동을 끊으면 401이 옵니다. 그건 '오류'가 아니라 '끊긴 것'이라,
      // 앱이 다시 연결하라고 말할 수 있게 자리를 지웁니다.
      if (status === 401) {
        await initDb().ref(`notionLinked/${uid}`).set({ revoked: true, at: Date.now() }).catch(() => {})
        return void res.status(412).json({ error: 'not connected' })
      }
      console.error('[notion]', e instanceof Error ? e.message : e)
      res.status(502).json({ error: 'notion search failed' })
    }
  })

  app.post('/notion/snippets', async (req: Request, res: Response) => {
    if (needsSetup(res)) return
    const uid = await callerUid(req)
    if (!uid) return void res.status(401).json({ error: 'bad token' })

    const { ids, query } = (req.body ?? {}) as { ids?: unknown; query?: unknown }
    if (!Array.isArray(ids) || typeof query !== 'string' || !query.trim()) {
      return void res.json({ snippets: {} })
    }
    const token = await tokenFor(uid)
    if (!token) return void res.status(412).json({ error: 'not connected' })

    // 여섯 개까지. 노션은 초당 세 번 남짓을 넘기면 429로 답하고, 그 벌은
    // 다음 검색까지 이어집니다.
    const wanted = ids.filter((x): x is string => typeof x === 'string').slice(0, 6)
    const term = query.trim()
    const out: Record<string, Passage | null> = {}
    await Promise.all(wanted.map(async id => {
      try { out[id] = await pageSnippet(token, id, term) } catch { out[id] = null }
    }))
    res.json({ snippets: out })
  })

  app.post('/notion/disconnect', async (req: Request, res: Response) => {
    const uid = await callerUid(req)
    if (!uid) return void res.status(401).json({ error: 'bad token' })
    const db = initDb()
    await Promise.all([
      db.ref(`notionAuth/${uid}`).remove(),
      db.ref(`notionLinked/${uid}`).remove(),
    ])
    res.json({ ok: true })
  })

  app.get('/notion/health', (_req, res) => {
    void res.json({ configured: notionConfigured(), redirectUri })
  })
}

/** 사람이 보는 한 장. 스타일시트를 부를 데가 없어서 인라인입니다. */
function page(message: string, ok = false): string {
  const escaped = message.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>노션 연결</title></head>
<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;
font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;background:#f7f7f5;color:#37352f">
<div style="text-align:center;padding:24px;max-width:340px">
<div style="font-size:34px;margin-bottom:12px">${ok ? '✅' : '⚠️'}</div>
<div style="font-size:15px;line-height:1.6">${escaped}</div>
</div>
<script>setTimeout(function(){ try { window.close() } catch (e) {} }, ${ok ? 1500 : 6000})</script>
</body></html>`
}
