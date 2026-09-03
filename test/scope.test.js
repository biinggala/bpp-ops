import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ── 워크스페이스 경계는 눈으로 지킬 수 없습니다 ──────────────────────────────
 *
 * 같은 구멍이 반복해서 났습니다. 목록은 갈라 놓고 숫자만 스토어를 직접 읽거나,
 * 새 화면 하나가 `useProjectStore(s => s.projects)`로 시작하거나. 그 목록은
 * **내가 속한 모든 워크스페이스**의 프로젝트라, 늘어놓거나 세는 순간 다른
 * 회사의 이름과 자료와 사람 주소가 화면에 섭니다.
 *
 * 사람이 매번 알아채는 것에 기대는 대신, 그 줄을 쓰는 파일을 여기 적게 합니다.
 * 새로 쓰는 사람은 둘 중 하나를 해야 합니다 — 거른 목록(useVisibleProjects)을
 * 쓰거나, 왜 거르지 않아도 되는지를 여기 한 줄로 적거나.
 *
 * 적어도 되는 경우는 사실상 셋뿐입니다:
 *   - id 하나로 집기(`projects.find(p => p.id === …)`) — 이미 보이는 것의 이름·색
 *   - 그 스토어의 **동작**만 꺼내 쓰기(addProject, updateProject…)
 *   - 워크스페이스를 가르기 전 단계(부팅·이사·초대 처리)
 * 늘어놓거나 세는 자리는 예외가 없습니다.
 */
const ALLOWED = new Map([
  ['src/hooks/useVisibleProjects.ts', '거르는 함수 자신'],
  ['src/pages/AppPage.tsx', '부팅·이사·초대 — 워크스페이스를 가르기 전 단계'],
  ['src/components/layout/Sidebar.tsx', 'id로 하나 집기(초대 링크·멤버 관리). 세는 자리는 accessibleProjects'],
  ['src/components/layout/Topbar.tsx', 'id로 지금 열린 프로젝트 하나'],
  ['src/components/layout/Notices.tsx', 'id로 알림에 적힌 프로젝트 하나. 거르는 일은 useVisibleNotices'],
  ['src/components/shared/DriveFiles.tsx', 'id로 지금 열린 프로젝트 하나'],
  ['src/components/shared/EmptyState.tsx', 'id로 지금 열린 프로젝트 하나의 이름'],
  ['src/components/views/stats/index.tsx', 'id→프로젝트 색인. 세는 것은 useFilteredTasks가 이미 거른 업무'],
  ['src/components/views/today/TaskRef.tsx', 'id로 그 업무의 프로젝트 하나'],
  ['src/hooks/useInviteAssign.ts', '초대 처리 — 아직 그 워크스페이스에 서 있지 않습니다'],
  ['src/components/modals/SettingsModal.tsx', '지금 조직의 목록과 교집합만 냅니다'],
])

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(path)
  }
  return out
}

test('거르지 않은 프로젝트 목록을 읽는 파일은 여기 적힌 것뿐입니다', () => {
  const offenders = []
  for (const path of sources('src')) {
    const text = readFileSync(path, 'utf8')
    // `filters.projects`(고른 필터 값)는 다른 것입니다.
    const reads = text.split('\n').some(line =>
      /\bs\.projects\b/.test(line) && !/filters\.projects/.test(line))
    if (reads && !ALLOWED.has(path)) offenders.push(path)
  }
  assert.deepEqual(offenders, [], offenders.length
    ? `거른 목록(useVisibleProjects)을 쓰거나, 왜 안 걸러도 되는지 test/scope.test.js의 ALLOWED에 적으세요:\n  ${offenders.join('\n  ')}`
    : '')
})

test('적어 둔 파일이 사라지면 목록도 같이 지웁니다', () => {
  // 안 쓰는 예외가 남아 있으면, 다음 사람은 그 자리를 '허락된 것'으로 읽습니다.
  const stale = [...ALLOWED.keys()].filter(path => {
    try { return !/\bs\.projects\b/.test(readFileSync(path, 'utf8')) } catch { return true }
  })
  assert.deepEqual(stale, [])
})
