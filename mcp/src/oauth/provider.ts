// OAuth 2.1 authorization server for the MCP endpoint.
//
// claude.ai and Claude Desktop connect to remote MCP servers over OAuth with
// Dynamic Client Registration, so a bearer token in a header is not an option —
// the server has to be a real authorization server. The MCP SDK supplies the
// endpoints (/authorize, /token, /register, /revoke, metadata); this module
// supplies the logic behind them.
//
// Identity is delegated to Google, which the team already signs in with. The
// flow is: Claude → /authorize → Google → /oauth/google/callback → back to
// Claude with our own authorization code. The email Google verifies becomes the
// Ctx.email that every tool is scoped to, which is what makes the access control
// in access.ts meaningful for a shared server.

import type { Response } from 'express'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import {
  deleteToken,
  hashValue,
  loadClient,
  loadToken,
  markConsented,
  peekCode,
  peekPending,
  randomToken,
  saveClient,
  saveCode,
  savePending,
  saveToken,
  takeCode,
  takePending,
  PENDING_TTL_MS,
  type PendingAuth,
} from './store.js'
import { cookieHeader } from './cookie.js'

/** 로그인 요청을 시작한 브라우저를 표시하는 쿠키. 콜백은 같은 브라우저에서만. */
export const AUTHZ_COOKIE = 'mcp_authz'
export const consentPath = '/oauth/consent'

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'

const CODE_TTL_MS = 10 * 60 * 1000
const ACCESS_TTL_S = 60 * 60
const REFRESH_TTL_S = 30 * 24 * 60 * 60

export interface GoogleConfig {
  clientId: string
  clientSecret: string
  /** Public base URL of this server, e.g. https://mcp.example.com */
  publicUrl: string
}

export const googleCallbackPath = '/oauth/google/callback'

function googleRedirectUri(cfg: GoogleConfig): string {
  return new URL(googleCallbackPath, cfg.publicUrl).toString()
}

class ClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string) {
    return loadClient(clientId)
  }
  async registerClient(client: OAuthClientInformationFull) {
    await saveClient(client)
    return client
  }
}

export class GoogleBackedProvider implements OAuthServerProvider {
  private readonly store = new ClientsStore()

