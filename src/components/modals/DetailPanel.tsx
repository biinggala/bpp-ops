import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { CategoryBadge, StatusBadge, PriorityBadge, TypeBadge, TagBadge } from '../shared/Badge'
import { AssigneeGroup } from '../shared/Avatar'
import { ProgressBar } from '../shared/ProgressBar'
import { fmtDate } from '../../lib/utils'

export function DetailPanel() {
  const { detailTaskId, setDetailTaskId, openTaskModal } = useUiStore()
  const { tasks, deleteTask } = useTaskStore()
  const task = detailTaskId ? tasks.find(t => t.id === detailTaskId) : null
  if (!task) return null

  return (
    <>
      <div
        onClick={() => setDetailTaskId(null)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.18)', zIndex: 90 }}
      />

      <div style={{
        position: 'fixed', top: 0, right: 0, width: 440, height: '100vh',
        background: 'var(--bg)', borderLeft: '1px solid var(--bd)',
        boxShadow: 'var(--sh-lg)', zIndex: 91,
        display: 'flex', flexDirection: 'column',
        animation: 'slideIn .2s ease',
      }}>
        <style>{`@keyframes slideIn{from{transform:translateX(16px);opacity:.6}to{transform:translateX(0);opacity:1}}`}</style>

        {/* Header */}
        <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)', lineHeight: 1.5, flex: 1 }}>{task.name}</h2>
          <button onClick={() => setDetailTaskId(null)} style={{ width: 26, height: 26, borderRadius: 'var(--r1)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--t3)', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'var(--font)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t1)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          <Row label="유형"><TypeBadge type={task.type} /></Row>
          {task.cat && <Row label="스페이스"><CategoryBadge cat={task.cat} /></Row>}
          <Row label="상태"><StatusBadge status={task.status} /></Row>
          <Row label="우선순위"><PriorityBadge priority={task.priority} /></Row>
          {task.assignee && (
            <Row label="담당자"><AssigneeGroup assignee={task.assignee} size={22} /></Row>
          )}
          <Row label="기간">
            <span style={{ fontSize: 13, color: 'var(--t2)' }}>
              {task.start ? fmtDate(task.start) : '—'} → {task.due ? fmtDate(task.due) : '—'}
            </span>
          </Row>
          <Row label="진행률">
            <div style={{ flex: 1 }}><ProgressBar value={task.progress} height={6} /></div>
          </Row>
          {task.tags && task.tags.length > 0 && (
            <Row label="태그">
              {task.tags.map(tag => <TagBadge key={tag} tag={tag} />)}
            </Row>
          )}
          {task.memo && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--t3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>메모</div>
              <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.7, whiteSpace: 'pre-wrap', background: 'var(--bg2)', borderRadius: 'var(--r3)', padding: '10px 12px', border: '1px solid var(--bd)' }}>
                {task.memo}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--bd)', display: 'flex', gap: 8 }}>
          <button
            onClick={() => { openTaskModal(task.id); setDetailTaskId(null) }}
            style={{ flex: 1, padding: '7px', borderRadius: 'var(--r2)', border: 'none', background: 'var(--ac)', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font)' }}
          >
            수정
          </button>
          <button
            onClick={() => {
              if (!confirm('삭제할까요?')) return
              deleteTask(task.id); setDetailTaskId(null)
            }}
            style={{ padding: '7px 14px', borderRadius: 'var(--r2)', border: '1px solid rgba(239,68,68,.25)', background: 'transparent', color: '#ef4444', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font)' }}
          >
            삭제
          </button>
        </div>
      </div>
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--bd)' }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--t3)', width: 72, flexShrink: 0, paddingTop: 2, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: 'var(--t1)', flex: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5 }}>
        {children}
      </div>
    </div>
  )
}
