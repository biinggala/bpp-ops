#!/usr/bin/env node
// Loads a migrated database into the emulator under database.rules.json
// and checks that every project opens for exactly the people it should.
//
//   firebase emulators:exec --only database --project demo-verify \
//     --config firebase.test.json "node scripts/verify-migration.mjs <migrated.json>"
//
// The migration report proves nothing was dropped. This proves the result is
// reachable by its owners and by nobody else, which is the part that actually
// breaks if a members entry or an invite code is wrong.

import { readFileSync } from 'node:fs'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { ref, get, set } from 'firebase/database'

const file = process.argv[2]
if (!file) {
  console.error('사용법: node scripts/verify-migration.mjs <migrated.json>')
  process.exit(2)
}

const data = JSON.parse(readFileSync(file, 'utf8'))
const STRANGER = 'uid-stranger-not-a-member'

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-verify',
  database: {
    host: '127.0.0.1',
    port: 9000,
    rules: readFileSync('database.rules.json', 'utf8'),
  },
})

await testEnv.clearDatabase()
await testEnv.withSecurityRulesDisabled(async ctx => {
  await set(ref(ctx.database(), '/'), data)
})

const canRead = async (uid, path) => {
  try {
    await get(ref(testEnv.authenticatedContext(uid, { email: `${uid}@example.com` }).database(), path))
    return true
  } catch { return false }
}

const failures = []
const projects = data.projects ?? {}
let memberChecks = 0

for (const [pid, project] of Object.entries(projects)) {
  const members = Object.keys(project.members ?? {})
  const name = project.meta?.name ?? pid

  if (!members.length) {
    failures.push(`${name}: 멤버가 없어 아무도 열 수 없습니다`)
    continue
  }
  for (const uid of members) {
    memberChecks++
    if (!await canRead(uid, `projects/${pid}`)) failures.push(`${name}: 멤버 ${uid}가 열지 못합니다`)
  }
  if (await canRead(STRANGER, `projects/${pid}`)) failures.push(`${name}: 남남이 열 수 있습니다`)

  // The rules require a member's stored value to equal the project's code, so a
  // mismatch here would block the next person who tries to join by invite.
  const code = project.meta?.inviteCode
  for (const [uid, value] of Object.entries(project.members ?? {})) {
    if (value !== code) failures.push(`${name}: ${uid}의 멤버 값이 초대코드와 다릅니다`)
  }
}

// Everyone's project list must name only projects they are actually in.
for (const [uid, entry] of Object.entries(data.userIndex ?? {})) {
  for (const pid of Object.keys(entry.projects ?? {})) {
    if (!projects[pid]) { failures.push(`${uid}의 목록에 없는 프로젝트 ${pid}가 있습니다`); continue }
    if (!(uid in (projects[pid].members ?? {}))) failures.push(`${uid}가 멤버가 아닌 ${pid}를 목록에 갖고 있습니다`)
  }
}

for (const [uid] of Object.entries(data.personalTasks ?? {})) {
  if (!await canRead(uid, `personalTasks/${uid}`)) failures.push(`${uid}가 자기 개인 업무를 열지 못합니다`)
  if (await canRead(STRANGER, `personalTasks/${uid}`)) failures.push(`${uid}의 개인 업무를 남남이 열 수 있습니다`)
}

if (await canRead(STRANGER, 'projects')) failures.push('프로젝트 목록 전체가 열립니다')
if (await canRead(STRANGER, 'cringe')) failures.push('보존해 둔 옛 데이터가 열립니다')

console.log(`프로젝트 ${Object.keys(projects).length}개 · 멤버 접근 확인 ${memberChecks}건 · 개인 업무 소유자 ${Object.keys(data.personalTasks ?? {}).length}명`)
if (failures.length) {
  console.log('\n✗ 문제:')
  failures.forEach(f => console.log(`  - ${f}`))
} else {
  console.log('\n✓ 모든 프로젝트가 멤버에게만 열립니다')
}

await testEnv.cleanup()
process.exit(failures.length ? 1 : 0)
