import { test } from 'node:test'
import assert from 'node:assert/strict'
import { visibleProjects } from '../.test-build/lib/visibleProjects.js'

// 워크스페이스를 전환했을 때 사이드바·업무 목록·찾기·가져올 것이 무엇을
// 내놓는지. 세 번 틀린 자리라 값만 받는 함수로 떼어 놓고 여기서 못 박습니다.

const BPP = 'org-bpp'
const OTHER = 'org-other'
const GUEST = 'org-guest'

const P = (id, orgId) => ({ id, name: id, color: '#000', ...(orgId ? { orgId } : {}) })

const ALL = [
  P('loose'),            // 소속 없음 — 워크스페이스가 생기기 전에 만든 것
  P('bpp1', BPP),
  P('other1', OTHER),    // 내가 멤버인 다른 워크스페이스
  P('guest1', GUEST),    // 게스트로 초대받은 남의 회사
]

const names = ps => ps.map(p => p.id).sort()

const settled = extra => ({
  orgId: BPP,
  myOrgs: [{ id: BPP }, { id: OTHER }],
  ready: true,
  preferred: BPP,
  prefsReady: true,
  ...extra,
})

test('전환하면 내 다른 워크스페이스 것만 숨는다', () => {
  assert.deepEqual(names(visibleProjects(ALL, settled())), ['bpp1', 'guest1', 'loose'])
  assert.deepEqual(names(visibleProjects(ALL, settled({ orgId: OTHER }))), ['guest1', 'loose', 'other1'])
})

test('게스트로 들어간 남의 워크스페이스 프로젝트는 어디에 서 있든 보인다', () => {
  // 나는 GUEST에 '설' 수 없습니다(전환 목록에 안 뜹니다). 여기서 숨기면
  // 외부 협업자가 자기 화면에서 그 프로젝트를 영영 잃습니다.
  for (const orgId of [BPP, OTHER]) {
    assert.ok(names(visibleProjects(ALL, settled({ orgId }))).includes('guest1'))
  }
})

test('소속 없는 프로젝트는 어느 경우에도 안 숨는다', () => {
  const cases = [
    settled(),
    settled({ orgId: OTHER }),
    { orgId: null, myOrgs: [], ready: false, preferred: null, prefsReady: false },
    { orgId: null, myOrgs: [], ready: false, preferred: BPP, prefsReady: true },
    { orgId: null, myOrgs: [], ready: true, preferred: null, prefsReady: true },
  ]
  for (const s of cases) assert.ok(names(visibleProjects(ALL, s)).includes('loose'), JSON.stringify(s))
})

// ── 켤 때 번쩍이던 것 ────────────────────────────────────────────────────────
//
// 이 셋이 앱을 켠 직후의 순간들입니다. 프로젝트는 이미 다 왔는데 '내가 어디에
// 서 있는지'는 아직 오는 중입니다. 여기서 다 보여 주면 다른 워크스페이스의
// 프로젝트가 떴다가 사라집니다.

test('아무것도 모를 때는 소속 찍힌 것을 하나도 안 내놓는다', () => {
  const booting = { orgId: null, myOrgs: [], ready: false, preferred: null, prefsReady: false }
  assert.deepEqual(names(visibleProjects(ALL, booting)), ['loose'])
})

test('고른 곳만 알면 그곳 것까지 내놓는다', () => {
  // 설정 한 줄이 조직 목록보다 먼저 옵니다. 그때부터는 내 워크스페이스가
  // 늦지 않게 서고, 남의 것은 여전히 안 섭니다.
  const s = { orgId: null, myOrgs: [], ready: false, preferred: BPP, prefsReady: true }
  assert.deepEqual(names(visibleProjects(ALL, s)), ['bpp1', 'loose'])
})

test('고른 적 없는 사람도 소속 찍힌 것은 기다린다', () => {
  // prefsReady인데 preferred가 null — 한 번도 전환한 적 없는 사람입니다.
  // 잠깐 비어 보이지만, 조직 목록이 오면 자기 것이 섭니다.
  const s = { orgId: null, myOrgs: [], ready: false, preferred: null, prefsReady: true }
  assert.deepEqual(names(visibleProjects(ALL, s)), ['loose'])
})

test('설정이 안 온 것과 고른 적 없는 것을 구별한다', () => {
  // 둘 다 preferred는 null입니다. 구별하지 못해서 번쩍였습니다.
  const notArrived = { orgId: null, myOrgs: [], ready: false, preferred: null, prefsReady: false }
  const neverPicked = { orgId: null, myOrgs: [], ready: false, preferred: null, prefsReady: true }
  // 지금은 둘 다 보류라 결과가 같습니다. 다른 것은 orgId가 있을 때입니다 —
  // 붙은 곳이 있으면 설정을 안 기다립니다.
  assert.deepEqual(names(visibleProjects(ALL, notArrived)), ['loose'])
  assert.deepEqual(names(visibleProjects(ALL, neverPicked)), ['loose'])
  const attached = { ...notArrived, orgId: BPP }
  assert.deepEqual(names(visibleProjects(ALL, attached)), ['bpp1', 'loose'])
})

test('워크스페이스가 하나뿐이면 아무것도 안 숨는다', () => {
  const s = { orgId: BPP, myOrgs: [{ id: BPP }], ready: true, preferred: BPP, prefsReady: true }
  assert.deepEqual(names(visibleProjects(ALL, s)), ['bpp1', 'guest1', 'loose', 'other1'])
})
