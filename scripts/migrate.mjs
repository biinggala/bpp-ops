#!/usr/bin/env node
// Converts a Realtime Database JSON export from the old single-blob layout to
// the per-project layout described in docs/data-model.md.
//
//   node scripts/migrate.mjs <export.json> --out <migrated.json>
//
// Runs entirely on files. It never connects to Firebase, so it cannot touch
// production; the export is taken and the result uploaded through the console.
//
// Options:
//   --out <path>            where to write the converted database
//   --orphan-owner <email>  who to hand tasks whose creator cannot be resolved
//   --drop-legacy           omit the original `cringe` node from the output
//
// The old `cringe` node is copied through untouched by default. Importing at
// the database root replaces everything, so dropping it would delete the only
// copy still living in Firebase during the rollback window. Nothing can read it
// under the new rules — it is dormant, not reachable.

import { readFileSync, writeFileSync } from 'node:fs'

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** RTDB stores these as arrays, but sparse writes can turn them into objects. */
export function toList(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (value && typeof value === 'object') return Object.values(value).filter(Boolean)
  return []
}

/** Firebase keys cannot contain '.', so addresses are stored with commas. */
export function emailKey(email) {
  return String(email).toLowerCase().replace(/\./g, ',')
}

const lower = e => String(e ?? '').trim().toLowerCase()

/** Invite codes gate self-service joining, and the rules require 6+ chars. */
function newInviteCode(seed) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (seed.charCodeAt(i) + ((h << 5) - h)) | 0
  return `mig${Math.abs(h).toString(36).padStart(6, '0')}`.slice(0, 12)
}

/* ── migration ───────────────────────────────────────────────────────────── */

export function migrate(source, options = {}) {
  const { orphanOwner = null, keepLegacy = true } = options
  const legacy = source.cringe ?? {}
  const report = {
    counts: { in: {}, out: {} },
    pendingInvites: [],
    projectsWithoutMembers: [],
    generatedInviteCodes: [],
    orphanTasks: [],
    orphanMilestones: [],
    duplicateIds: [],
    notes: [],
  }

  // Who is who. userProfiles is the only place tying an address to an account
  // id, and it only has people who have signed in at least once.
  const profiles = legacy.userProfiles ?? {}
  const uidByEmail = new Map()
  for (const [uid, profile] of Object.entries(profiles)) {
    const email = lower(profile?.email)
    if (!email) continue
    if (uidByEmail.has(email) && uidByEmail.get(email) !== uid) {
      report.notes.push(`이메일 ${email}에 계정이 둘 이상입니다 (${uidByEmail.get(email)}, ${uid}). 먼저 로그인한 쪽을 씁니다.`)
      continue
    }
    uidByEmail.set(email, uid)
  }

  const projects = toList(legacy.projects)
  const tasks = toList(legacy.tasks)
  const milestones = toList(legacy.milestones)
  const spaces = toList(legacy.spaces)

  report.counts.in = {
    projects: projects.length,
    tasks: tasks.length,
    milestones: milestones.length,
    spaces: spaces.length,
    userProfiles: Object.keys(profiles).length,
  }

  const seen = new Set()
  const flagDuplicate = (kind, id) => {
    const key = `${kind}:${id}`
    if (seen.has(key)) { report.duplicateIds.push(key); return true }
    seen.add(key)
    return false
  }

  const out = {
    projects: {},
    userIndex: {},
    invitesByEmail: {},
    personalTasks: {},
    spaces: {},
    userProfiles: profiles,
  }
  if (source.presence) out.presence = source.presence
  if (source.mcpAuth) out.mcpAuth = source.mcpAuth
  if (keepLegacy && source.cringe) out.cringe = source.cringe

  /* projects ------------------------------------------------------------- */
  const projectById = new Map()
  for (const project of projects) {
    if (!project?.id || flagDuplicate('project', project.id)) continue
    const pid = project.id
    projectById.set(pid, project)

    let inviteCode = project.inviteCode
    if (typeof inviteCode !== 'string' || inviteCode.length < 6) {
      inviteCode = newInviteCode(pid)
      report.generatedInviteCodes.push({ pid, name: project.name, inviteCode })
    }

    const { id: _id, inviteCode: _code, memberEmails, pendingEmails, ...rest } = project
    const meta = { id: pid, ...rest, inviteCode }
    // The team layer is only reserved for now — see docs/data-model.md.
    if (meta.teamId === undefined) meta.teamId = null

    const members = {}
    const invited = new Set()
    const addresses = new Set([
      ...toList(memberEmails).map(lower),
      ...toList(pendingEmails).map(lower),
      ...(project.creatorEmail ? [lower(project.creatorEmail)] : []),
    ].filter(Boolean))

    for (const email of addresses) {
      const uid = uidByEmail.get(email)
      if (uid) {
        members[uid] = inviteCode
        out.userIndex[uid] ??= { projects: {} }
        out.userIndex[uid].projects[pid] = true
      } else {
        // Never signed in, so there is no account to grant. Leave the invite
        // waiting for them; the app claims it on their first login.
        invited.add(email)
        out.invitesByEmail[emailKey(email)] ??= {}
        out.invitesByEmail[emailKey(email)][pid] = inviteCode
        report.pendingInvites.push({ pid, name: project.name, email })
      }
    }

    if (!Object.keys(members).length) {
      report.projectsWithoutMembers.push({ pid, name: project.name, invited: [...invited] })
    }

    out.projects[pid] = { meta, members, tasks: {}, milestones: {} }
  }

  /* milestones ------------------------------------------------------------ */
  for (const milestone of milestones) {
    if (!milestone?.id || flagDuplicate('milestone', milestone.id)) continue
    const target = out.projects[milestone.projectId]
    if (!target) { report.orphanMilestones.push(milestone); continue }
    target.milestones[milestone.id] = milestone
  }

  /* tasks ----------------------------------------------------------------- */
  for (const task of tasks) {
    if (!task?.id || flagDuplicate('task', task.id)) continue

    if (task.projectId && out.projects[task.projectId]) {
      out.projects[task.projectId].tasks[task.id] = task
      continue
    }
    if (task.projectId && !out.projects[task.projectId]) {
      // Points at a project that no longer exists.
      report.orphanTasks.push({ task, reason: `프로젝트 ${task.projectId} 없음` })
      continue
    }

    // No project: a personal task, owned by whoever created it.
    const owner = uidByEmail.get(lower(task.createdBy)) ?? uidByEmail.get(lower(orphanOwner))
    if (!owner) {
      report.orphanTasks.push({ task, reason: task.createdBy ? `생성자 ${task.createdBy}의 계정 없음` : '생성자 정보 없음' })
      continue
    }
    out.personalTasks[owner] ??= {}
    out.personalTasks[owner][task.id] = task
  }

  /* spaces ---------------------------------------------------------------- */
  for (const space of spaces) {
    if (!space?.id || flagDuplicate('space', space.id)) continue
    out.spaces[space.id] = space
  }

  if (legacy.savedAt !== undefined) {
    report.notes.push('savedAt은 옮기지 않았습니다. 새 구조는 전체 덮어쓰기를 하지 않으므로 더 이상 쓰이지 않습니다.')
  }

  const projectTaskCount = Object.values(out.projects).reduce((n, p) => n + Object.keys(p.tasks).length, 0)
  const personalTaskCount = Object.values(out.personalTasks).reduce((n, t) => n + Object.keys(t).length, 0)
  report.counts.out = {
    projects: Object.keys(out.projects).length,
    tasksInProjects: projectTaskCount,
    personalTasks: personalTaskCount,
    orphanTasks: report.orphanTasks.length,
    milestones: Object.values(out.projects).reduce((n, p) => n + Object.keys(p.milestones).length, 0),
    orphanMilestones: report.orphanMilestones.length,
    spaces: Object.keys(out.spaces).length,
    pendingInvites: report.pendingInvites.length,
  }

  // Every task must land somewhere. A mismatch means the migration lost data,
  // which is the one failure mode that must never pass silently.
  const accounted = projectTaskCount + personalTaskCount + report.orphanTasks.length
  const uniqueTasks = report.counts.in.tasks - report.duplicateIds.filter(d => d.startsWith('task:')).length
  report.balanced = accounted === uniqueTasks
  if (!report.balanced) {
    report.notes.push(`업무 수가 맞지 않습니다: 입력 ${uniqueTasks}건, 배치 ${accounted}건.`)
  }

  return { data: out, report }
}

