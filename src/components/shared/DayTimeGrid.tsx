import React, { useEffect, useRef } from 'react'
import type { GCalEvent } from '../../store/gcalStore'

/**
 * ── 하루에서 시간을 고르는 격자 ──────────────────────────────────────────────
 *
 * 업무의 일정 패널과 월 화면의 빠른 일정, 두 곳이 같은 질문을 합니다 —
 * **이 날 어디가 비었나.** 그래서 격자도 하나입니다. 복사본이 둘이면 하나는
 * 언젠가 뒤처지고, 그러면 같은 하루가 화면마다 다르게 보입니다.
 */

/** The hours a working day is picked from. Anything outside is typed, not dragged. */
export const HOUR_FROM = 7
const HOUR_TO = 23
const HOUR_H = 26
const SNAP = 15
const GUTTER = 34

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

/**
 * The day's hours, with what is already booked drawn in — drag to take a slot.
 *
 * This replaces a 시작 시간 dropdown and a 길이 dropdown. Two dropdowns can
 * express the same slot, but they cannot answer the question anybody actually
 * has at that moment, which is whether the slot is free.
 */
export function DayTimeGrid({ day, dayEvents, startMin, minutes, onChange }: {
  day: string
  dayEvents: GCalEvent[]
  startMin: number
  minutes: number
  onChange: (startMin: number, minutes: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const hours = Array.from({ length: HOUR_TO - HOUR_FROM }, (_, i) => HOUR_FROM + i)
  const timed = dayEvents.filter(ev => !ev.allDay && ev.startIso && ev.endIso)
  const allDay = dayEvents.filter(ev => ev.allDay)

  const top = (min: number) => ((min - HOUR_FROM * 60) / 60) * HOUR_H

  // Open on the chosen slot rather than at 07:00, so the thing being edited is
  // the thing on screen.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = Math.max(0, top(startMin) - 40)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day])

  const minutesAt = (clientY: number): number => {
    const el = trackRef.current
    if (!el) return startMin
    const rect = el.getBoundingClientRect()
    const raw = HOUR_FROM * 60 + ((clientY - rect.top) / HOUR_H) * 60
    const snapped = Math.round(raw / SNAP) * SNAP
    return Math.max(HOUR_FROM * 60, Math.min(HOUR_TO * 60, snapped))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const anchor = minutesAt(e.clientY)
    let dragged = false
    onChange(anchor, Math.min(60, HOUR_TO * 60 - anchor))

    const move = (ev: PointerEvent) => {
      const to = minutesAt(ev.clientY)
      if (Math.abs(to - anchor) >= SNAP) dragged = true
      const from = Math.min(anchor, to)
      const until = Math.max(anchor, to)
      if (dragged) onChange(from, Math.max(SNAP, until - from))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div>
      {allDay.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 4 }}>
          {allDay.map(ev => (
            <span key={ev.id} title={ev.summary} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'var(--bg3)', color: 'var(--t2)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              종일 · {ev.summary}
            </span>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        style={{ maxHeight: 186, overflowY: 'auto', border: '1px solid var(--bd)', borderRadius: 'var(--r1)', background: 'var(--bg)' }}
      >
        <div style={{ position: 'relative', height: hours.length * HOUR_H }}>
          {/* Hours */}
          {hours.map((h, i) => (
            <div key={h} style={{ position: 'absolute', top: i * HOUR_H, left: 0, right: 0, height: HOUR_H, borderTop: i === 0 ? 'none' : '1px solid var(--bd)' }}>
              <span style={{ position: 'absolute', left: 5, top: -1, fontSize: 9, color: 'var(--t3)', lineHeight: '12px' }}>{h}시</span>
            </div>
          ))}

          {/* What is already there */}
          {timed.map(ev => {
            const s = minutesOfIso(ev.startIso!)
            const e = Math.max(s + SNAP, minutesOfIso(ev.endIso!))
            return (
              <div
                key={ev.id}
                title={`${hhmm(s)} ${ev.summary}`}
                style={{
                  position: 'absolute', left: GUTTER, right: 4,
                  top: top(s), height: Math.max(12, ((e - s) / 60) * HOUR_H),
                  borderRadius: 3, background: 'var(--bg3)',
                  borderLeft: `2px solid ${ev.calendarColor || 'var(--bd2)'}`,
                  fontSize: 10, color: 'var(--t2)', padding: '0 4px',
                  overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                  pointerEvents: 'none', lineHeight: '12px',
                }}
              >{ev.summary}</div>
            )
          })}

          {/* The slot being taken */}
          <div
            style={{
              position: 'absolute', left: GUTTER, right: 4,
              top: top(startMin), height: Math.max(12, (minutes / 60) * HOUR_H),
              borderRadius: 3, background: 'var(--ac)', color: '#fff',
              fontSize: 10, fontWeight: 600, padding: '0 4px', lineHeight: '12px',
              overflow: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none',
              boxShadow: '0 1px 4px rgba(35,131,226,.35)',
            }}
          >{hhmm(startMin)}</div>

          {/* The surface that takes the drag. Above the hour lines, below nothing. */}
          <div
            ref={trackRef}
            onPointerDown={onPointerDown}
            style={{ position: 'absolute', inset: 0, left: GUTTER, cursor: 'crosshair', touchAction: 'none' }}
          />
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 3 }}>비어 있는 시간을 끌어서 고르세요</div>
    </div>
  )
}
