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
import { fmtYMD } from '../../../lib/utils'

/** 며칠 전까지 거슬러 볼 것인가. 주말과 연휴를 건너뛸 만큼. */
const LOOK_BACK = 7

interface Carryable {
  key: string
  kind: 'todo' | 'task'
  /** 화면에 보이는 말. 업무는 이름, 할 일은 그 줄의 글자. */
  label: string
  taskId?: string
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

  const items = useMemo(() => {
    if (!source) return []
    const byId = new Map(tasks.map(t => [t.id, t]))
    return parseCarryables(source.html, id => byId.get(id)?.status ?? null)
      .map(it => it.kind === 'task' ? { ...it, label: byId.get(it.taskId!)?.name || '이름 없음' } : it)
  }, [source, tasks])

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
