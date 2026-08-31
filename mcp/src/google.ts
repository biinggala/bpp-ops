import type { Express, Request, Response } from 'express'
import { getAuth } from 'firebase-admin/auth'
import { initDb } from './store.js'
import { randomBytes } from 'node:crypto'

/**
 * ── 구글 열쇠를 서버가 보관합니다 ────────────────────────────────────────────
 *
 * 브라우저가 받는 구글 토큰은 **한 시간짜리**입니다. 그리고 브라우저는 그걸
 * 갱신할 열쇠(refresh token)를 가질 수 없습니다 — 그 열쇠는 클라이언트 비밀을
 * 쥔 쪽만 바꿔 쓸 수 있고, 비밀을 브라우저에 두면 그건 비밀이 아닙니다.
 *
 * 그래서 지금까지는 한 시간마다 구글에 '조용히' 다시 물었습니다. 그 조용한
 * 갱신은 **구글 세션이 살아 있고 브라우저가 허락할 때만** 됩니다. 사파리와
 * 아이폰은 그 자리를 막습니다. 그러면 사람에게는 '재연동' 단추만 보입니다 —
 * 아무것도 안 했는데 몇 시간마다 다시 연결해야 하는 앱이 됩니다.
 *
 * **여기서는 이 서버가 그 열쇠를 듭니다.** 노션과 같은 방식입니다:
 *
 *   googleAuth/{uid}    열쇠. 규칙이 모든 클라이언트에게 닫아 둡니다.
 *   googleLinked/{uid}  '연결됨'과 허락받은 범위. 본인만 읽습니다.
 *
 * 한 번 연결하면 노트북에서도 폰에서도 데스크톱 앱에서도 됩니다 — 열쇠가
 * 기기가 아니라 사람에게 붙어 있으니까요.
 *
 * ── 필요한 만큼만, 대신 쌓아서 ──────────────────────────────────────────────
 *
 * 캘린더만 켜는 사람에게 지메일까지 한꺼번에 물어보지 않습니다. 켜는 그것만
 * 묻되(`include_granted_scopes`), 구글이 돌려주는 열쇠는 **그때까지 허락한
 * 전부**를 덮습니다. 그래서 두 번째 연동은 한 번 더 누르는 것으로 끝나고,
 * 그 뒤로는 둘 다 조용합니다.
 */

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? ''

export const googleLinkCallbackPath = '/google/callback'

/** 쪽지는 10분. 남아 있는 쪽지는 남의 구글을 내 자리에 붙일 수 있는 종이입니다. */
const STATE_TTL = 10 * 60_000

export function googleLinkConfigured(): boolean {
  return !!CLIENT_ID && !!CLIENT_SECRET
}

/* ── 범위를 다루는 값 계산 ─────────────────────────────────────────────────── */

/** 띄어쓰기로 이어진 범위 글자를 낱개로. 빈 칸과 중복은 버립니다. */
export function scopeList(scope: string | null | undefined): string[] {
  return [...new Set((scope ?? '').split(/\s+/).filter(Boolean))].sort()
}

/** 들고 있는 열쇠가 원하는 범위를 다 덮는가. */
export function coversScope(granted: string | null | undefined, wanted: string): boolean {
  const has = new Set(scopeList(granted))
  const need = scopeList(wanted)
  return need.length > 0 && need.every(s => has.has(s))
}

/** 이미 허락받은 것 + 이번에 허락받은 것. 구글이 주는 것과 같은 뜻입니다. */
export function mergeScopes(a: string | null | undefined, b: string | null | undefined): string {
  return [...new Set([...scopeList(a), ...scopeList(b)])].sort().join(' ')
}

/* ── 보관 ──────────────────────────────────────────────────────────────────── */

interface StoredGrant {
  refreshToken?: string
  scope?: string
  at?: number
}

