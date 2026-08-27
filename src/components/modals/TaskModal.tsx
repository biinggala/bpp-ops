import { useState, useEffect, useRef, useMemo } from 'react'
import { isComposing, assigneeOptions, invitableColleagues, parseAssignees, assigneeKeyToEmail } from '../../lib/utils'
import { useInviteAssign } from '../../hooks/useInviteAssign'
import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { useProjectStore } from '../../store/projectStore'
import { useMilestoneStore } from '../../store/milestoneStore'
import { useAccessibleTasks } from '../../hooks/useAccessibleTasks'
import { useAuthStore } from '../../store/authStore'
import { useUserProfileStore } from '../../store/userProfileStore'
import { useToast } from '../shared/Toast'
import { useMobile } from '../../hooks/useMobile'
import { DateField } from '../shared/DatePicker'
import { AssigneePicker } from '../shared/AssigneePicker'
import { BadgeSelect } from '../shared/BadgeSelect'
import { StatusPill, PriorityLabel } from '../shared/StatusPill'
import { PropCell, OptionPicker, STATUS_STYLE, PRIORITY_STYLE } from '../shared/PropRow'
import { STATUS_LIST, PRIORITY_LIST, getTagColor } from '../../types'
import type { Task, Status, Priority } from '../../types'
import { useShallow } from 'zustand/react/shallow'
import { useVisibleProjects } from '../../hooks/useVisibleProjects'

/**
 * ── 새 업무 ──────────────────────────────────────────────────────────────────
 *
 * **Why this still exists.** The list has an add row, and it is the faster way
 * in when you are already looking at the project. But it files into *that*
 * project, and the app now opens on 내 할 일 — which is not a project and has no
 * add row. The calendar, the gantt and 자료 have no row either. So this is the
 * one door that works from anywhere, and it is the only place a task can be
 * created without first choosing where you are standing.
 *
 * **What it is not, any more.** It used to be a form: fourteen fields, `<select>`
 * elements that matched nothing else in the app, a 진행률 slider on a task that
 * did not exist yet, and a 선행/후행 picker behind an `editing` branch that
 * nothing ever reached — 수정 has gone to the detail screen for a long time.
 *
 * What it is now is a name and the handful of facts worth stating at the moment
 * of writing it down: whose it is, when it is due, where it belongs. Everything
 * else is set on the task afterwards, in the detail screen, using the same
 * controls — which are literally the same components now (shared/PropRow), so
 * the two screens cannot drift apart again.
 */

const EMPTY: Omit<Task, 'id'> = {
  type: '상위', name: '', cat: '', assignee: '',
  start: '', due: '', priority: '중간', status: '대기', progress: 0, memo: '',
}

