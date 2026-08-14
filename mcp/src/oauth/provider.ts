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
  loadClient,
  loadToken,
  peekCode,
  randomToken,
  saveClient,
  saveCode,
  savePending,
  saveToken,
  takeCode,
  takePending,
  type PendingAuth,
} from './store.js'

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

  /** Parks the client's request and sends the user to Google. */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const key = randomToken()
    const pending: PendingAuth = {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scopes: params.scopes ?? [],
      createdAt: Date.now(),
      ...(params.state ? { state: params.state } : {}),
      ...(params.resource ? { resource: params.resource.toString() } : {}),
    }
    await savePending(key, pending)

    const url = new URL(GOOGLE_AUTH)
    url.searchParams.set('client_id', this.cfg.clientId)
    url.searchParams.set('redirect_uri', googleRedirectUri(this.cfg))
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'openid email profile')
    url.searchParams.set('prompt', 'select_account')
    // Our own correlation handle; Google returns it untouched.
    url.searchParams.set('state', key)
    res.redirect(url.toString())
  }

  /**
   * Completes the Google leg and issues our authorization code.
   * Returns the URL to send the user back to.
   */
  async handleGoogleCallback(googleCode: string, key: string): Promise<string> {
    const pending = await takePending(key)
    if (!pending) throw new Error('authorization request expired or already used')

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
