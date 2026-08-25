import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickOrg } from '../.test-build/lib/pickOrg.js'

const BPP = 'org-bpp'      // 도메인(@bpp.co.kr)이 가리키는 곳
const MINE = 'org-mine'    // 내가 따로 만든 곳
const GUEST = 'org-guest'  // 게스트로 초대만 받은 곳 — 멤버 목록에 없습니다

const base = {
  preferred: null,
  prefsSeen: true,
  fromDomain: BPP,
  fromIndex: BPP,
  ids: [BPP, MINE],
}

test('고른 곳이 도메인보다 앞선다', () => {
  assert.equal(pickOrg({ ...base, preferred: MINE }), MINE)
})

test('고른 적 없으면 도메인이 가리키는 곳', () => {
  assert.equal(pickOrg(base), BPP)
})

// ── 켤 때 회사 프로젝트가 번쩍이던 것 ────────────────────────────────────────
//
// 설정(userPrefs)도 데이터베이스에서 옵니다. 도메인 색인이 먼저 오므로, 그
// 사이에 판단하면 도메인이 가리키는 곳에 **진짜로 한 번 붙습니다.** 새
// 워크스페이스에 서 있는 사람은 그때 회사 프로젝트를 봅니다. 걸러도 소용이
// 없습니다 — 그 순간에는 거기가 맞으니까요.

test('고른 곳이 아직 안 왔으면 아무 데도 안 붙는다', () => {
  assert.equal(pickOrg({ ...base, prefsSeen: false }), null)
  // 도메인도 색인도 답을 갖고 있지만 그래도 안 붙습니다.
  assert.equal(pickOrg({ ...base, prefsSeen: false, fromDomain: BPP, fromIndex: MINE }), null)
})

test('설정이 온 뒤에는 고른 곳으로 간다', () => {
  const booting = { ...base, prefsSeen: false, preferred: null }
  assert.equal(pickOrg(booting), null)
  assert.equal(pickOrg({ ...booting, prefsSeen: true, preferred: MINE }), MINE)
})

test('안 온 것과 고른 적 없는 것은 다르다', () => {
  // 둘 다 preferred는 null입니다. 구별하지 못해서 번쩍였습니다.
  assert.equal(pickOrg({ ...base, preferred: null, prefsSeen: false }), null)
  assert.equal(pickOrg({ ...base, preferred: null, prefsSeen: true }), BPP)
})

test('내가 멤버가 아닌 곳에는 안 붙는다', () => {
  // 게스트로 그곳에 붙으면 회의실도 공개 목록도 못 읽어서 화면이 오류로
  // 채워집니다. 고른 값이 그것이어도 안 됩니다.
  assert.equal(pickOrg({ ...base, preferred: GUEST }), BPP)
  assert.equal(pickOrg({ ...base, preferred: GUEST, fromDomain: null, fromIndex: null }), null)
})

test('목록이 아직 비어 있으면 안 붙는다', () => {
  // 조직 목록도 비동기입니다. 첫 바퀴는 늘 비어 있고, 여기서 도메인에
  // 붙으면 멤버인지 한 번도 안 묻고 남의 워크스페이스에 붙습니다.
  assert.equal(pickOrg({ ...base, ids: [] }), null)
})
