import React, { useEffect, useMemo, useRef, useState } from 'react'
import { usePrefsStore } from '../../../store/prefsStore'
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
  const timeblockAt = usePrefsStore(s => s.timeblockAt)
  const prefsReady = usePrefsStore(s => s.ready)
  const token = useGCalStore(s => s.token)
  const wasConnected = useGCalStore(s => s.wasConnected)
  // 한 번도 안 받아 왔거나 지금 받는 중이면, 빈 목록은 '없다'가 아니라
  // '아직'입니다. 둘을 같은 말로 적으면 없는 하루가 됩니다.
  const loading = useGCalStore(s => s.loading || !s.fetchedAt)
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
   * 열려 있는 카드. 한 번에 하나입니다.
   *
   * 줄마다 자기 펼침 상태를 들고 있으면 둘이 동시에 열릴 수 있고, 그러면
   * 목록이 아니라 아코디언이 됩니다. 여기 하나로 두면 다른 줄을 누르는
   * 순간 앞의 것이 닫힙니다.
   */
  const [openEvent, setOpenEvent] = useState<{ id: string; rect: DOMRect } | null>(null)

  // 날짜를 넘기거나 목록이 바뀌면 떠 있던 카드는 없는 줄을 가리키게 됩니다.
  useEffect(() => { setOpenEvent(null) }, [date])
  useEffect(() => {
    if (!openEvent) return
    const close = () => setOpenEvent(null)
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [openEvent])

  /**
   * 이 날의 일정, 시간 순으로.
   *
   * 아래 격자와 같은 것을 그립니다. 일부러 그렇습니다 — 격자는 '몇 시에'를,
   * 이 목록은 '무엇이'를 말합니다. 격자에서 회의 이름은 칸 높이만큼만 보이고
   * 30분짜리는 두어 글자에서 잘립니다. 하루에 뭐가 있는지는 스크롤 없이
   * 한눈에 읽혀야 합니다.
   */
  const agenda = useMemo(() => {
    /**
     * ── 타임블록은 이 목록에 안 섭니다 ──────────────────────────────────────
     *
     * 이 목록이 답하는 질문은 '오늘 무슨 약속이 있나'입니다 — 내가 못 옮기는
     * 것들, 하루의 뼈대. 타임블록은 그 반대입니다. 내가 방금 정한 것이고,
     * 바로 아래 시간 축에 이미 그려져 있고, 왼쪽 노트에도 그 줄이 있습니다.
     * 여기까지 넣으면 **한 화면에 같은 것이 세 번** 놓입니다.
     *
     * 그리고 실제로 걸린 문제: 블록을 하나 놓을 때마다 이 목록이 한 줄
     * 길어지면서 아래 시간 축이 그만큼 밀려 내려갔습니다. 방금 놓은 자리를
     * 보고 있던 사람에게는 화면이 덜컹한 것으로 보입니다.
     */
    const onDay = events.filter(e => !e.isBlock && e.start <= date && date <= e.end)
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
      {/* 떠 있는 카드는 눌린 줄의 좌표에 붙어 있습니다 — 목록이 스크롤하면
          그 좌표가 가리키던 줄은 다른 데 가 있으므로 카드를 닫습니다. */}
      <div
        onScroll={() => setOpenEvent(null)}
        style={{ padding: '12px 10px 8px', borderBottom: '1px solid var(--bd)', flexShrink: 0, maxHeight: '46%', overflowY: 'auto' }}
      >
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
        ) : agenda.length === 0 && loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '4px 6px' }}>
            {['70%', '52%', '61%'].map((w, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="bpp-skel" style={{ width: 10, height: 10, borderRadius: 3, flexShrink: 0 }} />
                <span className="bpp-skel" style={{ width: w, height: 11 }} />
              </div>
            ))}
          </div>
        ) : agenda.length === 0 ? (
          <div style={{ padding: '2px 6px 4px', fontSize: 12, color: 'var(--t3)' }}>
            잡힌 일정이 없습니다
          </div>
        ) : (
          <>
            {agenda.map(e => (
              <AgendaRow
                key={e.id} event={e} now={now} today={isToday}
                active={openEvent?.id === e.id}
                onOpen={rect => setOpenEvent(cur => cur?.id === e.id ? null : { id: e.id, rect })}
              />
            ))}
          </>
        )}
      </div>

      {openEvent && (() => {
        const ev = agenda.find(e => e.id === openEvent.id)
        return ev ? <EventPopover event={ev} anchor={openEvent.rect} onClose={() => setOpenEvent(null)} /> : null
      })()}

      {token && (
        <>
          <TimelineGrid days={days} bare />
          {/*
            ── 안내는 한 줄, 아직 안 배운 것부터 ──────────────────────────────
            끌어서 만들 수 있다는 걸 아무도 안 알려주면 이 칸은 그냥 그림
            입니다. 그런데 이제 여기서 하는 일이 둘입니다 — 빈 시간을 끌어
            일정을 만드는 것과, 노트의 줄을 끌어와 시간을 잡는 것.

            **두 줄로 늘리지 않았습니다.** 안내가 두 줄이 되면 둘 다 안
            읽힙니다. 대신 아직 안 해 본 쪽을 보여 줍니다: 타임블록을 한
            번도 안 만들어 봤으면 그것을, 해 봤으면 원래 것을.

            노트에서 끌어오는 쪽을 먼저 두는 이유는 새 기능이라서가 아니라
            **찾을 방법이 없어서**입니다. 빈 시간 끌기는 격자를 보면 해 볼
            만한 동작이지만, 저쪽 창의 줄을 이쪽으로 끌 수 있다는 건 아무
            데도 안 적혀 있으면 알 길이 없습니다.

            한 번 해 보면 사라집니다. 기능을 설명하는 글은 그 기능을 쓰기
            전까지만 쓸모가 있습니다(prefsStore.timeblockAt).
          */}
          <div style={{
            flexShrink: 0, padding: '5px 12px 7px', borderTop: '1px solid var(--bd)',
            fontSize: 10, color: 'var(--t3)', textAlign: 'center',
          }}>
            {prefsReady && !timeblockAt
              ? '왼쪽 노트의 줄을 손잡이로 끌어오면 시간이 잡힙니다'
              : '빈 시간을 끌면 일정이 만들어집니다'}
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
/** 이 앱의 작은 버튼 하나. 캘린더 바의 버튼들과 같은 키(26)·같은 테두리입니다. */
const PILL: React.CSSProperties = {
  height: 26, boxSizing: 'border-box', padding: '0 9px',
  display: 'inline-flex', alignItems: 'center', gap: 5,
  borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
  background: 'transparent', color: 'var(--t2)',
  fontSize: 12, fontFamily: 'var(--font)', cursor: 'pointer',
  whiteSpace: 'nowrap', maxWidth: '100%',
}

/** 일정 카드의 '참석자'·'아젠다'와 같은 이름표입니다. 같은 종류의 값이니까요. */
const LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--t2)', margin: '9px 0 3px',
}