/* ── report ──────────────────────────────────────────────────────────────── */

export function formatReport(report) {
  const L = []
  const section = (title, rows) => { if (rows.length) { L.push('', title); rows.forEach(r => L.push(`  - ${r}`)) } }

  L.push('입력:')
  for (const [k, v] of Object.entries(report.counts.in)) L.push(`  ${k}: ${v}`)
  L.push('', '출력:')
  for (const [k, v] of Object.entries(report.counts.out)) L.push(`  ${k}: ${v}`)

  L.push('', report.balanced ? '✓ 업무 건수 일치 — 유실 없음' : '✗ 업무 건수 불일치 — 진행하지 마세요')

  section('대기 중인 초대 (아직 로그인한 적 없는 사람):',
    report.pendingInvites.map(p => `${p.email} → ${p.name ?? p.pid}`))
  section('⚠ 멤버가 한 명도 없는 프로젝트 (아무도 열 수 없음):',
    report.projectsWithoutMembers.map(p => `${p.name ?? p.pid}${p.invited.length ? ` (초대 대기: ${p.invited.join(', ')})` : ''}`))
  section('초대코드를 새로 만든 프로젝트:',
    report.generatedInviteCodes.map(p => `${p.name ?? p.pid} → ${p.inviteCode}`))
  section('⚠ 주인을 찾지 못한 업무 (옮기지 않음):',
    report.orphanTasks.map(o => `${o.task.name ?? o.task.id} — ${o.reason}`))
  section('⚠ 주인을 찾지 못한 마일스톤 (옮기지 않음):',
    report.orphanMilestones.map(m => `${m.name ?? m.id} (projectId: ${m.projectId})`))
  section('중복 id:', report.duplicateIds)
  section('참고:', report.notes)

  return L.join('\n')
}

/* ── cli ─────────────────────────────────────────────────────────────────── */

function main(argv) {
  const args = argv.slice(2)
  const input = args.find(a => !a.startsWith('--'))
  const valueOf = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

  if (!input) {
    console.error('사용법: node scripts/migrate.mjs <export.json> --out <migrated.json> [--orphan-owner <email>] [--drop-legacy]')
    process.exit(2)
  }

  const source = JSON.parse(readFileSync(input, 'utf8'))
  const { data, report } = migrate(source, {
    orphanOwner: valueOf('--orphan-owner') ?? null,
    keepLegacy: !args.includes('--drop-legacy'),
  })

  const outPath = valueOf('--out')
  if (outPath) {
    writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n')
    console.log(`새 데이터를 ${outPath}에 썼습니다.\n`)
  }
  console.log(formatReport(report))
  if (!report.balanced) process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv)
