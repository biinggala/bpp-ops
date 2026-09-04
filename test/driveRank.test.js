import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshness, rankFiles, scoreOf } from '../.test-build/lib/driveRank.js'

const NOW = Date.parse('2026-09-04T00:00:00Z')
const daysAgo = n => new Date(NOW - n * 86_400_000).toISOString()
const ctx = (extra = {}) => ({ now: NOW, term: '버킷리스트', ...extra })

test('최근일수록 크고, 서서히 내려갑니다', () => {
  assert.equal(freshness(daysAgo(0), NOW, 30), 1)
  assert.ok(Math.abs(freshness(daysAgo(30), NOW, 30) - 0.5) < 0.001)
  assert.ok(freshness(daysAgo(180), NOW, 30) < 0.02)
  // 한 번도 안 연 파일은 0입니다 — 오래된 것이 아니라 없는 것입니다.
  assert.equal(freshness(undefined, NOW, 30), 0)
  assert.equal(freshness('그냥 글자', NOW, 30), 0)
})

test('이번 주 내내 연 파일이 반년 전 파일보다 위', () => {
  // 사용자가 실제로 본 화면입니다: '버킷리스트'를 쳤더니 지난 시즌 체크리스트가
  // 위에 서고, 이번 화 문서는 스크롤을 내려야 나왔습니다.
  const old = { id: 'a', name: '1화 72소 시즌2 체크리스트_홍콩', modifiedTime: daysAgo(200), viewedByMeTime: daysAgo(190) }
  const now = { id: 'b', name: '3화 포포 체크리스트_부다페스트', modifiedTime: daysAgo(2), viewedByMeTime: daysAgo(1) }
  assert.deepEqual(rankFiles([old, now], ctx()).map(f => f.id), ['b', 'a'])
})

test('지금 서 있는 프로젝트 폴더 안의 것이 앞', () => {
  const outside = { id: 'out', name: '버킷리스트 정리', modifiedTime: daysAgo(10) }
  const inside = { id: 'in', name: '버킷리스트 정리', modifiedTime: daysAgo(10), parents: ['F'] }
  assert.deepEqual(rankFiles([outside, inside], ctx({ folderIds: ['F'] })).map(f => f.id), ['in', 'out'])
})

test('이름에 걸린 것이 내용에 걸린 것보다 앞 — 아무리 최근이어도', () => {
  const byName = { id: 'name', name: '버킷리스트 30개', modifiedTime: daysAgo(120) }
  const byText = { id: 'text', name: '엔딩노트', modifiedTime: daysAgo(0), viewedByMeTime: daysAgo(0), contentMatch: true }
  const order = rankFiles([byText, byName], ctx()).map(f => f.id)
  assert.equal(order[0], 'name')
})

test('점수가 같으면 구글이 준 순서 그대로', () => {
  const a = { id: 'a', name: 'x' }
  const b = { id: 'b', name: 'x' }
  assert.equal(scoreOf(a, ctx()), scoreOf(b, ctx()))
  assert.deepEqual(rankFiles([a, b], ctx()).map(f => f.id), ['a', 'b'])
})

test('옛 파일이 사라지지는 않습니다 — 순서만 뒤로', () => {
  const files = [
    { id: 'old1', name: '버킷리스트 2024', modifiedTime: daysAgo(400) },
    { id: 'new', name: '버킷리스트 30개', modifiedTime: daysAgo(1), viewedByMeTime: daysAgo(1) },
    { id: 'old2', name: '버킷리스트 시즌1', modifiedTime: daysAgo(300) },
  ]
  const out = rankFiles(files, ctx())
  assert.equal(out.length, 3)
  assert.equal(out[0].id, 'new')
})
