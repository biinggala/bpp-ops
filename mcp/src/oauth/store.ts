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

export function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ── Registered clients (Dynamic Client Registration) ────────────────────────

export async function saveClient(client: OAuthClientInformationFull): Promise<void> {
  await initDb().ref(`${ROOT}/clients/${client.client_id}`).set(client)
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
  await initDb().ref(`${ROOT}/pending/${key}`).set(value)
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
  await initDb().ref(`${ROOT}/codes/${hash(code)}`).set(value)
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
  await initDb().ref(`${ROOT}/tokens/${hash(token)}`).set(value)
}

export async function loadToken(token: string): Promise<TokenRecord | undefined> {
  const snap = await initDb().ref(`${ROOT}/tokens/${hash(token)}`).get()
  return (snap.val() as TokenRecord | null) ?? undefined
}

export async function deleteToken(token: string): Promise<void> {
  await initDb().ref(`${ROOT}/tokens/${hash(token)}`).remove()
}
