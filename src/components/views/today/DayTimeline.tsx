import { useEffect, useMemo, useState } from 'react'
import { useGCalStore, awaitingMe } from '../../../store/gcalStore'
import { useUiStore } from '../../../store/uiStore'
import { openExternal } from '../../../lib/desktopLinks'
import { addDays, fmtYMD } from '../../../lib/utils'
import { TimelineGrid, geometry } from '../timeline'
import type { GCalEvent } from '../../../store/gcalStore'

/**
 * ── 오늘의 시간 축 ────────────────────────────────────────────────────────────
 *
 * 노트는 **무엇을 할지** 적는 곳이고, 이 칸은 **그럴 자리가 있는지**를 말합니다.
 *
 * 그동안 오늘 화면에는 재고만 있었습니다 — 가져올 것이 "이런 일들이 있다"까지는
 * 말했지만, 회의가 네 시간 박힌 날과 하나도 없는 날이 화면에서 똑같이 생겼습니다.
 * 그 상태에서 "오늘 이거 셋 하자"는 판단이 아니라 추측입니다.
 *
 * 격자는 캘린더 뷰의 하루 뷰를 그대로 씁니다(`TimelineGrid bare`). 하루 종일이
 * 스크롤로 다 있고, **빈 곳을 끌면 회의가 만들어집니다** — 갑자기 잡힌 회의를
 * 여기서 바로 넣을 수 있어야 이 칸이 보는 것에서 그치지 않습니다.
 *
 * 다만 **업무를 만드는 곳은 아닙니다.** 오늘 화면에서 업무가 생기는 곳은 노트와
 * 우측 상단 버튼 둘뿐이고, 여기까지 그 일을 하면 담는 곳이 셋이 됩니다.
 * 그래서 날짜 머리줄(눌러서 업무 배치)과 마감 업무 칩은 빼고 붙였습니다.
 */

/**
 * '남은 시간'을 재는 자.
 *
 * 규칙이 아니라 잣대입니다 — 9시에 출근해 7시에 퇴근하라는 뜻이 아니라,
 * "빈 시간 6시간"이라는 말이 성립하려면 하루의 길이를 어디선가 정해야 하기
 * 때문입니다. 24시간으로 재면 늘 넉넉해 보여서 아무 말도 못 합니다.
 * (격자는 이 창과 무관하게 0시부터 24시까지 전부 있습니다. 야근은 야근대로.)
 */
const WORK_START = 9
const WORK_END = 19

export const RAIL_W = 320

const pad = (n: number) => String(n).padStart(2, '0')

