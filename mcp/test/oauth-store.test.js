import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withoutBlanks } from '../dist/oauth/store.js'

/**
 * 비밀 없는 클라이언트(PKCE)로 등록할 때 SDK가 넘겨주는 그 모양입니다.
 * 실시간 DB는 undefined가 하나라도 있으면 쓰기 전체를 거절하고, 그러면
 * 등록이 500으로 끝납니다 — 커넥터에는 '로그인 서비스에 등록할 수 없습니다'로
 * 보입니다.
 */
const publicClient = {
  client_name: 'Claude',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  token_endpoint_auth_method: 'none',
  client_secret: undefined,
  client_secret_expires_at: undefined,
  client_id: 'abc',
  client_id_issued_at: 1,
}

test('값이 없는 칸은 키째로 빠집니다', () => {
  const clean = withoutBlanks(publicClient)
  // 있는지 없는지가 아니라, 키 자체가 없어야 합니다 — undefined인 키가 남아
  // 있으면 DB는 그걸 그대로 거절합니다.
  assert.equal('client_secret' in clean, false)
  assert.equal('client_secret_expires_at' in clean, false)
  assert.equal(JSON.stringify(Object.values(clean)).includes('undefined'), false)
})

test('있는 값은 그대로 둡니다', () => {
  const clean = withoutBlanks({ ...publicClient, client_secret: 'shh', client_secret_expires_at: 0 })
  assert.equal(clean.client_secret, 'shh')
  // 0과 빈 문자열은 '없는 값'이 아닙니다.
  assert.equal(clean.client_secret_expires_at, 0)
  assert.deepEqual(clean.redirect_uris, ['https://claude.ai/api/mcp/auth_callback'])
})

test('중첩된 것도 훑습니다', () => {
  const clean = withoutBlanks({ a: { b: undefined, c: 1 }, d: [{ e: undefined, f: 2 }] })
  assert.deepEqual(clean, { a: { c: 1 }, d: [{ f: 2 }] })
})
