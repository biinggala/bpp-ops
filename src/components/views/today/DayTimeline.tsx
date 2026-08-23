import React, { useEffect, useMemo, useState } from 'react'
import { useGCalStore, awaitingMe } from '../../../store/gcalStore'
import { useUiStore } from '../../../store/uiStore'
import { openExternal } from '../../../lib/desktopLinks'
import { addDays, toDate, fmtYMD } from '../../../lib/utils'
import { tint, readable, geometry, place } from '../timeline'
import type { GCalEvent } from '../../../store/gcalStore'

/**
 * ── 오늘의 시간 축 ────────────────────────────────────────────────────────────
 *
 * 노트는 **무엇을 할지** 적는 곳이고, 이 줄은 **그럴 자리가 있는지**를 말합니다.
 *
 * 그동안 오늘 화면에는 재고만 있었습니다 — 가져올 것이 "이런 일들이 있다"까지는
 * 말했지만, 회의가 네 시간 박힌 날과 하나도 없는 날이 화면에서 똑같이 생겼습니다.
 * 그 상태에서 "오늘 이거 셋 하자"는 판단이 아니라 추측입니다.
 *
 * **읽기만 합니다.** 여기에 무언가를 놓는 동작은 없습니다 — 있으면 노트에 한 번,
 * 여기에 또 한 번 놓게 되고, 그건 담는 곳이 둘이라는 뜻입니다. 담는 곳은 노트
 * 하나입니다. 이 축은 구글 캘린더가 이미 알고 있는 것을 비출 뿐입니다.
 */

const SLOT_H = 44                 // px per hour — 좁은 칸이라 캘린더 뷰(64)보다 낮게
const PX_PER_MIN = SLOT_H / 60
const GUTTER = 34                 // 시각 글자가 서는 폭
export const RAIL_W = 268

/**
 * '남은 시간'을 재는 자.
 *
 * 규칙이 아니라 잣대입니다 — 아무도 9시에 출근해서 7시에 퇴근하라는 뜻이 아니고,
 * "빈 시간 6시간"이라는 말이 성립하려면 하루의 길이를 어디선가 정해야 하기
 * 때문입니다. 24시간으로 재면 늘 넉넉해 보여서 아무 말도 못 합니다.
 */
const WORK_START = 9
const WORK_END = 19

const pad = (n: number) => String(n).padStart(2, '0')

/** 오전 10:30 / 오후 1:00 — 좁은 칸이라 24시간제보다 짧게 읽힙니다. */
function clock(d: Date): string {
  const h = d.getHours()
  const m = d.getMinutes()
  const half = h < 12 ? '오전' : '오후'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${half} ${h12}시` : `${half} ${h12}:${pad(m)}`
}

function hourLabel(h: number): string {
  if (h === 12) return '정오'
  return h < 12 ? `${h}시` : `${h - 12}시`
}

/** 몇 시간 몇 분. 0분이면 시간만, 60분 미만이면 분만. */
function span(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m}분`
  if (!m) return `${h}시간`
  return `${h}시간 ${m}분`
}

/**
 * 겹친 회의를 두 번 세지 않습니다.
 *
 * 10–11시에 두 개가 겹쳐 있으면 나간 시간은 두 시간이 아니라 한 시간입니다.
 * 이 숫자는 '회의 시간의 합'이 아니라 '내가 못 쓰는 시간'이라서요.
 */
function busyMinutes(spans: { from: number; to: number }[], lo: number, hi: number): number {
  const clipped = spans
    .map(s => ({ from: Math.max(s.from, lo), to: Math.min(s.to, hi) }))
    .filter(s => s.to > s.from)
    .sort((a, b) => a.from - b.from)

  let total = 0
  let end = -1
  for (const s of clipped) {
    if (s.from > end) { total += s.to - s.from; end = s.to }
    else if (s.to > end) { total += s.to - end; end = s.to }
  }
  return total
}