/** 오전 10:30 / 오후 1시 — 좁은 칸이라 24시간제보다 짧게 읽힙니다. */
function clock(d: Date): string {
  const h = d.getHours()
  const m = d.getMinutes()
  const half = h < 12 ? '오전' : '오후'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${half} ${h12}시` : `${half} ${h12}:${pad(m)}`
}

/** 몇 시간 몇 분. */
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
  const openCalendar = useUiStore(s => s.openCalendar)

  // 일정을 받아 오는 건 아래 격자가 합니다 — 한 번 부르면 앞뒤 45일이
  // 딸려 오므로 '다음 일정'이 내일을 넘겨다보는 데도 모자라지 않습니다.
  const days = useMemo(() => [date], [date])

  // 30초마다. '몇 분 뒤'가 반 칸씩 어긋나 보이지 않을 정도로만.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  const isToday = date === fmtYMD(now)

  const timed = useMemo(
    () => events.filter(e => !e.allDay && e.startIso && e.start <= date && date <= e.end),
    [events, date],
  )

  /**
   * 확정된 것만 셉니다.
   *
   * 아직 수락 안 한 초대는 갈지 안 갈지 모르는 일정이라, 그걸 '나간 시간'에
   * 넣으면 오늘이 실제보다 꽉 차 보입니다. 격자에는 점선으로 그려져 있되
   * 숫자에서는 뺍니다 — 화면과 숫자가 같은 뜻이어야 합니다.
   */
  const { busy, free, count } = useMemo(() => {
    const confirmed = timed.filter(e => !awaitingMe(e))
    const spans = confirmed.map(geometry).filter((g): g is { from: number; to: number } => !!g)
    const b = busyMinutes(spans, WORK_START * 60, WORK_END * 60)
    return { busy: b, free: (WORK_END - WORK_START) * 60 - b, count: confirmed.length }
  }, [timed])

  /**
   * ── 다가오는 일정 ──────────────────────────────────────────────────────────
   *
   * 아래 격자는 하루치입니다. 이 목록은 거기서 잘리는 것 — 내일, 모레 —
   * 을 맡습니다. 그래서 둘이 겹치는 건 '오늘 남은 것'뿐이고, 그건 겹쳐도
   * 되는 부분입니다: 격자에서는 몇 시인지가, 여기서는 무엇인지가 보입니다.
   *
   * 사이드바에 목록을 따로 세우지 않는 이유이기도 합니다. 프로젝트 수십 개가
   * 깔린 열을 더 길게 만드는 대신, 하루를 들여다보는 자리에 붙여 둡니다.
   */
  const upcoming = useMemo(() => {
    if (!isToday) return []
    const from = now.getTime()
    const dated = events
      .map(e => ({
        e,
        // 종일 일정은 시각이 없으므로 그날 0시로 세웁니다 — 목록 안에서
        // 그날의 맨 앞에 서면 됩니다.
        at: e.allDay ? new Date(`${e.start}T00:00:00`).getTime() : new Date(e.startIso!).getTime(),
      }))
      .filter(x => (x.e.allDay ? x.e.end >= fmtYMD(now) : x.at > from))
      .sort((a, b) => a.at - b.at)
    return dated.slice(0, UPCOMING_MAX).map(x => x.e)
  }, [events, isToday, now])

  return (
    <aside style={{
      width: RAIL_W, flexShrink: 0,
      borderLeft: '1px solid var(--bd)',
      display: 'flex', flexDirection: 'column', minHeight: 0,
      background: 'var(--bg)',
    }}>
      <div style={{ padding: '14px 12px 10px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t3)', letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 8 }}>
          하루
        </div>

        {!token ? (
          <>
            <div style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.55, marginBottom: 8 }}>
              구글 캘린더를 연결하면 오늘 회의로 몇 시간이 나가는지, 남는 자리가
              어디인지 여기 보입니다.
            </div>
            <button
              onClick={openCalendar}
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
              하루의 크기는 한 줄이면 충분합니다.
              큰 숫자로 세워 뒀더니 아래 목록보다 커서, 정작 무슨 회의가 있는지가
              뒤로 밀렸습니다. 알아야 하는 건 '얼마나 남았나'와 '뭐가 오나' 둘 다고,
              둘의 크기가 같아야 둘 다 읽힙니다.

              그래도 건수가 아니라 시간이 앞입니다 — 15분짜리 넷과 두 시간짜리
              넷은 완전히 다른 하루입니다.
            */}
            <div style={{ fontSize: 12, color: 'var(--t2)', fontVariantNumeric: 'tabular-nums' }}>
              {count === 0
                ? `${WORK_START}–${WORK_END}시에 잡힌 일정 없음`
                : <>
                    <span style={{ color: 'var(--t1)', fontWeight: 600 }}>{free > 0 ? span(free) : '0분'}</span>
                    {' 비어 있음 · '}{span(busy)} 나감
                  </>}
            </div>

            {upcoming.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 4 }}>
                  다가오는 일정
                </div>
                {upcoming.map(e => <UpcomingRow key={e.id} event={e} now={now} />)}
              </div>
            )}
          </>
        )}
      </div>

      {token && (
        <>
          <TimelineGrid days={days} bare />
          {/* 끌어서 만들 수 있다는 걸 아무도 안 알려주면 이 칸은 그냥 그림입니다. */}
          <div style={{
            flexShrink: 0, padding: '5px 12px 7px', borderTop: '1px solid var(--bd)',
            fontSize: 10, color: 'var(--t3)', textAlign: 'center',
          }}>
            빈 시간을 끌면 회의가 만들어집니다
          </div>
        </>
      )}
    </aside>
  )
}

/** 목록에 세우는 개수. 더 늘리면 격자가 화면 밖으로 밀립니다. */
const UPCOMING_MAX = 6

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

/**
 * 한 줄, 세 조각: 어느 캘린더인지(네모) · 무엇인지(제목) · 언제인지(시각).
 *
 * 수락 안 한 초대는 속을 안 칠한 점선 네모입니다 — 격자에서 쓰는 표시와 같게
 * 둡니다. 같은 사실을 두 곳에서 다르게 그리면 둘 중 하나는 다른 뜻으로 읽힙니다.
 */
function UpcomingRow({ event, now }: { event: GCalEvent; now: Date }) {
  const [hovered, setHovered] = useState(false)
  const colour = event.calendarColor || '#337EA9'
  const pending = awaitingMe(event)

  const start = event.allDay ? new Date(`${event.start}T00:00:00`) : new Date(event.startIso!)
  const days = Math.round(
    (new Date(fmtYMD(start) + 'T00:00:00').getTime() - new Date(fmtYMD(now) + 'T00:00:00').getTime()) / 86400000,
  )
  const day = days === 0 ? '' : days === 1 ? '내일 ' : days < 7 ? `${WEEKDAY[start.getDay()]} ` : `${start.getMonth() + 1}/${start.getDate()} `
  const when = event.allDay ? `${day}종일` : `${day}${clock(start)}`

  return (
    <button
      onClick={() => void openExternal(event.htmlLink)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={event.summary}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 6px', margin: '1px 0', borderRadius: 'var(--r1)',
        border: 'none', background: hovered ? 'var(--bg3)' : 'transparent',
        cursor: 'pointer', fontFamily: 'var(--font)', textAlign: 'left',
        transition: 'background .08s',
      }}
    >
      <span style={{
        width: 10, height: 10, borderRadius: 3, flexShrink: 0, boxSizing: 'border-box',
        background: pending ? 'transparent' : colour,
        border: pending ? `1.5px dashed ${colour}` : 'none',
      }} />
      <span style={{
        flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: 'var(--t1)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {event.summary || '(제목 없음)'}
      </span>
      <span style={{
        flexShrink: 0, fontSize: 11, color: 'var(--t3)', fontVariantNumeric: 'tabular-nums',
      }}>
        {when}
      </span>
    </button>
  )
}