async function grantFor(uid: string): Promise<StoredGrant | null> {
  const snap = await initDb().ref(`googleAuth/${uid}`).get()
  return (snap.val() as StoredGrant | null) ?? null
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
 * 열쇠를 토큰으로 바꿉니다.
 *
 * 한 시간마다 한 번이면 될 일이라 **메모리에 잠깐 담아 둡니다.** 인스턴스가
 * 죽으면 같이 사라지는데, 그건 한 번 더 물어보면 그만입니다 — 열쇠는 DB에
 * 있습니다.
 */
const minted = new Map<string, { token: string; until: number }>()

async function accessToken(uid: string, refreshToken: string): Promise<{ token: string; expiresIn: number }> {
  const held = minted.get(uid)
  // 30초 여유를 둡니다. 딱 맞춰 주면 받아 든 순간 만료된 토큰일 수 있습니다.
  if (held && held.until - 30_000 > Date.now()) {
    return { token: held.token, expiresIn: Math.floor((held.until - Date.now()) / 1000) }
  }

  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`google token ${res.status}: ${body.slice(0, 200)}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  const json = await res.json() as { access_token?: string; expires_in?: number }
  if (!json.access_token) throw new Error('google returned no access token')
  const expiresIn = json.expires_in ?? 3600
  minted.set(uid, { token: json.access_token, until: Date.now() + expiresIn * 1000 })
  return { token: json.access_token, expiresIn }
}

export function registerGoogleRoutes(app: Express, publicUrl: string): void {
  const redirectUri = new URL(googleLinkCallbackPath, publicUrl).toString()

  const needsSetup = (res: Response): boolean => {
    if (googleLinkConfigured()) return false
    res.status(503).json({ error: 'google link is not configured' })
    return true
  }

  // 연결 시작 — 주소만 만들어 줍니다. 창은 브라우저(또는 데스크톱 셸)가 엽니다.
  app.post('/google/start', async (req: Request, res: Response) => {
    if (needsSetup(res)) return
    const uid = await callerUid(req)
    if (!uid) return void res.status(401).json({ error: 'bad token' })

    const { scope, email } = (req.body ?? {}) as { scope?: unknown; email?: unknown }
    const want = scopeList(typeof scope === 'string' ? scope : '')
    if (!want.length) return void res.status(400).json({ error: 'scope is required' })

    const state = randomBytes(24).toString('base64url')
    await initDb().ref(`googleAuth/pending/${state}`).set({ uid, at: Date.now() })

    const url = new URL(GOOGLE_AUTH)
    url.searchParams.set('client_id', CLIENT_ID)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', want.join(' '))
    // 열쇠를 받는 유일한 방법입니다. prompt=consent 가 없으면 두 번째부터
    // 구글이 열쇠를 안 주고, 그러면 이 서버는 갱신할 수단이 없습니다.
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    // 이미 허락한 것 위에 얹습니다 — 캘린더를 켠 사람이 드라이브를 켤 때
    // 캘린더까지 다시 허락하지 않아도 됩니다.
    url.searchParams.set('include_granted_scopes', 'true')
    if (typeof email === 'string' && email) url.searchParams.set('login_hint', email)
    url.searchParams.set('state', state)
    res.json({ url: url.toString() })
  })

  // 구글이 돌려보내는 자리. 사람이 보는 화면이므로 JSON이 아니라 글로 답합니다.
  app.get(googleLinkCallbackPath, async (req: Request, res: Response) => {
    const { code, state, error } = req.query as Record<string, string | undefined>
    if (error) return void res.status(400).send(page(`구글 연결이 취소되었습니다 (${error})`))
    if (!code || !state) return void res.status(400).send(page('잘못된 요청입니다'))

    const db = initDb()
    const ref = db.ref(`googleAuth/pending/${state}`)
    const pending = (await ref.get()).val() as { uid?: string; at?: number } | null
    await ref.remove().catch(() => {})
    if (!pending?.uid || Date.now() - (pending.at ?? 0) > STATE_TTL) {
      return void res.status(400).send(page('연결 시간이 지났습니다. 앱에서 다시 눌러 주세요.'))
    }

    try {
      const tokenRes = await fetch(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      })
      if (!tokenRes.ok) throw new Error(await tokenRes.text().catch(() => 'token exchange failed'))
      const granted = await tokenRes.json() as { refresh_token?: string; scope?: string; access_token?: string }

      /*
        열쇠가 안 왔습니다. 같은 사람이 같은 앱을 다시 허락하면 구글이 열쇠를
        생략할 때가 있습니다(이미 준 적이 있으므로). prompt=consent 를 늘 붙여
        막고 있지만, 그래도 안 왔으면 **들고 있던 것을 지우지 않습니다** —
        지우면 멀쩡히 되던 연동이 이 한 번으로 끊깁니다.
      */
      const before = await grantFor(pending.uid)
      const refreshToken = granted.refresh_token ?? before?.refreshToken
      if (!refreshToken) throw new Error('no refresh token')

      const scope = mergeScopes(before?.scope, granted.scope)
      const at = Date.now()
      await db.ref(`googleAuth/${pending.uid}`).set({ refreshToken, scope, at })
      // 열쇠와 달리 **이건 본인이 읽습니다.** 앱은 이 줄을 보고 '연결됨'으로
      // 바뀝니다 — 창을 닫고 돌아왔는지 물어볼 필요가 없습니다.
      await db.ref(`googleLinked/${pending.uid}`).set({ scope, at })
      minted.delete(pending.uid)
      res.send(page('구글이 연결되었습니다. 이 창을 닫고 앱으로 돌아가세요.', true))
    } catch (e) {
      console.error('[google]', e instanceof Error ? e.message : e)
      res.status(400).send(page('구글 연결에 실패했습니다. 다시 시도해 주세요.'))
    }
  })

  /**
   * 한 시간짜리 토큰 한 장.
   *
   * 앱이 구글에 직접 물을 때 쓰는 그 토큰입니다. 여기서 주는 것과 브라우저가
   * 직접 받던 것은 같은 물건이라, 앱의 나머지는 아무것도 안 바뀝니다.
   */
  app.post('/google/token', async (req: Request, res: Response) => {
    if (needsSetup(res)) return
    const uid = await callerUid(req)
    if (!uid) return void res.status(401).json({ error: 'bad token' })

    const { scope } = (req.body ?? {}) as { scope?: unknown }
    const want = typeof scope === 'string' ? scope : ''
    if (!scopeList(want).length) return void res.status(400).json({ error: 'scope is required' })

    const grant = await grantFor(uid)
    if (!grant?.refreshToken) return void res.status(412).json({ error: 'not connected' })
    // 허락받지 않은 범위를 달라고 하면 **없다고 답합니다.** 여기서 아무 토큰이나
    // 주면 앱은 연결된 줄 알고 구글에서 403을 받습니다 — 고칠 자리가 어딘지
    // 아무도 모르는 실패입니다.
    if (!coversScope(grant.scope, want)) return void res.status(412).json({ error: 'scope not granted' })

    try {
      const { token, expiresIn } = await accessToken(uid, grant.refreshToken)
      res.json({ token, expiresIn })
    } catch (e) {
      const status = (e as { status?: number }).status
      /*
        400/401은 열쇠가 죽은 것입니다(사람이 구글 설정에서 앱을 지웠거나,
        비밀번호를 바꿨거나). 그건 오류가 아니라 '끊긴 것'이라, 자리를 비우고
        앱이 다시 연결하라고 말할 수 있게 합니다.
      */
      if (status === 400 || status === 401) {
        const db = initDb()
        await db.ref(`googleAuth/${uid}`).remove().catch(() => {})
        await db.ref(`googleLinked/${uid}`).set({ revoked: true, at: Date.now() }).catch(() => {})
        minted.delete(uid)
        return void res.status(412).json({ error: 'not connected' })
      }
      console.error('[google]', e instanceof Error ? e.message : e)
      res.status(502).json({ error: 'google token failed' })
    }
  })

  /**
   * 연동을 끕니다.
   *
   * **범위 하나만 끄는 것도 됩니다.** 화면에서는 캘린더·드라이브·메일이 각각
   * 스위치라, 드라이브를 껐는데 서버가 계속 드라이브 열쇠를 들고 있으면 그건
   * 사람이 본 것과 다릅니다. 남은 범위가 없으면 열쇠째 지웁니다.
   */
  app.post('/google/disconnect', async (req: Request, res: Response) => {
    const uid = await callerUid(req)
    if (!uid) return void res.status(401).json({ error: 'bad token' })
    const db = initDb()
    minted.delete(uid)

    const { scope } = (req.body ?? {}) as { scope?: unknown }
    const drop = scopeList(typeof scope === 'string' ? scope : '')
    const grant = drop.length ? await grantFor(uid) : null
    const left = grant ? scopeList(grant.scope).filter(s => !drop.includes(s)) : []

    if (left.length) {
      await db.ref(`googleAuth/${uid}/scope`).set(left.join(' '))
      await db.ref(`googleLinked/${uid}`).set({ scope: left.join(' '), at: Date.now() })
      return void res.json({ ok: true, scope: left.join(' ') })
    }

    await Promise.all([
      db.ref(`googleAuth/${uid}`).remove(),
      db.ref(`googleLinked/${uid}`).remove(),
    ])
    res.json({ ok: true, scope: '' })
  })

  app.get('/google/health', (_req, res) => {
    void res.json({ configured: googleLinkConfigured(), redirectUri })
  })
}

/** 사람이 보는 한 장. 노션 쪽과 같은 모양입니다. */
function page(message: string, ok = false): string {
  const escaped = message.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>구글 연결</title></head>
<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;
font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;background:#f7f7f5;color:#37352f">
<div style="text-align:center;padding:24px;max-width:340px">
<div style="font-size:34px;margin-bottom:12px">${ok ? '✅' : '⚠️'}</div>
<div style="font-size:15px;line-height:1.6">${escaped}</div>
</div>
<script>setTimeout(function(){ try { window.close() } catch (e) {} }, ${ok ? 1500 : 6000})</script>
</body></html>`
}