export function TaskModal() {
  const { isTaskModalOpen, newTaskParentId, newTaskMilestoneId, newTaskProjectId, newTaskDue, closeTaskModal, projectId: uiProjectId } = useUiStore(useShallow(s => ({ isTaskModalOpen: s.isTaskModalOpen, newTaskParentId: s.newTaskParentId, newTaskMilestoneId: s.newTaskMilestoneId, newTaskProjectId: s.newTaskProjectId, newTaskDue: s.newTaskDue, closeTaskModal: s.closeTaskModal, projectId: s.projectId })))
  const { tasks, addTask } = useTaskStore(useShallow(s => ({ tasks: s.tasks, addTask: s.addTask })))
  // 고를 수 있는 것만 내놓습니다 — 지금 서 있는 워크스페이스의 프로젝트.
  const projects = useVisibleProjects()
  const milestones = useMilestoneStore(s => s.milestones)
  const email = useAuthStore(s => s.email)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const isMobile = useMobile()

  const [form, setForm] = useState<Omit<Task, 'id'>>(EMPTY)
  /** Extra projects to file a copy of this new task into. */
  const [alsoProjects, setAlsoProjects] = useState<string[]>([])
  /** 메모와 태그는 접혀 있습니다 — 대부분의 새 업무에는 이름과 담당자뿐입니다. */
  const [more, setMore] = useState(false)

  const parentTask = newTaskParentId ? tasks.find(t => t.id === newTaskParentId) : null

  // 고를 수 있는 사람은 그 업무를 읽을 수 있는 사람뿐입니다. 프로젝트가
  // 없으면 그 업무는 personalTasks/$uid에 살고, 그건 나만 읽습니다.
  const options = useMemo(
    () => assigneeOptions(form.projectId, projects, email, getNameByEmail),
    [form.projectId, projects, email, getNameByEmail],
  )
  // 목록에 없는 동료는 초대해서 맡깁니다 — hooks/useInviteAssign.
  const invitable = useMemo(
    () => invitableColleagues(form.projectId, projects, email, getNameByEmail),
    [form.projectId, projects, email, getNameByEmail],
  )
  const inviteAssign = useInviteAssign()

  const projectMilestones = useMemo(
    () => milestones
      .filter(m => m.projectId === form.projectId)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [milestones, form.projectId],
  )

  const dateContext = useMemo(() => ({
    projectId: form.projectId ?? undefined,
    milestoneId: form.milestoneId ?? undefined,
    assignee: form.assignee,
  }), [form.projectId, form.milestoneId, form.assignee])

  useEffect(() => {
    if (!isTaskModalOpen) return
    // A previous row's extra projects must not follow the next one in.
    setAlsoProjects([])
    setMore(false)
    const defaultProjectId = parentTask?.projectId ?? newTaskProjectId ?? uiProjectId ?? undefined
    const defaultMilestoneId = parentTask?.milestoneId ?? newTaskMilestoneId ?? undefined
    setForm({
      ...EMPTY,
      cat: parentTask?.cat ?? '',
      type: newTaskParentId ? '세부' : EMPTY.type,
      ...(newTaskParentId ? { parentId: newTaskParentId } : {}),
      /**
       * 담당자는 **나**입니다.
       *
       * 비워 두고 있었습니다. 그런데 담당자 없는 업무는 '오늘'의 가져올 것에도,
       * '내 할 일'에도 안 나옵니다 — 두 화면 다 나에게 배정된 것만 보니까요.
       * 방금 만든 업무가 만든 사람 화면 어디에도 없는 상태가 됩니다.
       *
       * 안 정했으면 내 것입니다. 남의 일로 만들려면 바로 아래 담당자 칸에서
       * 바꾸면 되고, 그건 한 번 더 누르는 일이지 못 하는 일이 아닙니다.
       * 리스트의 한 줄 추가는 이미 이렇게 하고 있었고, 창만 달랐습니다.
       */
      ...(email ? { assignee: email } : {}),
      ...(defaultProjectId ? { projectId: defaultProjectId } : {}),
      ...(defaultMilestoneId ? { milestoneId: defaultMilestoneId } : {}),
      // 캘린더에서 날짜를 눌러 왔으면 그 날이 마감일입니다. 누른 날짜를
      // 다시 고르게 하는 건 방금 한 말을 한 번 더 시키는 것입니다.
      ...(newTaskDue ? { due: newTaskDue } : {}),
    })
  }, [isTaskModalOpen, newTaskParentId, newTaskMilestoneId, newTaskProjectId, newTaskDue, email])

  if (!isTaskModalOpen) return null

  const upd = <K extends keyof Omit<Task, 'id'>>(k: K, v: Omit<Task, 'id'>[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const ready = !!form.name.trim()

  const submit = () => {
    if (!ready) return
    addTask({ ...form, createdBy: email ?? undefined })
    // One copy per extra project. A single record cannot sit in two projects —
    // it lives at its project's path and access is that project's membership —
    // and copies are what people are after anyway: 스텝 취합 for 승원 and for
    // 릴서, each finishing on its own schedule. The milestone does not travel;
    // it belongs to the project it was picked in.
    for (const pid of alsoProjects) {
      addTask({ ...form, projectId: pid, milestoneId: undefined, createdBy: email ?? undefined })
    }
    if (alsoProjects.length) {
      useToast.getState().show(`${alsoProjects.length + 1}개 프로젝트에 추가했습니다`)
    }
    closeTaskModal()
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) closeTaskModal() }}
      onKeyDown={e => { if (e.key === 'Escape') closeTaskModal() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,.45)', zIndex: 100, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 24 }}
    >
      <div style={{
        background: 'var(--bg)', borderRadius: isMobile ? 'var(--r4) var(--r4) 0 0' : 'var(--r4)',
        width: '100%', maxWidth: isMobile ? undefined : 520,
        maxHeight: isMobile ? '92vh' : '86vh',
        display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
        border: '1px solid var(--bd)', boxShadow: 'var(--sh-lg)', overflow: 'hidden',
      }}>

        {/* The name is the header. A modal whose first line is the word "새 업무"
            spends its most valuable row saying what the button that opened it
            already said. */}
        <div style={{ padding: isMobile ? '18px 20px 12px' : '20px 24px 14px', flexShrink: 0 }}>
          {parentTask && (
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ↳ {parentTask.name} 의 하위 업무
            </div>
          )}
          <input
            autoFocus
            value={form.name}
            onChange={e => upd('name', e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) submit() }}
            placeholder="무엇을 해야 하나요?"
            style={{
              width: '100%', border: 'none', outline: 'none', background: 'transparent',
              fontSize: isMobile ? 17 : 19, fontWeight: 600, color: 'var(--t1)',
              fontFamily: 'var(--font)', padding: 0, lineHeight: 1.35,
            }}
          />
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: isMobile ? '0 20px 16px' : '0 24px 18px' }}>
          {/* The same rows, in the same order, drawn by the same components as
              the detail screen. One column here — the modal is half as wide. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', rowGap: 2 }}>
            <PropCell label="프로젝트">
              <OptionPicker
                value={form.projectId}
                empty="없음"
                options={projects.filter(p => !p.archived).map(p => ({ value: p.id, label: p.name, dot: p.color }))}
                onChange={v => {
                  upd('projectId', v)
                  upd('milestoneId', undefined)
                  setAlsoProjects([])
                  /**
                   * 프로젝트를 옮기면 담당자도 같이 걸러집니다. 저쪽 멤버를
                   * 골라 두고 프로젝트를 '없음'으로 바꾸면, 목록에서는 사라진
                   * 사람이 값에는 남아 그대로 저장됩니다 — 못 보는 사람에게
                   * 맡긴 업무가 그렇게 만들어졌습니다.
                   */
                  const allowed = new Set(assigneeOptions(v, projects, email, getNameByEmail).map(o => o.value))
                  setForm(f => ({
                    ...f,
                    assignee: parseAssignees(f.assignee)
                      .filter(a => allowed.has(assigneeKeyToEmail(a)))
                      .join(','),
                  }))
                }}
              />
            </PropCell>

            {/*
              ── 마일스톤 칸은 프로젝트를 고른 뒤에 섭니다 ────────────────────
              마일스톤은 프로젝트에 속하니 그 전에는 고를 것이 없습니다.
              그런데 마일스톤이 하나도 없는 프로젝트에서는 **칸 자체를 안
              그렸습니다** — 캘린더에서 날짜를 눌러 온 사람에게는 마일스톤을
              붙이는 길이 아예 없는 것처럼 보였습니다.

              없으면 없다고 말합니다. 빈 것과 없는 것은 다른 말이고, 그 차이가
              '내가 잘못 찾고 있나'와 '여긴 아직 안 만들었구나'를 가릅니다.
            */}
            {form.projectId && (
              <PropCell label="마일스톤">
                {projectMilestones.length > 0 ? (
                  <OptionPicker
                    value={form.milestoneId}
                    empty="없음"
                    options={projectMilestones.map(m => ({ value: m.id, label: m.name, sub: m.dueDate }))}
                    onChange={v => upd('milestoneId', v)}
                  />
                ) : (
                  <span style={{ fontSize: 12.5, color: 'var(--t3)' }}>
                    이 프로젝트에는 아직 없습니다
                  </span>
                )}
              </PropCell>
            )}

            <PropCell label="담당자">
              <AssigneePicker
                assignee={form.assignee}
                options={options}
                onChange={v => upd('assignee', v)}
                invitable={invitable}
                onInvite={mail => {
                  if (!form.projectId) return
                  void inviteAssign(form.projectId, mail, who =>
                    setForm(f => ({ ...f, assignee: [...parseAssignees(f.assignee), who].join(',') })))
                }}
              />
            </PropCell>

            <PropCell label="마감일">
              <DateField value={form.due} context={dateContext} onChange={v => upd('due', v)} placeholder="—" format="full" style={{ fontSize: 13 }} />
            </PropCell>

            <PropCell label="시작일">
              <DateField value={form.start} context={dateContext} onChange={v => upd('start', v)} placeholder="—" format="full" style={{ fontSize: 13 }} />
            </PropCell>

            <PropCell label="상태">
              <BadgeSelect value={form.status} options={STATUS_LIST as Status[]} styleMap={STATUS_STYLE} renderValue={v => <StatusPill status={v} />} onChange={v => upd('status', v as Status)} />
            </PropCell>

            <PropCell label="우선순위">
              <BadgeSelect value={form.priority} options={PRIORITY_LIST as Priority[]} styleMap={PRIORITY_STYLE} renderValue={v => <PriorityLabel priority={v} />} onChange={v => upd('priority', v as Priority)} />
            </PropCell>
          </div>

          {/* Only once a project is chosen: 'the same task, in these too'. */}
          {form.projectId && projects.filter(p => !p.archived).length > 1 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--bd)' }}>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 7 }}>
                같은 업무를 다른 프로젝트에도
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {projects.filter(p => !p.archived && p.id !== form.projectId).map(p => {
                  const on = alsoProjects.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setAlsoProjects(prev => on ? prev.filter(id => id !== p.id) : [...prev, p.id])}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '4px 9px', borderRadius: 999, cursor: 'pointer',
                        fontFamily: 'var(--font)', fontSize: 12,
                        color: on ? '#fff' : 'var(--t2)',
                        background: on ? 'var(--ac)' : 'transparent',
                        border: `1px solid ${on ? 'var(--ac)' : 'var(--bd2)'}`,
                      }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: on ? '#fff' : p.color }} />
                      {p.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Folded away, because most new tasks are a name and a person. */}
          {more ? (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <textarea
                rows={3}
                value={form.memo}
                onChange={e => upd('memo', e.target.value)}
                placeholder="메모..."
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '8px 10px', resize: 'vertical',
                  border: '1px solid var(--bd)', borderRadius: 'var(--r2)', background: 'var(--bg)',
                  fontSize: 13, lineHeight: 1.65, color: 'var(--t1)', outline: 'none', fontFamily: 'var(--font)',
                }}
              />
              <TagInput value={form.tags ?? []} onChange={tags => upd('tags', tags)} />
            </div>
          ) : (
            <button
              onClick={() => setMore(true)}
              style={{
                marginTop: 10, padding: 0, border: 'none', background: 'transparent',
                fontSize: 12, color: 'var(--t3)', cursor: 'pointer', fontFamily: 'var(--font)',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--t2)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--t3)')}
            >+ 메모·태그</button>
          )}

          {/* 날짜를 눌러 열었을 때만. 만들 것이 이미 있을 수도 있습니다. */}
          {newTaskDue && <Backlog date={newTaskDue} onClose={closeTaskModal} />}
        </div>

        <div style={{
          padding: isMobile ? '12px 20px calc(env(safe-area-inset-bottom, 0px) + 12px)' : '12px 24px',
          borderTop: '1px solid var(--bd)', background: 'var(--bg2)',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        }}>
          {!isMobile && (
            <span style={{ fontSize: 11, color: 'var(--t3)', marginRight: 'auto' }}>
              ⏎ 추가 · esc 취소
            </span>
          )}
          <button
            onClick={closeTaskModal}
            style={{ marginLeft: isMobile ? 'auto' : undefined, padding: '7px 14px', borderRadius: 'var(--r2)', border: '1px solid var(--bd)', background: 'var(--bg)', fontSize: 13, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)' }}
          >취소</button>
          <button
            onClick={submit}
            disabled={!ready}
            style={{
              padding: '7px 18px', borderRadius: 'var(--r2)', border: 'none',
              background: ready ? 'var(--ac)' : 'var(--bd2)', color: '#fff',
              fontSize: 13, fontWeight: 500, cursor: ready ? 'pointer' : 'not-allowed',
              fontFamily: 'var(--font)', transition: 'background .12s',
            }}
          >추가</button>
        </div>
      </div>
    </div>
  )
}

function TagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const accessibleTasks = useAccessibleTasks()
  const allTags = useMemo(() => {
    const s = new Set<string>()
    accessibleTasks.forEach(t => t.tags?.forEach(tag => s.add(tag)))
    return Array.from(s).sort()
  }, [accessibleTasks])

  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const filtered = allTags.filter(t =>
    t.toLowerCase().includes(input.toLowerCase()) && !value.includes(t)
  )

  const add = (tag: string) => {
    const t = tag.trim().toLowerCase().replace(/\s+/g, '-')
    if (t && !value.includes(t)) onChange([...value, t])
    setInput('')
  }

  const remove = (tag: string) => onChange(value.filter(t => t !== tag))

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        onClick={() => { setOpen(true); (ref.current?.querySelector('input') as HTMLInputElement)?.focus() }}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '5px 8px', border: '1px solid var(--bd)', borderRadius: 'var(--r2)', background: 'var(--bg)', minHeight: 36, cursor: 'text', alignItems: 'center' }}
      >
        {value.map(tag => {
          const c = getTagColor(tag)
          return (
            <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 3, fontSize: 11, fontWeight: 500, background: c.bg, color: c.text }}>
              #{tag}
              <span onClick={e => { e.stopPropagation(); remove(tag) }} style={{ cursor: 'pointer', fontSize: 13, lineHeight: 1, opacity: .6, fontFamily: 'var(--font)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '.6'}
              >×</span>
            </span>
          )
        })}
        <input
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); e.stopPropagation(); if (input.trim()) add(input) }
            if (e.key === 'Backspace' && !input && value.length) remove(value[value.length - 1])
            if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
          }}
          placeholder={value.length ? '' : '태그 추가... (Enter로 생성)'}
          style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12, color: 'var(--t1)', fontFamily: 'var(--font)', minWidth: 100, flex: 1 }}
        />
      </div>

      {open && (filtered.length > 0 || (input.trim() && !allTags.includes(input.trim().toLowerCase()))) && (
        <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)', zIndex: 300, padding: '4px 0', maxHeight: 180, overflowY: 'auto' }}>
          {filtered.map(tag => {
            const c = getTagColor(tag)
            return (
              <div key={tag} onMouseDown={e => { e.preventDefault(); add(tag) }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 12, transition: 'background .07s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 11, background: c.bg, color: c.text, fontWeight: 500 }}>#{tag}</span>
              </div>
            )
          })}
          {input.trim() && !allTags.includes(input.trim().toLowerCase().replace(/\s+/g, '-')) && (
            <div onMouseDown={e => { e.preventDefault(); add(input) }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--ac)', transition: 'background .07s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ fontSize: 11, fontWeight: 500 }}>+</span>
              "#{input.trim()}" 새 태그 생성
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * ── 이미 있는 업무를 이 날로 ─────────────────────────────────────────────────
 *
 * 캘린더에서 빈 날을 누르는 사람이 늘 새 일을 만들려는 건 아닙니다. 백로그가
 * 쌓인 팀에 부족한 건 업무가 아니라 **언제 할지에 대한 결정**이고, 그 결정이
 * 일어나는 순간이 지금입니다.
 *
 * 예전에는 이게 날짜 옆에 뜨는 별도 팝오버(DayPlanner)에 있었습니다. 그러다
 * 보니 업무를 만드는 창이 두 개가 됐고, 두 개는 언젠가 어긋납니다. 창은
 * 하나로 두고 이 목록만 그 안으로 들어왔습니다.
 *
 * 접혀 있습니다. 새 업무를 만들러 온 사람에게는 이게 방해고, 그쪽이 더 흔한
 * 경우입니다. 하위 업무는 뺍니다 — 부모를 따라 움직이므로 둘을 같이 늘어놓으면
 * 같은 일이 두 번 있는 것처럼 보입니다.
 */
function Backlog({ date, onClose }: { date: string; onClose: () => void }) {
  const tasks = useTaskStore(s => s.tasks)
  const updateTask = useTaskStore(s => s.updateTask)
  const projects = useVisibleProjects()
  const [open, setOpen] = useState(false)

  const undated = useMemo(
    () => {
      // 여기 있는 것은 전부 고를 수 있어야 합니다. 다른 워크스페이스의 업무가
      // 섞이면 눌러 놓고 어디로 갔는지 못 찾습니다.
      const here = new Set(projects.map(p => p.id))
      return tasks.filter(t => (!t.projectId || here.has(t.projectId)) && !t.due && !t.start && t.status !== '완료' && !t.parentId)
    },
    [tasks, projects],
  )
  if (!undated.length) return null

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--bd)' }}>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          style={{
            padding: 0, border: 'none', background: 'transparent',
            fontSize: 12, color: 'var(--t3)', cursor: 'pointer', fontFamily: 'var(--font)',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--t2)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--t3)')}
        >날짜 없는 업무 {undated.length}개에서 고르기</button>
      ) : (
        <>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 6 }}>
            누르면 이 업무의 마감일이 {date.slice(5).replace('-', '월 ')}일이 됩니다
          </div>
          <div style={{ maxHeight: 168, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {undated.slice(0, 40).map(t => {
              const project = t.projectId ? projects.find(p => p.id === t.projectId) : undefined
              return (
                <button
                  key={t.id}
                  onClick={() => { updateTask(t.id, { due: date }); onClose() }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7, width: '100%',
                    padding: '5px 7px', borderRadius: 'var(--r1)', border: 'none',
                    background: 'transparent', cursor: 'pointer', textAlign: 'left',
                    fontFamily: 'var(--font)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: project?.color ?? 'var(--bd2)',
                  }} />
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--t1)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{t.name || '(이름 없음)'}</span>
                  {project && (
                    <span style={{ fontSize: 10.5, color: 'var(--t3)', flexShrink: 0 }}>{project.name}</span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
