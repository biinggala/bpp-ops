// ── 어제 못 끝낸 것 ──────────────────────────────────────────────────────────
//
// 데일리 노트는 날짜마다 하나고, 날이 바뀌면 빈 종이로 시작합니다. 그게 이
// 화면에서 제일 좋은 점이고, 동시에 구멍이었습니다 — 어제 3시에 적어 둔
// '세금계산서 발행'에 체크를 안 했으면 오늘 아침 화면 어디에도 그게 없습니다.
// 기억해서 다시 적어야 했습니다.
//
// **저절로 옮기지는 않습니다.** 그러면 3주 미룬 할 일이 매일 아침 화면 맨 위에
// 서고, 사람은 곧 그 줄을 안 보게 됩니다. 미뤄지는 일이 미뤄진다는 사실조차
// 안 보이게 되는 것이 제일 나쁩니다.
//
// 그래서 **말해 주기만** 합니다. 회색 한 줄로 몇 개인지 알리고, 누르면 목록이
// 펴지고, 가져올 것을 골라서 넣습니다. 접혀 있는 동안 빈 도화지는 그대로고,
// 한 글자라도 적기 시작하면 이 줄은 사라집니다.

import { useEffect, useMemo, useState } from 'react'
import { get as fbGet, ref } from 'firebase/database'
import type { Editor } from '@tiptap/react'
import { db } from '../../../lib/firebase'
import { P } from '../../../lib/paths'
import { useAuthStore } from '../../../store/authStore'
import { useTaskStore } from '../../../store/taskStore'
import { useVisibleProjects } from '../../../hooks/useVisibleProjects'
import { useProjectStore } from '../../../store/projectStore'
import { fmtYMD } from '../../../lib/utils'

/** 며칠 전까지 거슬러 볼 것인가. 주말과 연휴를 건너뛸 만큼. */
const LOOK_BACK = 7

/**
 * 콘솔의 `bpp()`가 같이 내놓는 진단값.
 *
 * 이 목록이 무엇을 왜 내놓는지 밖에서 볼 방법이 없어서, 안 고쳐지는 이유를
 * 짐작으로만 좁히고 있었습니다. 여기에는 **거르기 전의 모든 줄**과 각 줄이
 * 남거나 빠진 이유가 그대로 들어갑니다.
 */
export const carryDebug: { last: unknown } = { last: null }

interface Carryable {
  key: string
  kind: 'todo' | 'task'
  /** 화면에 보이는 말. 업무는 이름, 할 일은 그 줄의 글자. */
  label: string
  taskId?: string
  /**
   * 어느 프로젝트의 업무인가.
   *
   * 이름만 있으면 어제 적은 '수정 요청'이 어느 일인지 알 수가 없습니다 —
   * 팔레트에 담긴 곳을 적어 준 것과 같은 이유입니다. 그리고 여기 선 것이
   * 정말 지금 워크스페이스의 것인지도 이 줄이 답합니다.
   */
  project?: { name: string; color: string }
}

/** 노트에 사람이 적은 것이 하나라도 있는가. */
export function noteHasContent(html: string): boolean {
  if (!html) return false
  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (doc.querySelector('[data-task-ref], [data-drive-id], li')) return true
  return (doc.body.textContent ?? '').trim().length > 0
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

/**
 * 안 끝난 줄을 **적힌 순서대로** 뽑습니다.
 *
 * 두 종류뿐입니다: 안 눌린 체크박스와, 완료가 아닌 업무 참조. 문단은 안
 * 가져옵니다 — 회의 메모 한 줄은 오늘 할 일이 아니고, 그걸 같이 옮기면
 * 목록이 금세 아무 말도 안 하게 됩니다. 사이드바 숫자가 세는 것과 같은
 * 두 가지입니다(count.ts).
 */
function parseCarryables(html: string, statusOf: (id: string) => string | null): Carryable[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out: Carryable[] = []
  // 선택자를 합쳐서 한 번에 훑으면 문서에 적힌 순서가 그대로 유지됩니다.
  doc.body.querySelectorAll('li[data-checked="false"], div[data-task-ref]').forEach((el, i) => {
    if (el.tagName === 'LI') {
      const label = (el.textContent ?? '').trim()
      if (label) out.push({ key: `todo:${i}`, kind: 'todo', label })
      return
    }
    const taskId = el.getAttribute('data-task-id')
    if (!taskId) return
    const status = statusOf(taskId)
    // 지워졌거나 이미 끝난 업무는 안 가져옵니다. 남이 끝내 준 것도 포함입니다.
    if (!status || status === '완료') return
    // 이름은 부르는 쪽이 채웁니다 — 노트에는 id만 저장돼 있고, 이름이
    // 바뀌었으면 지금 이름으로 보여야 합니다.
    out.push({ key: `task:${taskId}`, kind: 'task', label: '', taskId })
  })
  return out
}

function dayLabelFor(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const then = new Date(y, m - 1, d)
  const today = new Date()
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - then.getTime()) / 86400000)
  if (days === 1) return '어제'
  return `${['일', '월', '화', '수', '목', '금', '토'][then.getDay()]}요일`
}