/**
 * 목록의 한 줄.
 *
 * 세 조각입니다 — 어느 캘린더인지(네모) · 무엇인지 · 몇 시인지. 회의실이
 * 잡혀 있으면 제목 아래 한 줄이 더 붙습니다. 회의 직전에 알아야 할 건 대개
 * '어디로 가지'라서, 그건 열어 봐야 나오면 늦습니다.
 *
 * 자세한 건 이 줄이 아니라 **위에 떠서** 보여줍니다(EventPopover). 줄 안에서
 * 폈더니 목록이 통째로 아래로 밀려서, 아젠다 하나 보려다 나머지 일정이 화면
 * 밖으로 나갔습니다. 이 앱이 일정 카드와 ⋯ 메뉴에서 이미 쓰는 방식입니다.
 */
function AgendaRow({ event, now, today, active, onOpen }: {
  event: GCalEvent
  now: Date
  today: boolean
  active: boolean
  onOpen: (rect: DOMRect) => void
}) {
  const [hovered, setHovered] = useState(false)

  const colour = event.calendarColor || '#337EA9'
  const pending = awaitingMe(event)
  const start = event.allDay ? null : new Date(event.startIso!)
  const end = event.endIso ? new Date(event.endIso) : null
  const past = today && !!end && end.getTime() < now.getTime()

  return (
    <button
      onClick={e => onOpen(e.currentTarget.getBoundingClientRect())}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-expanded={active}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 6px', margin: '1px 0', borderRadius: 'var(--r1)',
        border: 'none', background: active || hovered ? 'var(--bg3)' : 'transparent',
        cursor: 'pointer', fontFamily: 'var(--font)', textAlign: 'left',
        opacity: past && !active ? .45 : 1,
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
  )
}