export function DayTimeline({ date }: { date: string }) {
  const events = useGCalStore(s => s.events)
  const token = useGCalStore(s => s.token)
  const wasConnected = useGCalStore(s => s.wasConnected)
  const ensureEvents = useGCalStore(s => s.ensureEvents)
  const openCalendar = useUiStore(s => s.openCalendar)

  // 이 축은 하루치지만 '다음 일정'은 내일도 넘겨다봐야 해서 한 주를 받아 둡니다.
  // ensureEvents는 이미 담긴 구간이면 아무것도 안 하므로, 캘린더 화면을 다녀온
  // 뒤라면 요청이 나가지 않습니다.
  useEffect(() => {
    if (!token) return
    void ensureEvents(date, fmtYMD(addDays(toDate(date), 7)))
  }, [token, date, ensureEvents])

  // 1분마다가 아니라 30초마다 — 지금 줄이 반 칸씩 어긋나 보이지 않을 정도로만.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  const today = fmtYMD(now)
  const isToday = date === today

  const { timed, allDay } = useMemo(() => {
    const onDay = events.filter(e => e.start <= date && date <= e.end)
    return {
      timed: onDay.filter(e => !e.allDay && e.startIso),
      allDay: onDay.filter(e => e.allDay),
    }
  }, [events, date])

  const placed = useMemo(() => place(timed), [timed])

  /**
   * 확정된 것만 셉니다.
   *
   * 아직 수락 안 한 초대는 갈지 안 갈지 모르는 일정이라, 그걸 '나간 시간'에
   * 넣으면 오늘이 실제보다 꽉 차 보입니다. 축에는 점선으로 그려 두되 숫자에서는
   * 뺍니다 — 화면과 숫자가 같은 뜻이어야 합니다.
   */
  const { busy, free, count } = useMemo(() => {
    const confirmed = timed.filter(e => !awaitingMe(e))
    const spans = confirmed.map(geometry).filter((g): g is { from: number; to: number } => !!g)
    const b = busyMinutes(spans, WORK_START * 60, WORK_END * 60)
    return { busy: b, free: (WORK_END - WORK_START) * 60 - b, count: confirmed.length }
  }, [timed])

  /** 지금 이후로 가장 가까운 일정. 오늘 것이 없으면 내일, 모레까지 넘어갑니다. */
  const next = useMemo(() => {
    if (!isToday) return null
    const upcoming = events
      .filter(e => !e.allDay && e.startIso && new Date(e.startIso!).getTime() > now.getTime())
      .sort((a, b) => a.startIso!.localeCompare(b.startIso!))
    return upcoming[0] ?? null
  }, [events, isToday, now])

  // 축이 덮는 시간대. 기본은 일과 시간이고, 그보다 이르거나 늦은 일정이 있으면
  // 그만큼만 늘립니다 — 새벽 세 시가 늘 비어 있는 화면은 아무 말도 안 합니다.
  const [fromHour, toHour] = useMemo(() => {
    let lo = WORK_START
    let hi = WORK_END
    placed.forEach(p => {
      lo = Math.min(lo, Math.floor(p.from / 60))
      hi = Math.max(hi, Math.ceil(p.to / 60))
    })
    return [Math.max(0, lo), Math.min(24, Math.max(hi, lo + 1))]
  }, [placed])

  const hours = useMemo(
    () => Array.from({ length: toHour - fromHour }, (_, i) => fromHour + i),
    [fromHour, toHour],
  )
  const originMin = fromHour * 60
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const nowVisible = isToday && nowMin >= originMin && nowMin <= toHour * 60

  return (
    <aside style={{
      width: RAIL_W, flexShrink: 0,
      borderLeft: '1px solid var(--bd)',
      display: 'flex', flexDirection: 'column', minHeight: 0,
      background: 'var(--bg)',
    }}>
      <Header
        date={date}
        isToday={isToday}
        connected={!!token}
        wasConnected={wasConnected}
        busy={busy}
        free={free}
        count={count}
        next={next}
        now={now}
        onConnect={openCalendar}
      />

      {token && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {allDay.length > 0 && (
            <div style={{ padding: `6px 10px 6px ${GUTTER + 10}px`, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {allDay.map(e => <AllDayChip key={e.id} event={e} />)}
            </div>
          )}

          <div style={{ position: 'relative', paddingLeft: GUTTER, paddingRight: 10 }}>
            {hours.map(h => (
              <div key={h} style={{ height: SLOT_H, position: 'relative' }}>
                <span style={{
                  position: 'absolute', left: -GUTTER, top: -6, width: GUTTER - 6,
                  textAlign: 'right', fontSize: 10, color: 'var(--t3)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {hourLabel(h)}
                </span>
                <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, background: 'var(--bd)' }} />
              </div>
            ))}

            {placed.map(p => (
              <Block key={p.event.id} placed={p} originMin={originMin} />
            ))}

            {nowVisible && (
              <div style={{
                position: 'absolute', left: GUTTER - 4, right: 10,
                top: (nowMin - originMin) * PX_PER_MIN,
                height: 0, borderTop: '1.5px solid var(--danger)',
                pointerEvents: 'none', zIndex: 3,
              }}>
                <span style={{
                  position: 'absolute', left: -4, top: -3.5,
                  width: 7, height: 7, borderRadius: '50%', background: 'var(--danger)',
                }} />
              </div>
            )}
          </div>

          <div style={{ height: 24 }} />
        </div>
      )}
    </aside>
  )
}

// ── 머리 ──────────────────────────────────────────────────────────────────────

function Header({ date, isToday, connected, wasConnected, busy, free, count, next, now, onConnect }: {
  date: string
  isToday: boolean
  connected: boolean
  wasConnected: boolean
  busy: number
  free: number
  count: number
  next: GCalEvent | null
  now: Date
  onConnect: () => void
}) {
  return (
    <div style={{ padding: '14px 12px 10px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>
        하루
      </div>

      {!connected ? (
        <>
          <div style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.55, marginBottom: 8 }}>
            구글 캘린더를 연결하면 오늘 회의로 몇 시간이 나가는지, 남는 자리가
            어디인지 여기 보입니다.
          </div>
          <button
            onClick={onConnect}
            style={{
              height: 26, padding: '0 10px', borderRadius: 'var(--r1)',
              border: '1px solid var(--bd)', background: 'transparent',
              fontSize: 12, color: 'var(--t2)', cursor: 'pointer',
              fontFamily: 'var(--font)',
            }}
          >
            {wasConnected ? '캘린더 다시 연결' : '캘린더 연결하기'}
          </button>
        </>
      ) : (
        <>
          {/*
            하루의 크기를 한 줄로.

            '회의 4건'만으로는 아무것도 못 정합니다 — 15분짜리 넷과 두 시간짜리
            넷은 완전히 다른 하루입니다. 그래서 건수가 아니라 시간을 앞에 둡니다.
          */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--t1)', fontVariantNumeric: 'tabular-nums' }}>
              {free > 0 ? span(free) : '0분'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--t3)' }}>비어 있음</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--t3)' }}>
            {count === 0
              ? `${WORK_START}시–${WORK_END}시에 잡힌 일정이 없습니다`
              : `일정 ${count}건 · ${span(busy)} 나감`}
          </div>

          {next && (
            <NextUp event={next} now={now} today={isToday} />
          )}
        </>
      )}
    </div>
  )
}

