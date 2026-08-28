// Persistence for the OAuth authorization server.
//
// Deliberately stored under a top-level `mcpAuth/` node rather than inside
// `cringe/`. The database rules grant every authenticated user read access to
// the whole `cringe` subtree, so tokens placed there would be readable by anyone
// who can open the web app. `mcpAuth/` is denied to all clients in
// database.rules.json; the Admin SDK bypasses rules, so only this server sees it.
//
// Tokens are stored under a SHA-256 of their value, so a leaked dump of this
// node still cannot be replayed against the server.

import { createHash, randomBytes } from 'node:crypto'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import { initDb } from '../store.js'

const ROOT = 'mcpAuth'

/**
 * ── 값이 없는 칸은 아예 빼고 씁니다 ─────────────────────────────────────────
 *
 * 실시간 DB는 `undefined`를 못 받습니다. 하나라도 섞여 있으면 쓰기 전체가
 * 거절됩니다 — `value argument contains undefined in property '…'`.
 *
 * **등록이 여기서 막혔습니다.** 커넥터가 비밀 없는 클라이언트(PKCE)로
 * 등록하면 SDK가 만드는 객체에 `client_secret: undefined`와
 * `client_secret_expires_at: undefined`가 그대로 들어 있습니다. 비밀을 쓰는
 * 클라이언트는 그 자리에 값이 있어서 아무 문제가 없었고, 그래서 잘 되다가
 * 어느 날 '로그인 서비스에 등록할 수 없습니다'가 됩니다 — **우리가 아무것도
 * 안 바꿔도** 저쪽이 등록하는 방식이 바뀌면요.
 *
 * 없는 것은 없는 대로 씁니다. 빈 문자열로 채우면 '비밀이 없는 클라이언트'와
 * '비밀이 빈 클라이언트'가 같아지고, 그건 검사하는 쪽이 헷갈릴 자리입니다.
 */
export function withoutBlanks<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutBlanks) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = withoutBlanks(v)
    return out as T
  }
  return value
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ── Registered clients (Dynamic Client Registration) ────────────────────────

export async function saveClient(client: OAuthClientInformationFull): Promise<void> {
  await initDb().ref(`${ROOT}/clients/${client.client_id}`).set(withoutBlanks(client))
}

export async function loadClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
  const snap = await initDb().ref(`${ROOT}/clients/${clientId}`).get()
  return (snap.val() as OAuthClientInformationFull | null) ?? undefined
}

// ── Pending authorizations (user is away at Google) ──────────────────────────

export interface PendingAuth {
  clientId: string
  redirectUri: string
  codeChallenge: string
  state?: string
  scopes: string[]
  resource?: string
  createdAt: number
}

export async function savePending(key: string, value: PendingAuth): Promise<void> {
  await initDb().ref(`${ROOT}/pending/${key}`).set(withoutBlanks(value))
}

export async function takePending(key: string): Promise<PendingAuth | undefined> {
  const ref = initDb().ref(`${ROOT}/pending/${key}`)
  const snap = await ref.get()
  const value = snap.val() as PendingAuth | null
  if (value) await ref.remove()
  return value ?? undefined
}

// ── Authorization codes ──────────────────────────────────────────────────────

export interface AuthCode {
  clientId: string
  email: string
  redirectUri: string
  codeChallenge: string
  scopes: string[]
  resource?: string
  expiresAt: number
}

export async function saveCode(code: string, value: AuthCode): Promise<void> {
  await initDb().ref(`${ROOT}/codes/${hash(code)}`).set(withoutBlanks(value))
}

export async function peekCode(code: string): Promise<AuthCode | undefined> {
  const snap = await initDb().ref(`${ROOT}/codes/${hash(code)}`).get()
  return (snap.val() as AuthCode | null) ?? undefined
}

/** Authorization codes are single-use: consuming one removes it. */
export async function takeCode(code: string): Promise<AuthCode | undefined> {
  const ref = initDb().ref(`${ROOT}/codes/${hash(code)}`)
  const snap = await ref.get()
  const value = snap.val() as AuthCode | null
  if (value) await ref.remove()
  return value ?? undefined
}

// ── Access / refresh tokens ──────────────────────────────────────────────────

export interface TokenRecord {
  clientId: string
  email: string
  scopes: string[]
  expiresAt: number // seconds since epoch
  kind: 'access' | 'refresh'
}

export async function saveToken(token: string, value: TokenRecord): Promise<void> {
  await initDb().ref(`${ROOT}/tokens/${hash(token)}`).set(withoutBlanks(value))
}

export async function loadToken(token: string): Promise<TokenRecord | undefined> {
  const snap = await initDb().ref(`${ROOT}/tokens/${hash(token)}`).get()
  return (snap.val() as TokenRecord | null) ?? undefined
}

export async function deleteToken(token: string): Promise<void> {
  await initDb().ref(`${ROOT}/tokens/${hash(token)}`).remove()
}
