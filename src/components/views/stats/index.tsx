import { useMemo } from 'react'
import { assigneeKeyToEmail, parseAssignees } from '../../../lib/utils'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useUserProfileStore } from '../../../store/userProfileStore'
import { useProjectStore } from '../../../store/projectStore'
import { useAuthStore } from '../../../store/authStore'
import { useUiStore } from '../../../store/uiStore'
import { useMobile } from '../../../hooks/useMobile'
import { getCatColor } from '../../../types'
import type { Task } from '../../../types'

const GRAD_PALETTE = [
  'linear-gradient(135deg,#f093fb,#f5576c)',
  'linear-gradient(135deg,#4facfe,#00f2fe)',
  'linear-gradient(135deg,#43e97b,#38f9d7)',
  'linear-gradient(135deg,#fa709a,#fee140)',
  'linear-gradient(135deg,#a18cd1,#fbc2eb)',
  'linear-gradient(135deg,#ffecd2,#fcb69f)',
  'linear-gradient(135deg,#667eea,#764ba2)',
  'linear-gradient(135deg,#f6d365,#fda085)',
]

function gradForKey(key: string) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffff
  return GRAD_PALETTE[h % GRAD_PALETTE.length]
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

export function StatsView() {
  const tasks = useFilteredTasks()
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const projects = useProjectStore(s => s.projects)
  const email = useAuthStore(s => s.email)
  const myTasksOnly = useUiStore(s => s.myTasksOnly)
  const setView = useUiStore(s => s.setView)
  const setFilters = useUiStore(s => s.setFilters)
  const openTaskDetail = useUiStore(s => s.openTaskDetail)
  const isMobile = useMobile()

  const today = useMemo(startOfToday, [])

  const total = tasks.length
  const done = tasks.filter(t => t.status === '완료').length
  const inProgress = tasks.filter(t => t.status === '진행중').length
  const review = tasks.filter(t => t.status === '검토중').length
  const overdueTasks = useMemo(() =>
    tasks
      .filter(t => t.due && t.status !== '완료' && new Date(t.due) < today)
      .sort((a, b) => a.due.localeCompare(b.due))
  , [tasks, today])
  const upcomingTasks = useMemo(() => {
    const limit = new Date(today); limit.setDate(limit.getDate() + 7)
    return tasks
      .filter(t => t.due && t.status !== '완료' && new Date(t.due) >= today && new Date(t.due) <= limit)
      .sort((a, b) => a.due.localeCompare(b.due))
  }, [tasks, today])
  const donePct = total ? Math.round((done / total) * 100) : 0

  const summary = [
    { label: '전체 태스크', val: total,              color: '#9065B0' },
    { label: '진행중',      val: inProgress,          color: '#2383E2' },
    { label: '검토중',      val: review,              color: '#D9730D' },
    { label: `완료 (${donePct}%)`, val: done,         color: '#448361' },
    { label: '마감 초과',   val: overdueTasks.length, color: 'var(--danger)' },
  ]

  // Category progress — distinct cat values, avg progress as the bar, count as
  // the figure, sorted by count desc.
  const categories = useMemo(() => {
    const map = new Map<string, { count: number; progressSum: number }>()
    tasks.forEach(t => {
      const c = t.cat || '미분류'
      const cur = map.get(c) ?? { count: 0, progressSum: 0 }
      cur.count++; cur.progressSum += t.progress
      map.set(c, cur)
    })
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, count: v.count, progress: Math.round(v.progressSum / v.count) }))
      .sort((a, b) => b.count - a.count)
  }, [tasks])

  const projectById = useMemo(() => {
    const m = new Map<string, typeof projects[number]>()
    projects.forEach(p => m.set(p.id, p))
    return m
  }, [projects])

  const nameOf = (key: string): string => getNameByEmail(assigneeKeyToEmail(key))

  // Participants — STRICTLY per-project: a person appears only if assigned to a
  // task in a project they belong to. Members of other projects never leak in;
  // non-member assignees are never surfaced. Personal tasks only ever show self.
  const selfEmail = email?.toLowerCase() ?? null
  const participants = useMemo(() => {
    const emails = new Set<string>()
    tasks.forEach(t => {
      const proj = t.projectId ? projectById.get(t.projectId) : null
      parseAssignees(t.assignee).forEach(k => {
        const em = assigneeKeyToEmail(k)
        if (proj) {
          emails.add(em)
        } else if (em === selfEmail) {
          emails.add(em)
        }
      })
    })
    return Array.from(emails).map(em => {
      const myTasks = tasks.filter(t =>
        parseAssignees(t.assignee).some(tok => assigneeKeyToEmail(tok) === em))
      const prog = myTasks.length
        ? Math.round(myTasks.reduce((s, t) => s + t.progress, 0) / myTasks.length)
        : 0
      return {
        email: em,
        grad: gradForKey(em),
        name: getNameByEmail(em),
        count: myTasks.length,
        progress: prog,
        inProgress: myTasks.filter(t => t.status === '진행중').length,
        done: myTasks.filter(t => t.status === '완료').length,
        overdue: myTasks.filter(t => t.due && t.status !== '완료' && new Date(t.due) < today).length,
      }
    }).sort((a, b) => b.count - a.count)
  }, [tasks, projectById, selfEmail, getNameByEmail, today])

  const goToAssignee = (em: string) => { setFilters({ assignees: [em] }); setView('t') }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '14px 12px' : '20px 24px', display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 14 }}>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: isMobile ? 8 : 12 }}>
        {summary.map(c => (
          <div key={c.label} style={{
            background: 'var(--bg)', border: '1px solid var(--bd)',
            borderRadius: 'var(--r3)', padding: isMobile ? '13px 15px' : '15px 17px',
            display: 'flex', flexDirection: 'column', boxShadow: 'var(--sh-sm)',
          }}>
            <div style={{ fontSize: isMobile ? 24 : 27, fontWeight: 800, color: c.color, lineHeight: 1.05 }}>{c.val}</div>
            <div style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 500, marginTop: 5 }}>{c.label}</div>
            <div style={{ height: 3, borderRadius: 2, background: c.color, opacity: c.val ? .9 : .15, marginTop: 9, width: c.val ? '38%' : '100%' }} />
          </div>
        ))}
      </div>

      {/* Middle row: category progress (left) + deadlines (right) — equal height */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.1fr 1fr', gap: isMobile ? 12 : 14, alignItems: 'stretch' }}>
        <Card style={{ display: 'flex', flexDirection: 'column' }}>
          <CardTitle icon="📊">카테고리별 진행률</CardTitle>
          {categories.length === 0 ? (
            <Empty>업무가 없습니다</Empty>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 11 }}>
              {categories.map(c => {
                const col = getCatColor(c.name)
                return (
                  <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, width: 104, flexShrink: 0 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: col.text, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    </div>
                    <div style={{ flex: 1, height: 7, background: 'var(--bg4)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 4, background: col.text, width: `${c.progress}%`, transition: 'width .35s ease' }} />
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: col.text, minWidth: 22, textAlign: 'right' }}>{c.count}</div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 14 }}>
          <Card>
            <CardTitle icon="⚠️" danger>마감 초과 ({overdueTasks.length})</CardTitle>
            {overdueTasks.length === 0 ? (
              <Empty>마감 초과 태스크 없음</Empty>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {overdueTasks.slice(0, 6).map(t => (
                  <DeadlineRow key={t.id} task={t} danger nameOf={nameOf} onClick={() => openTaskDetail(t.id)} />
                ))}
                {overdueTasks.length > 6 && <More n={overdueTasks.length - 6} />}
              </div>
            )}
          </Card>

          <Card>
            <CardTitle icon="🗓️">D-7 마감 예정 ({upcomingTasks.length})</CardTitle>
            {upcomingTasks.length === 0 ? (
              <Empty>7일 이내 마감 태스크 없음</Empty>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {upcomingTasks.slice(0, 6).map(t => (
                  <DeadlineRow key={t.id} task={t} nameOf={nameOf} onClick={() => openTaskDetail(t.id)} />
                ))}
                {upcomingTasks.length > 6 && <More n={upcomingTasks.length - 6} />}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* By assignee — hidden in '내 할 일' (would be a single self card) */}
      {!myTasksOnly && (
        <Card>
          <CardTitle icon="👥">담당자별 현황</CardTitle>
          {participants.length === 0 ? (
            <Empty>{total === 0 ? '업무가 없습니다' : '담당자가 지정된 업무가 없습니다'}</Empty>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {participants.map(p => (
                <div
                  key={p.email}
                  onClick={() => goToAssignee(p.email)}
                  style={{ padding: '13px 15px', borderRadius: 'var(--r3)', border: '1px solid var(--bd)', background: 'var(--bg)', cursor: 'pointer', transition: 'border-color .1s, box-shadow .1s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--ac)'; e.currentTarget.style.boxShadow = 'var(--sh-sm)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--bd)'; e.currentTarget.style.boxShadow = 'none' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12, background: p.grad }}>
                      {p.name[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>총 {p.count}개 · 클릭하면 담당자 뷰로 이동</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0, width: 104 }}>
                      <div style={{ flex: 1, height: 6, background: 'var(--bg4)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 4, background: p.grad, width: `${p.progress}%`, transition: 'width .35s ease' }} />
                      </div>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--t1)', minWidth: 30, textAlign: 'right' }}>{p.progress}%</span>
                    </div>
                  </div>

                  <div style={{ marginTop: 11 }}>
                    <MiniStat label="진행중" value={p.inProgress} color="#2383E2" />
                    <MiniStat label="완료" value={p.done} color="#448361" />
                    <MiniStat label="마감 초과" value={p.overdue} color="var(--danger)" last />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function DeadlineRow({ task, danger, nameOf, onClick }: {
  task: Task; danger?: boolean; nameOf: (k: string) => string; onClick: () => void
}) {
  const col = getCatColor(task.cat || '')
  const assignees = parseAssignees(task.assignee)
  const dueShort = task.due ? task.due.slice(2).replace(/-/g, '/') : ''
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', borderRadius: 'var(--r2)',
        background: danger ? 'rgba(212,76,71,.05)' : 'var(--bg2)',
        border: `1px solid ${danger ? 'rgba(212,76,71,.13)' : 'var(--bd)'}`,
        cursor: 'pointer',
      }}
      onMouseEnter={e => e.currentTarget.style.background = danger ? 'rgba(212,76,71,.09)' : 'var(--bg3)'}
      onMouseLeave={e => e.currentTarget.style.background = danger ? 'rgba(212,76,71,.05)' : 'var(--bg2)'}
    >
      <span style={{ fontSize: 11, color: danger ? 'var(--danger)' : 'var(--t3)', flexShrink: 0 }}>{danger ? '⚠' : '◷'}</span>
      <span style={{ flex: 1, fontSize: 12.5, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{task.name}</span>
      {task.cat && (
        <span style={{ fontSize: 10.5, fontWeight: 600, color: col.text, background: col.bg, padding: '2px 7px', borderRadius: 9, flexShrink: 0, whiteSpace: 'nowrap' }}>{task.cat}</span>
      )}
      {assignees.length > 0 && (
        <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--t2)', background: 'var(--bg4)', padding: '2px 7px', borderRadius: 9, flexShrink: 0, whiteSpace: 'nowrap', maxWidth: 74, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {nameOf(assignees[0])}{assignees.length > 1 ? ` +${assignees.length - 1}` : ''}
        </span>
      )}
      <span style={{ fontSize: 11.5, fontWeight: 600, color: danger ? 'var(--danger)' : 'var(--t3)', flexShrink: 0, whiteSpace: 'nowrap' }}>{dueShort}</span>
    </div>
  )
}

function MiniStat({ label, value, color, last }: { label: string; value: number; color: string; last?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      fontSize: 12, color: 'var(--t2)', padding: '5px 0',
      borderBottom: last ? 'none' : '1px solid var(--bd)',
    }}>
      <span>{label}</span>
      <span style={{ fontWeight: 700, color: value ? color : 'var(--t3)' }}>{value}</span>
    </div>
  )
}

function More({ n }: { n: number }) {
  return <div style={{ fontSize: 11, color: 'var(--t3)', padding: '2px 4px' }}>외 {n}개</div>
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--bg)', border: '1px solid var(--bd)',
      borderRadius: 'var(--r3)', padding: '16px 18px', boxShadow: 'var(--sh-sm)',
      ...style,
    }}>
      {children}
    </div>
  )
}

function CardTitle({ icon, children, danger }: { icon: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <div style={{
      fontSize: 13.5, fontWeight: 700, color: danger ? 'var(--danger)' : 'var(--t1)',
      marginBottom: 13, display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--t3)', padding: '4px 2px' }}>{children}</div>
}