/**
 * 다음 일정 한 줄.
 *
 * 사이드바에 '다가오는 일정' 목록을 따로 세우는 대신 여기 한 줄로 둡니다.
 * 목록이었다면 프로젝트 수십 개가 깔린 사이드바를 더 길게 만들었을 텐데,
 * 실제로 알고 싶은 건 대개 '다음 것 언제'까지입니다.
 */
function NextUp({ event, now, today }: { event: GCalEvent; now: Date; today: boolean }) {
  const start = new Date(event.startIso!)
  const sameDay = fmtYMD(start) === fmtYMD(now)
  const tomorrow = fmtYMD(start) === fmtYMD(addDays(now, 1))
  const minutesAway = Math.round((start.getTime() - now.getTime()) / 60000)

  const when = sameDay
    // 한 시간 안쪽이면 시각보다 '몇 분 뒤'가 더 쓸모 있습니다.
    ? (minutesAway <= 60 ? `${minutesAway}분 뒤` : clock(start))
    : tomorrow ? `내일 ${clock(start)}`
    : `${start.getMonth() + 1}/${start.getDate()} ${clock(start)}`

  return (
    <button
      onClick={() => void openExternal(event.htmlLink)}
      title={event.summary}
      style={{
        marginTop: 10, width: '100%', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '6px 8px', borderRadius: 'var(--r2)',
        border: '1px solid var(--bd)', background: 'var(--bg2)',
        cursor: 'pointer', fontFamily: 'var(--font)', minWidth: 0,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--bd2)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--bd)' }}
    >
      <span style={{
        width: 3, alignSelf: 'stretch', borderRadius: 2, flexShrink: 0,
        background: event.calendarColor || '#337EA9',
      }} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 10, color: 'var(--t3)' }}>
          {today ? '다음' : '다음 일정'} · {when}
        </span>
        <span style={{
          display: 'block', fontSize: 12, color: 'var(--t1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {event.summary || '(제목 없음)'}
        </span>
      </span>
    </button>
  )
}

