import { useTaskStore } from '../../../store/taskStore'
import { useSpaceStore } from '../../../store/spaceStore'
import { useMembers } from '../../../store/memberStore'
import { STATUS_COLORS, STATUS_LIST, getCatColor, getMemberGrad } from '../../../types'
import { parseAssignees } from '../../../lib/utils'
import type { Status } from '../../../types'

export function StatsView() {
  const tasks = useTaskStore(s => s.tasks)
  const spaces = useSpaceStore(s => s.spaces)
  const members = useMembers()

  const total = tasks.length
  const done = tasks.filter(t => t.status === '완료').length
  const inProgress = tasks.filter(t => t.status === '진행중').length
  const overdue = tasks.filter(t =>
    t.due && t.status !== '완료' && new Date(t.due) < new Date(new Date().toDateString())
  ).length
  const avgProgress = total ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / total) : 0

  const summary = [
    { label: '전체 업무',   val: total,             color: 'var(--t1)' },
    { label: '진행중',      val: inProgress,         color: '#2383e2' },
    { label: '완료',        val: done,               color: '#059669' },
    { label: '연체',        val: overdue,            color: '#ef4444' },
    { label: '평균 진행률', val: `${avgProgress}%`,  color: '#8b5cf6' },
  ]

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        {summary.map(c => (
          <div key={c.label} style={{
            background: 'var(--bg)', border: '1px solid var(--bd)',
            borderRadius: 'var(--r3)', padding: '18px 20px',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: c.color, lineHeight: 1 }}>{c.val}</div>
            <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 500, marginTop: 4 }}>{c.label}</div>
            <div style={{ height: 2, borderRadius: 2, background: c.color, opacity: .2, marginTop: 10 }} />
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Section title="스페이스별">
          {spaces.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--t3)', padding: '8px 0' }}>스페이스가 없습니다</div>
          ) : spaces.map(s => {
            const cnt = tasks.filter(t => t.cat === s.name).length
            const c = getCatColor(s.name)
            return <BarRow key={s.id} label={s.name} count={cnt} max={total} fill={c.text} />
          })}
        </Section>

        <Section title="상태별">
          {STATUS_LIST.map(status => {
            const cnt = tasks.filter(t => t.status === status).length
            const c = STATUS_COLORS[status]
            return <BarRow key={status} label={status} count={cnt} max={total} fill={c.text} />
          })}
        </Section>
      </div>

      <Section title="담당자별">
        {members.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--t3)' }}>등록된 팀원이 없습니다.</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {members.map(m => {
            const key = m.key
            const myTasks = tasks.filter(t => parseAssignees(t.assignee).includes(key))
            const myProgress = myTasks.length
              ? Math.round(myTasks.reduce((s, t) => s + t.progress, 0) / myTasks.length)
              : 0

            return (
              <div key={m.id} style={{
                padding: '14px 16px', borderRadius: 'var(--r3)',
                border: '1px solid var(--bd)', background: 'var(--bg2)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 700, fontSize: 11, background: getMemberGrad(m.color),
                  }}>
                    {key}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{m.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>{myTasks.length}개 업무</div>
                  </div>
                </div>

                {STATUS_LIST.map(status => (
                  <div key={status} style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: 12, color: 'var(--t2)', padding: '5px 0',
                    borderBottom: '1px solid var(--bd)',
                  }}>
                    <span>{status}</span>
                    <span style={{ fontWeight: 600, color: 'var(--t1)' }}>
                      {myTasks.filter(t => t.status === status).length}
                    </span>
                  </div>
                ))}

                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--t2)' }}>
                  평균 진행률{' '}
                  <span style={{ fontWeight: 600, color: 'var(--t1)' }}>{myProgress}%</span>
                </div>
              </div>
            )
          })}
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg)', border: '1px solid var(--bd)',
      borderRadius: 'var(--r3)', padding: '18px 20px',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--t3)',
        textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 14,
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function BarRow({ label, count, max, fill }: { label: string; count: number; max: number; fill: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <div style={{
        fontSize: 12, color: 'var(--t2)', width: 80, flexShrink: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </div>
      <div style={{ flex: 1, height: 6, background: 'var(--bg4)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 3, background: fill,
          width: max ? `${(count / max) * 100}%` : '0%',
          transition: 'width .35s ease',
        }} />
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', minWidth: 20, textAlign: 'right' }}>{count}</div>
    </div>
  )
}
