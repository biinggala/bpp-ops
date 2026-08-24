import { useState } from 'react'
import { useActivity } from '../../hooks/useActivity'
import type { Activity } from '../../lib/activity'

/**
 * ── 활동 ─────────────────────────────────────────────────────────────────────
 *
 * A dotted line of what happened, newest first.
 *
 * Each entry reads as one sentence with its fields underneath, because that is
 * what an edit is: one person, one moment, however many fields they touched.
 * The alternative — a line per field — turns an ordinary afternoon into forty
 * rows and nobody reads the fortieth.
 *
 * The rail down the left is a single border rather than a dot per row joined by
 * segments: at this density the segments cost more attention than the sequence
 * they describe.
 */

const KIND_TEXT: Record<Activity['kind'], string> = {
  created: '업무를 만들었습니다',
  changed: '수정했습니다',
  deleted: '업무를 삭제했습니다',
  restored: '휴지통에서 되살렸습니다',
}

function when(at: number): string {
  const d = new Date(at)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  if (sameDay) return time
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `어제 ${time}`
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}

export function ActivityList({ taskId, projectId, compact = false }: {
  taskId: string
  projectId: string | undefined
  /** The phone's tab has the screen to itself; the desktop section does not. */
  compact?: boolean
}) {
  const entries = useActivity(taskId, projectId)
  /**
   * 처음에는 최근 것만 보여 줍니다.
   *
   * 활동은 **최근 것이 거의 전부**입니다 — 지금 이 업무에 무슨 일이 있었나를
   * 묻는 자리고, 석 달 전 마감일이 언제였는지를 묻는 자리가 아닙니다. 그런데
   * 전부 펼쳐 두면 그 최근 것이 스무 줄 아래로 밀려납니다.
   *
   * 접었다는 사실은 **숨기지 않습니다.** 몇 개가 더 있는지 버튼에 적습니다 —
   * 안 보이는 것이 있는데 말 안 하면 그건 없는 것과 같아 보입니다.
   */
  const [expanded, setExpanded] = useState(false)
  const LIMIT = compact ? 4 : 8
  const shown = expanded ? entries : entries.slice(0, LIMIT)
  const hidden = entries.length - shown.length

  if (!projectId) {
    return (
      <div style={{ fontSize: compact ? 12 : 13, color: 'var(--t3)', lineHeight: 1.6 }}>
        개인 업무는 활동을 남기지 않습니다 — 본인 말고는 고칠 수 있는 사람이 없습니다.
      </div>
    )
  }

  if (!entries.length) {
    return (
      <div style={{ fontSize: compact ? 12 : 13, color: 'var(--t3)' }}>
        아직 기록이 없습니다. 이제부터 바뀌는 것이 여기 남습니다.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 10 : 14 }}>
      {shown.map(entry => (
        <div key={entry.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            marginTop: compact ? 6 : 7,
            background: entry.kind === 'deleted' ? 'var(--danger)'
              : entry.kind === 'created' || entry.kind === 'restored' ? 'var(--ac)' : 'var(--bd2)',
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: compact ? 12 : 13, color: 'var(--t2)', lineHeight: 1.5 }}>
              <span style={{ color: 'var(--t1)', fontWeight: 500 }}>{entry.by}</span>
              님이 {KIND_TEXT[entry.kind]}
              <span style={{ color: 'var(--t3)', marginLeft: 6, fontSize: compact ? 11 : 12 }}>
                {when(entry.at)}
              </span>
            </div>
            {entry.changes && entry.changes.length > 0 && (
              <div style={{ marginTop: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {entry.changes.map((change, i) => (
                  <div key={i} style={{
                    fontSize: compact ? 11 : 12, color: 'var(--t3)', lineHeight: 1.5,
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    <span style={{ color: 'var(--t2)' }}>{change.label}</span>
                    {' '}{change.detail}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
      {hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            alignSelf: 'flex-start', marginLeft: 16, padding: '4px 0',
            border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: compact ? 11 : 12, color: 'var(--t3)', fontFamily: 'var(--font)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)' }}
        >
          이전 기록 {hidden}개 더 보기
        </button>
      )}
    </div>
  )
}