  constructor(
    private readonly cfg: GoogleConfig,
    /** Rejects sign-ins from people with no footing in the workspace. */
    private readonly isAllowed: (email: string) => Promise<boolean>
  ) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return this.store
  }

  /**
   * ── 요청을 세워 두고, 먼저 **누가 어디로** 받는지 보여 줍니다 ────────────
   *
   * 예전에는 바로 구글로 보냈습니다. 그런데 클라이언트 등록은 누구나 할 수
   * 있고(DCR), 구글 화면에는 우리 앱 이름만 뜹니다. 그래서 누군가 자기
   * 주소로 돌아오는 클라이언트를 등록하고 그 구글 링크를 동료에게 보내면
   * — "커넥터 다시 연결해 주세요" — 동료가 계정을 한 번 고르는 순간 그
   * 사람 몫의 토큰이 공격자 주소로 갔습니다.
   *
   * 두 겹으로 막습니다.
   * 1. **동의 화면.** 어느 클라이언트가, 어느 주소로 돌아가는지 적고 사람이
   *    누릅니다. 낯선 주소면 여기서 멈춥니다.
   * 2. **브라우저 묶기.** 시작한 브라우저에 쿠키를 심고 그 해시를 요청에
   *    적습니다. 콜백은 같은 쿠키가 있어야 끝납니다 — 링크를 복사해 남에게
   *    넘겨도 그 사람 브라우저에는 이 쿠키가 없습니다.
   */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const key = randomToken()
    const nonce = randomToken()
    const pending: PendingAuth = {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scopes: params.scopes ?? [],
      createdAt: Date.now(),
      bind: hashValue(nonce),
      ...(params.state ? { state: params.state } : {}),
      ...(params.resource ? { resource: params.resource.toString() } : {}),
    }
    await savePending(key, pending)

    res.setHeader('Set-Cookie', cookieHeader(AUTHZ_COOKIE, nonce, {
      maxAge: Math.floor(PENDING_TTL_MS / 1000), path: '/oauth', secure: this.cfg.publicUrl.startsWith('https://'),
    }))
    res.setHeader('Cache-Control', 'no-store')
    res.type('html').send(consentPage({
      clientName: client.client_name ?? '이름 없는 클라이언트',
      redirectUri: params.redirectUri,
      key,
    }))
  }

  /**
   * 동의 화면에서 '계속'을 눌렀습니다. 쿠키가 맞으면 구글로 보냅니다.
   * Returns the Google URL, or null when the request is unknown or from another browser.
   */
  async continueToGoogle(key: string, cookieNonce: string | null): Promise<string | null> {
    const pending = await peekPending(key)
    if (!pending || !cookieNonce || pending.bind !== hashValue(cookieNonce)) return null
    await markConsented(key)

    const url = new URL(GOOGLE_AUTH)
    url.searchParams.set('client_id', this.cfg.clientId)
    url.searchParams.set('redirect_uri', googleRedirectUri(this.cfg))
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'openid email profile')
    url.searchParams.set('prompt', 'select_account')
    // Our own correlation handle; Google returns it untouched.
    url.searchParams.set('state', key)
    return url.toString()
  }

  /**
   * Completes the Google leg and issues our authorization code.
   * Returns the URL to send the user back to.
   */
  async handleGoogleCallback(googleCode: string, key: string, cookieNonce: string | null): Promise<string> {
    const pending = await takePending(key)
    if (!pending) throw new Error('authorization request expired or already used')
    // 시작한 브라우저가 아니거나, 동의 화면을 거치지 않은 요청입니다.
    if (!pending.consented || !cookieNonce || pending.bind !== hashValue(cookieNonce)) {
      throw new Error('authorization request was started in another browser')
    }

    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      code: googleCode,
      grant_type: 'authorization_code',
      redirect_uri: googleRedirectUri(this.cfg),
    })
    const res = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`)
    const json = (await res.json()) as { id_token?: string }
    if (!json.id_token) throw new Error('Google returned no id_token')

    // The token came straight from Google's token endpoint over TLS in a
    // server-to-server call, so per OIDC it can be trusted without re-verifying
    // the signature. Only the claims are read.
    const email = readEmailClaim(json.id_token)
    if (!email) throw new Error('Google id_token carried no verified email')

    if (!(await this.isAllowed(email))) {
      return redirectWithError(pending, 'access_denied', 'not a member of any project')
    }

    const code = randomToken()
    await saveCode(code, {
      clientId: pending.clientId,
      email,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      scopes: pending.scopes,
      expiresAt: Date.now() + CODE_TTL_MS,
      ...(pending.resource ? { resource: pending.resource } : {}),
    })

    const back = new URL(pending.redirectUri)
    back.searchParams.set('code', code)
    if (pending.state) back.searchParams.set('state', pending.state)
    return back.toString()
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const record = await peekCode(authorizationCode)
    if (!record) throw new Error('invalid authorization code')
    return record.codeChallenge
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string, // PKCE is validated by the SDK against challengeForAuthorizationCode
    redirectUri?: string
  ): Promise<OAuthTokens> {
    const record = await takeCode(authorizationCode)
    if (!record) throw new Error('invalid or already-used authorization code')
    if (record.expiresAt < Date.now()) throw new Error('authorization code expired')
    if (record.clientId !== client.client_id) throw new Error('authorization code was issued to another client')
    if (redirectUri && redirectUri !== record.redirectUri) throw new Error('redirect_uri mismatch')

    return this.issueTokens(client.client_id, record.email, record.scopes)
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[]
  ): Promise<OAuthTokens> {
    const record = await loadToken(refreshToken)
    if (!record || record.kind !== 'refresh') throw new Error('invalid refresh token')
    if (record.expiresAt * 1000 < Date.now()) throw new Error('refresh token expired')
    if (record.clientId !== client.client_id) throw new Error('refresh token was issued to another client')

    await deleteToken(refreshToken) // rotate
    return this.issueTokens(client.client_id, record.email, scopes ?? record.scopes)
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = await loadToken(token)
    if (!record || record.kind !== 'access') throw new Error('invalid access token')
    if (record.expiresAt * 1000 < Date.now()) throw new Error('access token expired')
    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
      // How the request handler learns whose data it may touch.
      extra: { email: record.email },
    }
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await deleteToken(request.token)
  }

  private async issueTokens(clientId: string, email: string, scopes: string[]): Promise<OAuthTokens> {
    const now = Math.floor(Date.now() / 1000)
    const accessToken = randomToken()
    const refreshToken = randomToken()

    await saveToken(accessToken, { clientId, email, scopes, expiresAt: now + ACCESS_TTL_S, kind: 'access' })
    await saveToken(refreshToken, { clientId, email, scopes, expiresAt: now + REFRESH_TTL_S, kind: 'refresh' })

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_S,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    }
  }
}

function readEmailClaim(idToken: string): string | null {
  const payload = idToken.split('.')[1]
  if (!payload) return null
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    email?: string
    email_verified?: boolean | string
  }
  if (!claims.email) return null
  // Google marks unverified addresses; refuse those outright.
  if (claims.email_verified === false || claims.email_verified === 'false') return null
  return claims.email.toLowerCase()
}

function redirectWithError(pending: PendingAuth, error: string, description: string): string {
  const url = new URL(pending.redirectUri)
  url.searchParams.set('error', error)
  url.searchParams.set('error_description', description)
  if (pending.state) url.searchParams.set('state', pending.state)
  return url.toString()
}

function esc(v: string): string {
  return v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

/**
 * 동의 화면. 짧고, 두 가지만 말합니다 — 누가, 어디로.
 *
 * 돌아가는 주소는 호스트만 크게 적습니다. 사람이 볼 것은 'claude.ai인가'지
 * 경로가 아닙니다. 전체 주소는 그 아래 작게 둡니다.
 */
function consentPage(input: { clientName: string; redirectUri: string; key: string }): string {
  let host = input.redirectUri
  try { host = new URL(input.redirectUri).host } catch { /* 등록 때 검사된 주소라 여기 올 일은 없습니다 */ }
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>bpp-ops 연결</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI",sans-serif;background:#f6f5f2;color:#1f1f1f;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{background:#fff;border:1px solid #e6e3dc;border-radius:12px;padding:28px 28px 24px;max-width:420px;width:calc(100% - 32px);box-shadow:0 8px 30px rgba(0,0,0,.06)}
h1{font-size:18px;margin:0 0 14px}p{font-size:14px;line-height:1.6;margin:0 0 10px;color:#3d3d3d}
.who{font-weight:600;color:#1f1f1f}.host{font-weight:600}.uri{font-size:11.5px;color:#8a877f;word-break:break-all;margin-top:-4px}
button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:8px;background:#2383E2;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
.small{font-size:12px;color:#8a877f;margin-top:12px}
</style></head><body><main>
<h1>bpp-ops에 연결</h1>
<p><span class="who">${esc(input.clientName)}</span>이(가) 내 업무·프로젝트에 접근하려고 합니다.</p>
<p>로그인이 끝나면 <span class="host">${esc(host)}</span>로 돌아갑니다.</p>
<p class="uri">${esc(input.redirectUri)}</p>
<form method="post" action="${consentPath}"><input type="hidden" name="key" value="${esc(input.key)}"><button type="submit">Google 계정으로 계속</button></form>
<p class="small">이 주소를 모르겠거나 직접 시작한 연결이 아니면 이 창을 닫으세요.</p>
</main></body></html>`
}
