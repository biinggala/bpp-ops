import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sharedCandidates } from '../dist/push.js'

// ── 폰을 울릴 수 있는 사이인가 ───────────────────────────────────────────────
//
// 이 검사가 없어서, 로그인만 했으면 uid를 아는 아무에게나 아무 문구로 푸시를
// 보낼 수 있었습니다. 여기서는 후보를 좁히는 첫 단계만 봅니다 - 정말 둘 다
// 멤버인지는 프로젝트 명단에 다시 물어봅니다(색인은 그 사람이 자기 손으로
// 쓰는 자리라 혼자서는 근거가 못 됩니다).

test('같이 있는 프로젝트만 후보가 된다', () => {
  const mine = { p1: true, p2: true, p3: true }
  const theirs = { p2: true, p9: true }
  assert.deepEqual(sharedCandidates(mine, theirs), ['p2'])
})

test('겹치는 게 없으면 후보도 없다', () => {
  assert.deepEqual(sharedCandidates({ p1: true }, { p2: true }), [])
})

test('색인이 아직 안 왔거나 비어 있으면 후보가 없다', () => {
  // 빈 것과 안 온 것이 여기서는 같은 답이어야 합니다 - 모르면 안 보냅니다.
  // 다른 자리들과 반대 방향입니다: 보여 주는 일은 늦는 편이 낫고, 보내는
  // 일은 아예 안 하는 편이 낫습니다.
  assert.deepEqual(sharedCandidates(null, { p1: true }), [])
  assert.deepEqual(sharedCandidates({ p1: true }, null), [])
  assert.deepEqual(sharedCandidates(undefined, undefined), [])
  assert.deepEqual(sharedCandidates({}, { p1: true }), [])
})

test('값이 무엇이든 키만 본다', () => {
  // 색인에는 소속(orgId)이 적혀 있기도 하고 true이기도 합니다. 둘 다 '그
  // 프로젝트에 있다'는 같은 뜻입니다.
  assert.deepEqual(sharedCandidates({ p1: 'org-a' }, { p1: true }), ['p1'])
})
