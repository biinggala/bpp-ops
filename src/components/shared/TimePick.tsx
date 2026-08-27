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

/**
 * ── 시각 하나를 고르는 단추 ──────────────────────────────────────────────────
 *
 * `<select>`를 썼다가 크게 틀렸습니다. 15분 눈금으로 하루를 담으면 96줄인데,
 * 브라우저는 그걸 **화면을 덮는 한 덩어리**로 폅니다 — 달력이 통째로 가려지고,
 * 지금 무슨 날짜를 보고 있었는지도 안 보입니다. 목록이 길어질 수 있다는 걸
 * 알면서 목록의 생김새를 브라우저에 맡긴 것이 잘못이었습니다.
 *
 * 그래서 우리가 그립니다. 여섯 줄만 보이고, 열면 지금 값이 가운데 와 있습니다 —
 * 구글 캘린더가 하는 것과 같습니다. 아래로 조금만 굴리면 다음 시각들이 있고,
 * 그 사이에도 달력은 계속 보입니다.
 */
export function TimeMenu({ value, options, onPick, width = 92 }: {
  value: number
  options: { at: number; label: string; sub?: string }[]
  onPick: (at: number) => void
  width?: number
}) {
  const btn = React.useRef<HTMLButtonElement>(null)
  const list = React.useRef<HTMLDivElement>(null)
  const [open, setOpen] = React.useState(false)
  const [box, setBox] = React.useState<{ left: number; top: number } | null>(null)

  const show = () => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    // 아래에 자리가 없으면 위로 폅니다. 화면 밖으로 펴 놓고 스크롤하라고
    // 하면 그건 없는 목록입니다.
    const below = window.innerHeight - r.bottom
    setBox({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      top: below > 200 ? r.bottom + 4 : Math.max(8, r.top - 196),
    })
    setOpen(true)
  }

  // 열리면 지금 값으로 굴려 놓습니다. 아침 7시부터 훑어 내려오게 두면
  // 목록을 짧게 만든 뜻이 없습니다.
  React.useEffect(() => {
    if (!open) return
    const el = list.current?.querySelector('[data-on="1"]')
    el?.scrollIntoView({ block: 'center' })
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [open])

  const now = options.find(o => o.at === value)

  return (
    <>
      <button
        ref={btn}
        onClick={show}
        style={{
          width, flexShrink: 0, padding: '4px 8px', textAlign: 'left',
          borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
          background: 'var(--bg2)', color: 'var(--t1)', fontSize: 12.5,
          fontFamily: 'var(--font)', cursor: 'pointer',
          fontVariantNumeric: 'tabular-nums',
        }}
      >{now?.label ?? ''}</button>

      {open && box && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9200 }} onClick={() => setOpen(false)} />
          <div
            ref={list}
            data-scrolls
            style={{
              position: 'fixed', left: box.left, top: box.top, width,
              zIndex: 9201, maxHeight: 192, overflowY: 'auto', padding: 4,
              background: 'var(--bg)', border: '1px solid var(--bd)',
              borderRadius: 'var(--r2)', boxShadow: 'var(--sh-md)',
            }}
          >
            {options.map(o => {
              const on = o.at === value
              return (
                <button
                  key={o.at}
                  data-on={on ? '1' : '0'}
                  onClick={() => { onPick(o.at); setOpen(false) }}
                  style={{
                    display: 'flex', alignItems: 'baseline', gap: 5, width: '100%',
                    padding: '4px 7px', borderRadius: 'var(--r1)', border: 'none',
                    background: on ? 'var(--bg3)' : 'transparent',
                    color: 'var(--t1)', fontSize: 12.5, fontFamily: 'var(--font)',
                    cursor: 'pointer', textAlign: 'left',
                    fontWeight: on ? 600 : 400,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                  onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'var(--bg2)' }}
                  onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}
                >
                  {o.label}
                  {o.sub && <span style={{ fontSize: 10.5, color: 'var(--t3)' }}>{o.sub}</span>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </>
  )
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
  const starts = React.useMemo(() => {
    const out: { at: number; label: string }[] = []
    for (let m = 0; m < 24 * 60; m += SNAP) out.push({ at: m, label: hhmm(m) })
    return out
  }, [])
  const ends = React.useMemo(() => {
    // 길이는 옆에 이미 적혀 있습니다. 줄마다 또 적었더니 '1시간 15분'이
    // 좁은 칸에서 세 줄로 접혀서, 시각을 고르는 목록이 시각보다 길이로
    // 읽혔습니다.
    const out: { at: number; label: string }[] = []
    for (let m = startMin + SNAP; m <= 24 * 60; m += SNAP) {
      out.push({ at: m, label: m === 24 * 60 ? '24:00' : hhmm(m) })
    }
    return out
  }, [startMin])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <TimeMenu
        value={startMin}
        options={starts}
        // 길이는 그대로 들고 갑니다. 시작을 옮긴 것이 길이를 바꾸겠다는
        // 뜻은 아니고, 하루 끝을 넘길 때만 줄입니다.
        onPick={next => onChange(next, Math.max(SNAP, Math.min(minutes, 24 * 60 - next)))}
      />
      <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>→</span>
      <TimeMenu
        value={startMin + minutes}
        options={ends}
        onPick={at => onChange(startMin, at - startMin)}
      />
      <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>
        {durationLabel(minutes)}
      </span>
    </div>
  )
}

/**
 * ── 그 날 찬 자리와 지금 고른 자리 ───────────────────────────────────────────
 *
 * 파란 칸을 끌면 15분씩 움직입니다. 목록으로 고르는 것과 같은 일을 하지만,
 * **찬 자리를 피해 놓는 일**에는 이쪽이 훨씬 짧습니다 — 회색 사이의 빈 곳으로
 * 밀어 넣으면 되고, 그게 눈이 이미 하고 있던 판단입니다.
 *
 * 길이는 안 바뀝니다. 끄는 동안 양쪽이 다 움직이면 어디에 놓이는지 읽기가
 * 어렵고, 길이는 바로 위 목록과 아래 알약이 이미 정확하게 정합니다.
 *
 * 띠는 6시부터 24시까지만 그립니다. 그보다 이른 시각은 끌어서 못 가는데,
 * 그건 목록이 답합니다 — 새벽 회의를 끌어서 잡는 사람은 없습니다.
 */
export function BusyStrip({ dayEvents, startMin, minutes, onChange }: {
  dayEvents: GCalEvent[]
  startMin: number
  minutes: number
  /** 없으면 읽기만 합니다. */
  onChange?: (startMin: number) => void
}) {
  const track = React.useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = React.useState(false)
  const span = (STRIP_TO - STRIP_FROM) * 60
  const pct = (min: number) => Math.max(0, Math.min(100, ((min - STRIP_FROM * 60) / span) * 100))
  const timed = dayEvents.filter(ev => !ev.allDay && ev.startIso && ev.endIso)

  const minuteAt = (clientX: number): number => {
    const r = track.current?.getBoundingClientRect()
    if (!r || !r.width) return startMin
    const raw = STRIP_FROM * 60 + ((clientX - r.left) / r.width) * span
    return Math.round(raw / SNAP) * SNAP
  }

  const grab = (e: React.PointerEvent) => {
    if (!onChange) return
    e.preventDefault()
    // 잡은 지점과 시작 사이의 거리를 들고 갑니다. 안 그러면 칸이 손가락
    // 아래로 순간이동해서, 놓으려던 자리가 아니라 잡은 자리가 됩니다.
    const offset = startMin - minuteAt(e.clientX)
    setDragging(true)
    const move = (ev: PointerEvent) => {
      const next = minuteAt(ev.clientX) + offset
      onChange(Math.max(0, Math.min(24 * 60 - minutes, next)))
    }
    const up = () => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div>
      <div
        ref={track}
        style={{
          position: 'relative', height: 16, borderRadius: 3,
          background: 'var(--bg3)', overflow: 'hidden',
          touchAction: onChange ? 'none' : undefined,
        }}
      >
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
          onPointerDown={grab}
          title={onChange ? `${hhmm(startMin)}–${hhmm(startMin + minutes)} — 끌어서 옮기기` : undefined}
          style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${pct(startMin)}%`,
            width: `${Math.max(1.5, pct(startMin + minutes) - pct(startMin))}%`,
            background: 'var(--ac)', borderRadius: 2,
            cursor: onChange ? (dragging ? 'grabbing' : 'grab') : 'default',
            // 끄는 동안은 그림자로 손에 들려 있다고 말해 줍니다.
            boxShadow: dragging ? '0 1px 6px rgba(35,131,226,.5)' : 'none',
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