// ── 칸 ────────────────────────────────────────────────────────────────────────

function AllDayChip({ event }: { event: GCalEvent }) {
  const colour = event.calendarColor || '#337EA9'
  return (
    <button
      onClick={() => void openExternal(event.htmlLink)}
      title={event.summary}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '3px 7px', borderRadius: 'var(--r1)',
        border: 'none', background: tint(colour, .14), color: readable(colour),
        fontSize: 11, fontFamily: 'var(--font)', cursor: 'pointer',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}
    >
      {event.summary || '(제목 없음)'}
    </button>
  )
}

function Block({ placed, originMin }: {
  placed: { event: GCalEvent; from: number; to: number; lane: number; lanes: number }
  originMin: number
}) {
  const [hovered, setHovered] = useState(false)
  const { event, from, to, lane, lanes } = placed
  const colour = event.calendarColor || '#337EA9'
  // 수락 안 한 초대는 면을 안 칠합니다 — 확정된 것만 칠해져 있어야 오늘이
  // 실제로 얼마나 찼는지 보입니다. 위의 숫자도 이것들을 빼고 셉니다.
  const pending = awaitingMe(event)
  const height = Math.max(15, (to - from) * PX_PER_MIN - 2)

  return (
    <button
      onClick={() => void openExternal(event.htmlLink)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={`${event.summary || '(제목 없음)'}${event.location ? ` · ${event.location}` : ''}`}
      style={{
        position: 'absolute', zIndex: 2,
        top: (from - originMin) * PX_PER_MIN + 1,
        height,
        // 칸이 설 수 있는 폭은 시각 글자(GUTTER)와 오른쪽 여백(10)을 뺀 나머지고,
        // 겹친 개수만큼 그 안에서 나눠 섭니다. 절대 위치라 바깥의 padding이
        // 적용되지 않으므로 여기서 직접 빼 줍니다.
        left: `calc(${GUTTER}px + (100% - ${GUTTER + 10}px) * ${lane / lanes})`,
        width: `calc((100% - ${GUTTER + 10}px) / ${lanes} - 2px)`,
        boxSizing: 'border-box',
        display: 'flex', alignItems: height >= 30 ? 'flex-start' : 'center',
        padding: height >= 30 ? '3px 6px' : '0 6px',
        borderRadius: 'var(--r1)', textAlign: 'left',
        background: pending ? 'transparent' : tint(colour, hovered ? .22 : .15),
        border: pending ? `1px dashed ${tint(colour, .6)}` : '1px solid transparent',
        borderLeft: pending ? `1px dashed ${tint(colour, .6)}` : `2px solid ${colour}`,
        color: readable(colour),
        cursor: 'pointer', fontFamily: 'var(--font)', overflow: 'hidden',
        transition: 'background .1s',
      }}
    >
      <span style={{
        fontSize: 11, lineHeight: 1.3, fontWeight: 500,
        overflow: 'hidden', textOverflow: 'ellipsis',
        display: '-webkit-box', WebkitLineClamp: height >= 44 ? 2 : 1, WebkitBoxOrient: 'vertical',
        wordBreak: 'break-all',
      }}>
        {event.summary || '(제목 없음)'}
      </span>
    </button>
  )
}
