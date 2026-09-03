import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cookieHeader, readCookie } from '../dist/oauth/cookie.js'

test('쿠키 한 장을 이름으로 찾습니다', () => {
  assert.equal(readCookie('a=1; mcp_authz=abc%3Ddef; b=2', 'mcp_authz'), 'abc=def')
  assert.equal(readCookie('a=1', 'mcp_authz'), null)
  assert.equal(readCookie(undefined, 'x'), null)
})

test('만드는 쿠키는 HttpOnly·Lax이고, 공개 주소면 Secure', () => {
  const h = cookieHeader('mcp_authz', 'v', { maxAge: 600, path: '/oauth', secure: true })
  assert.match(h, /^mcp_authz=v; Max-Age=600; Path=\/oauth; HttpOnly; SameSite=Lax; Secure$/)
  assert.doesNotMatch(cookieHeader('c', 'v', { maxAge: 1, path: '/', secure: false }), /Secure/)
})
