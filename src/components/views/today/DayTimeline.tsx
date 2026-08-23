import { useEffect, useMemo, useState } from 'react'
import { useGCalStore, awaitingMe, myAttendance } from '../../../store/gcalStore'
import { useUiStore } from '../../../store/uiStore'
import { openExternal } from '../../../lib/desktopLinks'
import { fmtYMD } from '../../../lib/utils'
import { splitAgenda } from '../../../lib/googleCalendar'
import { Icon } from '../../shared/Icon'
import { RsvpPicker } from '../../shared/RsvpPicker'
import { TimelineGrid } from '../timeline'
import { WidthHandle } from '../../shared/WidthHandle'
import type { GCalEvent } from '../../../store/gcalStore'

/**
 * ── 오늘의 시간 축 ────────────────────────────────────────────────────────────
 *
 * 노트는 **무엇을 할지** 적는 곳이고, 이 칸은 **하루가 어떻게 생겼는지**를
 * 말합니다. 회의가 네 시간 박힌 날과 하나도 없는 날이 화면에서 똑같이 생겼으면,
 * "오늘 이거 셋 하자"는 판단이 아니라 추측입니다.
 *
 * 위는 목록, 아래는 격자입니다. 같은 것을 두 번 그리는 게 아니라 서로 다른
 * 질문에 답합니다 — 목록은 **무엇이** 있는지를 스크롤 없이, 격자는 **몇 시에**
 * 있는지를. 격자에서 회의 이름은 칸 높이만큼만 보여서 30분짜리는 두어 글자에서
 * 잘립니다.
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
 * ── 칸 폭 ────────────────────────────────────────────────────────────────────
 *
 * 사이드바와 같은 줄의 값입니다 — 이 기기의 것이고, 남과 나누지 않습니다.
 *
 * 하한은 회의 이름이 두어 글자로 잘리기 시작하는 지점, 상한은 옆의 노트가
 * 이 칸보다 좁아 보이기 시작하는 지점입니다.
 */
const W_KEY = 'today_rail_width'
const W_DEFAULT = 320
const W_MIN = 260
const W_MAX = 560