/**
 * ── 줄 위에 떠서 열리는 카드 ─────────────────────────────────────────────────
 *
 * 폭은 누른 줄과 같고, 아래가 좁으면 위로 열립니다 — 일정 카드가 하는 것과
 * 같습니다. 다만 여기서는 높이를 재지 않습니다: 남은 공간을 최대 높이로
 * 주고, 넘치면 카드가 제 안에서 스크롤합니다. 재서 자리를 다시 잡으면
 * 열릴 때마다 한 번씩 '타닥' 합니다.
 *
 * 바깥 클릭은 **잡는 단계로** 듣습니다. 이 칸 위에 있는 격자가 자기
 * mousedown을 멈춰 세우고 있어서, 올라오는 단계로 걸어 둔 귀에는 아무것도
 * 도착하지 않습니다 — 이벤트가 안 온 게 아니라 막힌 것인데 코드에서는
 * 둘이 똑같아 보입니다. MoreMenu의 같은 주석 참고.
 */
function EventPopover({ event, anchor, onClose }: {
  event: GCalEvent
  anchor: DOMRect
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const respond = useGCalStore(s => s.respond)

  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    const t = setTimeout(() => document.addEventListener('mousedown', away, true), 0)
    document.addEventListener('keydown', key, true)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', away, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [onClose])

  const mine = myAttendance(event)
  const { notesUrl, agenda } = splitAgenda(event.description)
  const start = event.allDay ? null : new Date(event.startIso!)
  const end = event.endIso ? new Date(event.endIso) : null

  const GAP = 6
  const below = window.innerHeight - anchor.bottom - GAP - 8
  const above = anchor.top - GAP - 8
  const down = below >= 200 || below >= above
  const place: React.CSSProperties = down
    ? { top: anchor.bottom + GAP, maxHeight: below }
    : { bottom: window.innerHeight - anchor.top + GAP, maxHeight: above }

  return (
    <div
      ref={box}
      style={{
        position: 'fixed', left: anchor.left, width: anchor.width, ...place,
        zIndex: 9500, boxSizing: 'border-box', overflowY: 'auto',
        background: 'var(--bg)', border: '1px solid var(--bd)',
        borderRadius: 'var(--r2)', boxShadow: 'var(--sh-md)', padding: '10px 12px 12px',
      }}
    >
      <div style={{
        fontSize: 13, fontWeight: 600, color: 'var(--t1)', lineHeight: 1.4,
        wordBreak: 'break-word',
      }}>
        {event.summary || '(제목 없음)'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
        {start ? `${clock(start)} – ${end ? clock(end) : ''}` : '하루 종일'}
      </div>

      {event.location && (
        <>
          <div style={LABEL}>장소</div>
          <div style={{ fontSize: 12.5, color: 'var(--t1)', wordBreak: 'break-word' }}>
            {event.location}
          </div>
        </>
      )}

      {agenda.trim() && (
        <>
          <div style={LABEL}>아젠다</div>
          {/* 구글 설명은 줄바꿈이 뜻입니다 — 목록으로 적힌 것을 한 줄로
              이어 붙이면 목록이 아니게 됩니다. */}
          <div style={{
            fontSize: 12.5, color: 'var(--t1)', lineHeight: 1.65,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {agenda.trim()}
          </div>
        </>
      )}

      {/* 아직 답 안 한 초대는 여기서 답합니다. 이 줄을 들여다보는 사람은
          이미 갈까 말까를 생각하는 중입니다. */}
      {mine && (
        <>
          <div style={LABEL}>내 참석</div>
          <RsvpPicker
            compact
            current={mine.responseStatus ?? 'needsAction'}
            onRespond={r => void respond(event.id, r)}
          />
        </>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
        {notesUrl && (
          <button
            onClick={() => void openExternal(notesUrl)}
            style={{ ...PILL, minWidth: 0, borderColor: 'var(--bd2)', color: 'var(--t1)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <Icon name="file" size={12} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>회의록</span>
          </button>
        )}
        <button
          onClick={() => void openExternal(event.htmlLink)}
          style={PILL}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          구글 캘린더
          <Icon name="external" size={12} />
        </button>
      </div>
    </div>
  )
}