export function CarryOver({ editor }: { editor: Editor | null }) {
  const email = useAuthStore(s => s.email)
  const tasks = useTaskStore(s => s.tasks)
  const visibleProjects = useVisibleProjects()
  const [source, setSource] = useState<{ date: string; html: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [done, setDone] = useState(false)

  const today = fmtYMD(new Date())
  const dismissKey = `bpp_carry_${today}`

  useEffect(() => {
    if (!email || localStorage.getItem(dismissKey)) return
    let cancelled = false
    void (async () => {
      // 가장 가까운 '노트가 있는 날' 하나만 봅니다. 주말을 건너뛰되, 지난
      // 일주일을 통째로 긁어모으지는 않습니다 — 그건 목록이 아니라 무덤입니다.
      for (let back = 1; back <= LOOK_BACK; back++) {
        const d = new Date()
        d.setDate(d.getDate() - back)
        const date = fmtYMD(d)
        const snap = await fbGet(ref(db, P.dailyNote(email, date))).catch(() => null)
        const html = (snap?.val() as { html?: string } | null)?.html
        if (!html || !noteHasContent(html)) continue
        if (!cancelled) setSource({ date, html })
        return
      }
    })()
    return () => { cancelled = true }
  }, [email, today])

  /**
   * ── 어제 것도 지금 서 있는 워크스페이스 안에서 ────────────────────────────
   *
   * 노트는 하루에 하나고 워크스페이스를 안 가립니다 — 오전에 A, 오후에 B를
   * 하는 사람에게 하루는 여전히 하루니까요. 그건 그대로입니다.
   *
   * 그런데 **거기 적힌 업무 줄**은 다릅니다. 어제 다른 워크스페이스에서 담아
   * 둔 업무가 오늘 이쪽 화면의 '가져올 것'에 섰습니다 — 사이드바 어디에도
   * 없는 프로젝트의 업무가요. 눌러도 갈 데가 없습니다.
   *
   * 지워진 업무와 같은 취급입니다: 목록에서 빠집니다. 저쪽으로 전환하면
   * 저쪽 노트가 아니라 **같은 노트**가 그 줄을 다시 내놓습니다.
   */
  const items = useMemo(() => {
    if (!source) return []
    // 보관한 프로젝트는 뺍니다. 보관은 '전체 업무·내 할 일·통계에서 내려간다'는
    // 뜻이고, 어제 못 끝낸 것도 그 셈의 하나입니다 — 한 곳만 예외로 두면
    // 사이드바에서 내려간 일이 오늘 아침에 다시 올라옵니다.
    const here = new Map(visibleProjects.filter(p => !p.archived).map(p => [p.id, p]))
    const byId = new Map(
      tasks.filter(t => !t.projectId || here.has(t.projectId)).map(t => [t.id, t]),
    )
    return parseCarryables(source.html, id => byId.get(id)?.status ?? null)
      .map(it => {
        if (it.kind !== 'task') return it
        const task = byId.get(it.taskId!)
        const project = task?.projectId ? here.get(task.projectId) : undefined
        return {
          ...it,
          label: task?.name || '이름 없음',
          project: project ? { name: project.name, color: project.color } : undefined,
        }
      })
  }, [source, tasks, visibleProjects])

  // ── 진단 ──────────────────────────────────────────────────────────────────
  //
  // 거르기 **전**의 줄을 전부, 이유와 함께 남깁니다. 화면에 안 나오는 것까지
  // 봐야 무엇이 잘못 남았는지 알 수 있습니다.
  useEffect(() => {
    if (!source) {
      carryDebug.last = { 어제노트: '아직 못 찾았거나 없습니다' }
      return
    }
    const allTasks = useTaskStore.getState().tasks
    const allProjects = useProjectStore.getState().projects
    const shown = new Set(visibleProjects.filter(p => !p.archived).map(p => p.id))
    const byId = new Map(allTasks.map(t => [t.id, t]))
    const pById = new Map(allProjects.map(p => [p.id, p]))
    carryDebug.last = {
      날짜: source.date,
      줄: parseCarryables(source.html, id => byId.get(id)?.status ?? null).map(it => {
        if (it.kind === 'todo') {
          return { 종류: '체크박스(○)', 글: it.label, 설명: '노트에 친 글자입니다 — 프로젝트가 없어서 거를 근거가 없습니다' }
        }
        const task = byId.get(it.taskId!)
        const project = task?.projectId ? pById.get(task.projectId) : undefined
        return {
          종류: '업무(◆)',
          이름: task?.name ?? '(못 찾음)',
          taskId: it.taskId,
          상태: task?.status,
          projectId: task?.projectId ?? '(없음 — 개인 업무)',
          프로젝트: project?.name ?? (task?.projectId ? '(내 목록에 없는 프로젝트)' : '-'),
          프로젝트소속: project?.orgId ?? '-',
          보관: !!project?.archived,
          화면에남나: !task?.projectId || shown.has(task.projectId),
        }
      }),
      노트원문: source.html,
    }
  }, [source, visibleProjects])

  const chosen = items.filter(it => !skipped.has(it.key))

  if (done || !items.length) return null

  const dismiss = () => {
    localStorage.setItem(dismissKey, '1')
    setDone(true)
  }

  const bring = () => {
    if (!editor || editor.isDestroyed || !chosen.length) return
    const todos = chosen.filter(it => it.kind === 'todo')
    const refs = chosen.filter(it => it.kind === 'task')
    let html = ''
    if (todos.length) {
      html += `<ul data-type="taskList">${todos
        .map(it => `<li data-checked="false"><p>${escapeHtml(it.label)}</p></li>`)
        .join('')}</ul>`
    }
    html += refs.map(it => `<div data-task-ref data-task-id="${it.taskId}"></div>`).join('')
    editor.chain().focus('end').insertContent(html).run()
    localStorage.setItem(dismissKey, '1')
    setDone(true)
  }

  const label = `${dayLabelFor(source!.date)} 못 끝낸 것 ${items.length}개`

  if (!open) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 0 8px' }}>
        <button
          onClick={() => setOpen(true)}
          style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 12, color: 'var(--t3)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)' }}
        >
          {label} · 가져오기
        </button>
        <button onClick={dismiss} aria-label="닫기"
          style={{ border: 'none', background: 'transparent', padding: '0 4px', cursor: 'pointer', fontSize: 12, color: 'var(--t3)' }}>×</button>
      </div>
    )
  }

  return (
    <div style={{
      border: '1px solid var(--bd)', borderRadius: 'var(--r2)',
      padding: '10px 12px', marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--t2)' }}>{label}</span>
        <button onClick={dismiss} aria-label="닫기"
          style={{ border: 'none', background: 'transparent', padding: '0 2px', cursor: 'pointer', fontSize: 12, color: 'var(--t3)' }}>×</button>
      </div>
      {items.map(it => (
        <label key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--t1)', cursor: 'pointer', padding: '2px 0' }}>
          <input
            type="checkbox"
            checked={!skipped.has(it.key)}
            onChange={e => setSkipped(prev => {
              const next = new Set(prev)
              if (e.target.checked) next.delete(it.key)
              else next.add(it.key)
              return next
            })}
          />
          <span style={{ color: 'var(--t3)', fontSize: 11, width: 10, flexShrink: 0 }}>{it.kind === 'task' ? '◆' : '○'}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
          {it.project && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, fontSize: 11, color: 'var(--t3)', maxWidth: 120 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: it.project.color, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.project.name}</span>
            </span>
          )}
        </label>
      ))}
      <button
        onClick={bring}
        disabled={!chosen.length}
        style={{
          alignSelf: 'flex-start', marginTop: 8, padding: '5px 12px',
          borderRadius: 'var(--r2)', border: 'none',
          background: chosen.length ? 'var(--ac)' : 'var(--bg2)',
          color: chosen.length ? '#fff' : 'var(--t3)',
          fontSize: 12, fontWeight: 600, fontFamily: 'var(--font)',
          cursor: chosen.length ? 'pointer' : 'default',
        }}
      >{chosen.length}개 가져오기</button>
    </div>
  )
}