function loadWidth(): number {
  try {
    const saved = Number(localStorage.getItem(W_KEY))
    if (saved >= W_MIN && saved <= W_MAX) return saved
  } catch { /* private mode */ }
  return W_DEFAULT
}
function saveWidth(next: number) {
  try { localStorage.setItem(W_KEY, String(Math.round(next))) } catch { /* private mode */ }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 오전 10:30 / 오후 1시 — 좁은 칸이라 24시간제보다 짧게 읽힙니다. */
function clock(d: Date): string {
  const h = d.getHours()
  const m = d.getMinutes()
  const half = h < 12 ? '오전' : '오후'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${half} ${h12}시` : `${half} ${h12}:${pad(m)}`
}

export function DayTimeline({ date }: { date: string }) {
  const [width, setWidth] = useState(loadWidth)
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

  /**
   * 이 날의 일정, 시간 순으로.
   *
   * 아래 격자와 같은 것을 그립니다. 일부러 그렇습니다 — 격자는 '몇 시에'를,
   * 이 목록은 '무엇이'를 말합니다. 격자에서 회의 이름은 칸 높이만큼만 보이고
   * 30분짜리는 두어 글자에서 잘립니다. 하루에 뭐가 있는지는 스크롤 없이
   * 한눈에 읽혀야 합니다.
   */
  const agenda = useMemo(() => {
    const onDay = events.filter(e => e.start <= date && date <= e.end)
    const at = (e: GCalEvent) =>
      e.allDay ? -1 : new Date(e.startIso!).getHours() * 60 + new Date(e.startIso!).getMinutes()
    return onDay.sort((a, b) => at(a) - at(b))
  }, [events, date])

  return (
    <aside style={{
      width, flexShrink: 0,
      borderLeft: '1px solid var(--bd)',
      display: 'flex', flexDirection: 'column', minHeight: 0,
      background: 'var(--bg)',
      // 손잡이가 이 칸의 왼쪽 모서리에 붙어야 해서.
      position: 'relative',
    }}>
      <WidthHandle
        width={width} min={W_MIN} max={W_MAX} defaultWidth={W_DEFAULT}
        side="left" onChange={setWidth} onCommit={saveWidth}
      />
      <div style={{ padding: '12px 10px 8px', borderBottom: '1px solid var(--bd)', flexShrink: 0, maxHeight: '46%', overflowY: 'auto' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', letterSpacing: '.05em', padding: '0 6px', marginBottom: 5 }}>
          {isToday ? '오늘의 일정' : '이 날의 일정'}
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
        ) : agenda.length === 0 ? (
          <div style={{ padding: '2px 6px 4px', fontSize: 12, color: 'var(--t3)' }}>
            잡힌 일정이 없습니다
          </div>
        ) : (
          <>
            {agenda.map(e => <AgendaRow key={e.id} event={e} now={now} today={isToday} />)}
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
            빈 시간을 끌면 일정이 만들어집니다
          </div>
        </>
      )}
    </aside>
  )
}

/**
 * ── 일정 한 줄, 그리고 그 안 ─────────────────────────────────────────────────
 *
 * 접혀 있을 때는 세 조각입니다 — 어느 캘린더인지(네모) · 무엇인지 · 몇 시인지.
 * 회의실이 잡혀 있으면 제목 아래 한 줄이 더 붙습니다. 회의 직전에 알아야 할
 * 건 대개 '어디로 가지'라서, 그건 열어 봐야 나오면 늦습니다.
 *
 * 누르면 **구글로 튀어 나가지 않고 여기서 펴집니다.** 아젠다를 보려고 브라우저
 * 탭을 하나 여는 건 보려던 것보다 큰 동작이고, 돌아올 때 앱은 처음 화면입니다.
 * 구글에서 볼 일이 있으면 안에 버튼이 있습니다.
 *
 * 수락 안 한 초대는 답하는 칸도 같이 펴집니다. 이 목록에서 그걸 보고 있는
 * 사람은 이미 '갈까 말까'를 생각하는 중입니다.
 */
function AgendaRow({ event, now, today }: { event: GCalEvent; now: Date; today: boolean }) {
  const [hovered, setHovered] = useState(false)
  const [open, setOpen] = useState(false)
  const respond = useGCalStore(s => s.respond)

  const colour = event.calendarColor || '#337EA9'
  const pending = awaitingMe(event)
  const mine = myAttendance(event)

  const start = event.allDay ? null : new Date(event.startIso!)
  const end = event.endIso ? new Date(event.endIso) : null
  const past = today && !!end && end.getTime() < now.getTime()

  const { notesUrl, agenda } = splitAgenda(event.description)
  const hasDetail = !!event.location || !!agenda.trim() || !!notesUrl || !!mine

  return (
    <div style={{ margin: '1px 0' }}>
      <button
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '5px 6px', borderRadius: 'var(--r1)',
          border: 'none', background: hovered || open ? 'var(--bg3)' : 'transparent',
          cursor: 'pointer', fontFamily: 'var(--font)', textAlign: 'left',
          opacity: past && !open ? .45 : 1,
          transition: 'background .08s, opacity .1s',
        }}
      >
        <span style={{
          width: 10, height: 10, borderRadius: 3, flexShrink: 0, boxSizing: 'border-box',
          background: pending ? 'transparent' : colour,
          border: pending ? `1.5px dashed ${colour}` : 'none',
        }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--t1)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {event.summary || '(제목 없음)'}
          </span>
          {event.location && (
            <span style={{
              display: 'block', fontSize: 11, color: 'var(--t3)', marginTop: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {event.location}
            </span>
          )}
        </span>
        <span style={{
          flexShrink: 0, fontSize: 11, color: 'var(--t3)', fontVariantNumeric: 'tabular-nums',
        }}>
          {start ? clock(start) : '종일'}
        </span>
      </button>

      {open && (
        <div style={{
          margin: '2px 0 6px 18px', padding: '8px 10px',
          borderLeft: `2px solid ${colour}`,
          background: 'var(--bg2)', borderRadius: '0 var(--r1) var(--r1) 0',
        }}>
          {/* 시각은 접힌 줄이 시작만 말합니다. 펼친 곳에서는 끝까지. */}
          {start && (
            <div style={{ fontSize: 11, color: 'var(--t2)', fontVariantNumeric: 'tabular-nums' }}>
              {clock(start)}{end ? ` – ${clock(end)}` : ''}
            </div>
          )}

          {event.location && (
            <div style={{ fontSize: 12, color: 'var(--t1)', marginTop: 6, display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>장소</span>
              <span style={{ minWidth: 0, wordBreak: 'break-all' }}>{event.location}</span>
            </div>
          )}

          {agenda.trim() && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 3 }}>아젠다</div>
              {/* 구글 설명은 줄바꿈이 뜻입니다 — 목록으로 적힌 것을 한 줄로
                  이어 붙이면 목록이 아니게 됩니다. */}
              <div style={{
                fontSize: 12, color: 'var(--t1)', lineHeight: 1.65,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                maxHeight: 180, overflowY: 'auto',
              }}>
                {agenda.trim()}
              </div>
            </div>
          )}

          {notesUrl && (
            <button
              onClick={() => void openExternal(notesUrl)}
              style={{
                marginTop: 8, width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 8px', borderRadius: 'var(--r1)',
                border: '1px solid var(--bd)', background: 'var(--bg)',
                color: 'var(--t1)', fontSize: 12, fontFamily: 'var(--font)',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <Icon name="file" size={13} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                회의록 열기
              </span>
              <Icon name="external" size={12} />
            </button>
          )}

          {/* 아직 답 안 한 초대는 여기서 답합니다. 이 줄을 들여다보는 사람은
              이미 갈까 말까를 생각하는 중입니다. */}
          {mine && (
            <div style={{ marginTop: 10 }}>
              <RsvpPicker
                compact
                current={mine.responseStatus ?? 'needsAction'}
                onRespond={r => void respond(event.id, r)}
              />
            </div>
          )}

          <button
            onClick={() => void openExternal(event.htmlLink)}
            style={{
              marginTop: hasDetail ? 10 : 8, padding: 0,
              border: 'none', background: 'transparent',
              color: 'var(--t3)', fontSize: 11, cursor: 'pointer',
              fontFamily: 'var(--font)',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--ac)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)' }}
          >
            구글 캘린더로 이동 ↗
          </button>

          {!hasDetail && (
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6, lineHeight: 1.5 }}>
              아젠다와 회의록 링크는 캘린더에서 일정을 눌러 적을 수 있습니다.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
