import React from 'react'
import type { GCalEvent } from '../../store/gcalStore'

/**
 * ── 시각 고르기 ──────────────────────────────────────────────────────────────
 *
 * 전에는 하루 격자를 그려 놓고 **끌어서** 시각을 정했습니다. '이 자리가
 * 비었나'에 그림으로 답하는 것이 좋아 보였는데, 실제로 쓰는 손에는
 * 불편했습니다 — 26px짜리 한 시간을 15분 눈금에 맞춰 끌어야 하고, 3시를
 * 정확히 원할 때 손이 두 번 미끄러집니다. **아는 값을 고르는 일에 조준을
 * 시키면 안 됩니다.**
 *
 * 그래서 입력은 목록으로 돌립니다(구글 캘린더·노션이 그렇습니다). 대신 그림이
 * 답하던 것은 버리지 않고, 끌 수 없는 **가느다란 띠** 하나로 남깁니다 — 그
 * 날 찬 자리와 지금 고른 자리가 한눈에 겹쳐 보이면 '비었나'는 여전히
 * 눌러 보지 않고 답이 됩니다.
 */

/** 목록의 눈금. 15분보다 잘게 고르는 일은 없었습니다. */
const SNAP = 15
/** 띠가 그리는 구간. 이 밖의 일정은 양 끝으로 눌러 붙습니다. */
const STRIP_FROM = 6
const STRIP_TO = 24

export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export function localIso(date: string, minutes: number): string {
  return `${date}T${hhmm(minutes)}:00`
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}분`
  const h = Math.floor(minutes / 60), m = minutes % 60
  return m ? `${h}시간 ${m}분` : `${h}시간`
}

export function minutesOfIso(iso: string): number {
  const d = new Date(iso.slice(0, 19))
  return d.getHours() * 60 + d.getMinutes()
}

const FIELD: React.CSSProperties = {
  padding: '4px 6px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
  background: 'var(--bg2)', color: 'var(--t1)', fontSize: 12.5,
  outline: 'none', fontFamily: 'var(--font)', minWidth: 0,
  fontVariantNumeric: 'tabular-nums',
}

/**
 * 시작과 끝.
 *
 * **길이가 아니라 끝 시각입니다.** 회의를 잡을 때 머릿속에 있는 것은 '3시부터
 * 4시까지'고, '3시부터 60분'은 그걸 한 번 번역한 말입니다. 길이는 옆에 적어
 * 주기만 합니다 — 읽으면 되는 것을 고르게 하지 않습니다.
 *
 * 끝이 시작보다 앞이 될 수 없게, 끝 목록은 시작 다음부터만 냅니다. 고르고 나서
 * 틀렸다고 말하는 것보다 아예 못 고르게 하는 편이 짧습니다.
 */
export function TimeRange({ startMin, minutes, onChange }: {
  startMin: number
  minutes: number
  onChange: (startMin: number, minutes: number) => void
}) {
  const starts: number[] = []
  for (let m = 0; m < 24 * 60; m += SNAP) starts.push(m)
  const ends: number[] = []
  for (let m = startMin + SNAP; m <= 24 * 60; m += SNAP) ends.push(m)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <select
        value={startMin}
        onChange={e => {
          const next = Number(e.target.value)
          // 길이는 그대로 들고 갑니다. 시작을 옮긴 것이 길이를 바꾸겠다는
          // 뜻은 아니고, 하루 끝을 넘길 때만 줄입니다.
          onChange(next, Math.max(SNAP, Math.min(minutes, 24 * 60 - next)))
        }}
        style={{ ...FIELD, flex: 1 }}
      >
        {starts.map(m => <option key={m} value={m}>{hhmm(m)}</option>)}
      </select>
      <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>→</span>
      <select
        value={startMin + minutes}
        onChange={e => onChange(startMin, Number(e.target.value) - startMin)}
        style={{ ...FIELD, flex: 1 }}
      >
        {ends.map(m => (
          <option key={m} value={m}>{m === 24 * 60 ? '24:00' : hhmm(m)}</option>
        ))}
      </select>
      <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0, minWidth: 44 }}>
        {durationLabel(minutes)}
      </span>
    </div>
  )
}

/**
 * 그 날 찬 자리와 지금 고른 자리.
 *
 * 읽기만 합니다 — 여기서는 아무것도 안 끌립니다. 끌 수 있는 것처럼 보이면
 * 끌어 보게 되고, 안 되면 그건 고장으로 보입니다.
 */
export function BusyStrip({ dayEvents, startMin, minutes }: {
  dayEvents: GCalEvent[]
  startMin: number
  minutes: number
}) {
  const span = (STRIP_TO - STRIP_FROM) * 60
  const pct = (min: number) => Math.max(0, Math.min(100, ((min - STRIP_FROM * 60) / span) * 100))
  const timed = dayEvents.filter(ev => !ev.allDay && ev.startIso && ev.endIso)

  return (
    <div>
      <div style={{
        position: 'relative', height: 16, borderRadius: 3,
        background: 'var(--bg3)', overflow: 'hidden',
      }}>
        {timed.map(ev => {
          const from = pct(minutesOfIso(ev.startIso!))
          const to = pct(minutesOfIso(ev.endIso!))
          if (to <= from) return null
          return (
            <div
              key={ev.id}
              title={`${hhmm(minutesOfIso(ev.startIso!))} ${ev.summary}`}
              style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${from}%`, width: `${Math.max(1, to - from)}%`,
                background: 'var(--bd2)',
              }}
            />
          )
        })}
        {/* 고른 자리. 남의 자리 위에 올라앉아야 겹친 것이 보입니다. */}
        <div
          style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${pct(startMin)}%`,
            width: `${Math.max(1.5, pct(startMin + minutes) - pct(startMin))}%`,
            background: 'var(--ac)', borderRadius: 2,
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        {[6, 9, 12, 15, 18, 21, 24].map(h => (
          <span key={h} style={{ fontSize: 9, color: 'var(--t3)' }}>{h}</span>
        ))}
      </div>
    </div>
  )
}
