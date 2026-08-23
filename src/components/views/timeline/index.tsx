import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useGCalStore, awaitingMe, myAttendance } from '../../../store/gcalStore'
import { useUiStore } from '../../../store/uiStore'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useTaskStore } from '../../../store/taskStore'
import { useProjectStore } from '../../../store/projectStore'
import { useAuthStore } from '../../../store/authStore'
import { useUserProfileStore } from '../../../store/userProfileStore'
import { authorizedEmails } from '../../../lib/utils'
import type { Task } from '../../../types'
import type { Rsvp } from '../../../lib/googleCalendar'
import { Icon } from '../../shared/Icon'
import { RsvpPicker } from '../../shared/RsvpPicker'
import { MoreMenu } from '../../shared/MoreMenu'
import { useToast } from '../../shared/Toast'
import { useOrgStore, clashesFor, NO_BOOKINGS, type Room, type Booking } from '../../../store/orgStore'
import { addDays, toDate, fmtYMD, isComposing } from '../../../lib/utils'
import { openExternal } from '../../../lib/desktopLinks'
import { splitAgenda, joinAgenda } from '../../../lib/googleCalendar'
import type { GCalEvent } from '../../../store/gcalStore'

/**
 * Day and week timeline.
 *
 * Dragging across empty grid creates a Google Calendar event, following the
 * gesture people already know from Google Calendar: drag from the start time to
 * the end time, then name it. Meetings booked here are for the team to see at a
 * glance — nobody outside is invited, so there are no attendees involved.
 */

// Notion's palette works by pairing a very pale tint with mid-tone text rather
// than filling a shape with saturated colour and putting white on top. The
// timeline follows that: a calendar's colour shows as a bar and a wash, and the
// text stays dark enough to read at 11px.
// (Reference values confirmed from Notion light mode: blue text #487CA5,
// blue background #E7F3F8, green #DBEDDB, brown #EEE0DA.)
export function tint(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return `rgba(55,53,47,${alpha})`
  const [r, g, b] = [0, 2, 4].map(i => parseInt(clean.slice(i, i + 2), 16))
  return `rgba(${r},${g},${b},${alpha})`
}

/**
 * A calendar's colour, darkened enough to read as text.
 *
 * Google hands out saturated colours meant for filled shapes. Notion's text
 * colours are the same hue pulled toward its default ink (#37352F), which is
 * what keeps a coloured label legible at 10px.
 */
export function readable(hex: string): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return '#37352F'
  const mixed = [0, 2, 4].map(i => {
    const channel = parseInt(clean.slice(i, i + 2), 16)
    const ink = [0x37, 0x35, 0x2f][i / 2]
    return Math.round(channel * 0.62 + ink * 0.38)
  })
  return `#${mixed.map(c => c.toString(16).padStart(2, '0')).join('')}`
}

const SLOT_H = 64          // px per hour — a 30-minute block has to fit its own name
const PX_PER_MIN = SLOT_H / 60
const SNAP = 15            // minutes
const MIN_DURATION = 15
export const GUTTER = 52   // width of the hour labels
const HOURS = Array.from({ length: 24 }, (_, i) => i)
/** The hour the grid is scrolled to on open — sits flush with the top edge. */
const DAY_START_HOUR = 9

const snap = (minutes: number) => Math.round(minutes / SNAP) * SNAP
const clampDay = (minutes: number) => Math.max(0, Math.min(24 * 60, minutes))

function hhmm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Google wants local wall-clock time plus a zone, not UTC. */
function localIso(date: string, minutes: number): string {
  return `${date}T${hhmm(minutes)}:00`
}

interface Draft {
  date: string
  fromMinutes: number
  toMinutes: number
}

/**
 * The hour grid, without a toolbar of its own.
 *
 * Navigation and the day/week choice live in the calendar view's header now:
 * this and the month grid are two ranges of one screen, not two screens, so a
 * second set of controls next to the first would only invite the confusion the
 * merge was meant to remove.
 */
/**
 * `lead` days of each end are drawn outside the frame, so that a scroll can
 * park the grid between two days instead of only on one. See useWheelSlide in
 * the calendar view: it writes the sub-day remainder into --slide, which every
 * strip below reads, so the three of them travel as one without React having to
 * redraw a single column.
 */
/**
 * `bare`는 오늘 화면의 좁은 칸에 이 격자를 그대로 끼울 때 씁니다.
 *
 * 두 가지를 뺍니다. **날짜 머리줄** — 하루짜리라 옆 노트가 이미 그 날짜를
 * 말하고 있고, 그 줄을 누르면 업무를 만들게 되어 있는데 오늘 화면에서
 * 업무를 만드는 곳은 우측 상단 버튼 하나입니다. 그리고 **마감 업무 칩** —
 * 그건 노트와 가져올 것이 하는 말이라, 같은 화면에서 세 번 하면 셋 다
 * 흘려보게 됩니다.
 *
 * 시간 격자 자체는 그대로입니다. 끌어서 회의를 만드는 동작이 이 칸에
 * 들어오는 이유이기도 합니다.
 */
export function TimelineGrid({ days, lead = 0, bare = false }: { days: string[]; lead?: number; bare?: boolean }) {
  const { token, events, calendars, createEvent, updateEvent, removeEvent, ensureEvents, respond } = useGCalStore()
  const tasks = useFilteredTasks()
  const updateTask = useTaskStore(s => s.updateTask)
  const openTaskDetail = useUiStore(s => s.openTaskDetail)
  const openTaskModal = useUiStore(s => s.openTaskModal)
  const projectId = useUiStore(s => s.projectId)
  const projects = useProjectStore(s => s.projects)
  const myEmail = useAuthStore(s => s.email)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)

  // Who can be invited: the people this account already shares a project with.
  // Not everyone who has ever signed in — that is a list of accounts, not a team.
  const teammates = useMemo(
    () => [...authorizedEmails(projects, myEmail)].filter(e => e !== myEmail?.toLowerCase()).sort(),
    [projects, myEmail],
  )

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!token) return
    ensureEvents(days[0], days[days.length - 1])
  }, [token, days[0], days[days.length - 1]])

  // ── Drag to create ────────────────────────────────────────────────────────
  const [draft, setDraft] = useState<Draft | null>(null)
  const [naming, setNaming] = useState<Draft | null>(null)
  const [title, setTitle] = useState('')
  /**
   * 아젠다와 회의록 링크.
   *
   * 새 일정은 그냥 빈 칸에서 시작합니다. 이미 있는 일정은 **고르는 순간의
   * 값**이 아니라 초안을 들고 있어야 합니다 — 제목과 같은 이유로, 구글에서
   * 온 값과 지금 치고 있는 값이 다를 수 있고 다른 일정을 고르면 초안은
   * 버려져야 합니다. 그래서 id를 함께 들고 다닙니다.
   */
  const [agenda, setAgenda] = useState('')
  const [notesUrl, setNotesUrl] = useState('')
  const [agendaDraft, setAgendaDraft] = useState<{ id: string; agenda: string; notesUrl: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const ghostRef = useRef<{ id: string; from: number; to: number } | null>(null)
  const dragging = useRef<{ date: string; anchorMinutes: number } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  /**
   * ── 줄이 안 맞던 이유 ──────────────────────────────────────────────────────
   *
   * The day headers and the hour grid draw the same columns with the same
   * flex rules, and they still did not line up.
   *
   * The grid scrolls; the headers do not. Our scrollbar is a *classic* one
   * (index.css gives it a width), so it takes 6px out of the grid's width and
   * nothing out of the header's — and every column line below sat a few pixels
   * left of the one above it, drifting further across the week.
   *
   * So both scrolling rows always reserve the rail (`scrollbar-gutter: stable`,
   * below), and the header reserves exactly as much by measuring it. Measured
   * rather than hard-coded at 6: the number is a stylesheet's opinion today and
   * the platform's tomorrow.
   */
  const [rail, setRail] = useState(0)
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const measure = () => setRail(el.offsetWidth - el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [selected, setSelected] = useState<string | null>(null)
  /** Placing a task on a whole day, opened from that day's header. */
  // A floating card, like Google Calendar's quick-create. Day columns are far
  // too narrow to hold a guest list, and the grid clips anything wider.
  const [cardAt, setCardAt] = useState<{ x: number; y: number } | null>(null)
  const [guests, setGuests] = useState<string[]>([])

  // Moving or stretching an existing event. Held here so the block can be drawn
  // at the new position before Google has confirmed it.
  const [ghost, setGhost] = useState<{ id: string; from: number; to: number } | null>(null)
  const moving = useRef<{ id: string; date: string; grabAt: number; from: number; to: number; mode: 'move' | 'resize' } | null>(null)

  // mouseup fires outside React's render, so the latest ghost is read from a ref.
  useEffect(() => { ghostRef.current = ghost }, [ghost])

  const beginMove = (
    e: React.MouseEvent, event: GCalEvent, date: string, from: number, to: number, mode: 'move' | 'resize',
  ) => {
    e.stopPropagation()
    e.preventDefault()
    const column = (e.currentTarget as HTMLElement).closest('[data-day-column]') as HTMLElement | null
    if (!column) return
    const grabAt = minutesAt(e.clientY, column)
    moving.current = { id: event.id, date, grabAt, from, to, mode }

    const move = (ev: MouseEvent) => {
      const held = moving.current
      if (!held) return
      const at = minutesAt(ev.clientY, column)
      const delta = at - held.grabAt
      if (held.mode === 'move') {
        const length = held.to - held.from
        const start = clampDay(Math.min(24 * 60 - length, Math.max(0, held.from + delta)))
        setGhost({ id: held.id, from: start, to: start + length })
      } else {
        setGhost({ id: held.id, from: held.from, to: clampDay(Math.max(held.from + MIN_DURATION, held.to + delta)) })
      }
    }
    const up = async () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const held = moving.current
      moving.current = null
      const settled = ghostRef.current
      setGhost(null)
      if (!held || !settled) return
      if (settled.from === held.from && settled.to === held.to) return
      await updateEvent(held.id, {
        startDateTime: localIso(held.date, settled.from),
        endDateTime: localIso(held.date, settled.to),
      })
      /**
       * 회의를 옮기면 회의실 예약도 따라갑니다.
       *
       * 안 따라가면 예약은 옛 시간에 남습니다 — 3시로 미룬 회의의 방이 2시에
       * 잡혀 있고, 3시에는 남이 그 방을 잡을 수 있습니다. 화면에는 아무
       * 문제가 없어 보이고, 회의 시간에 방에 가면 다른 팀이 있습니다.
       *
       * 옮긴 시간에 이미 남의 예약이 있으면 **옮기지 않고 말해 줍니다.** 조용히
       * 풀면 방이 없는 회의가 되고, 억지로 겹치면 두 팀이 같은 방에 갑니다.
       */
      await moveBookingWith(held.id, held.date, settled)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const minutesAt = (clientY: number, column: HTMLElement): number => {
    const rect = column.getBoundingClientRect()
    return clampDay(snap((clientY - rect.top) / PX_PER_MIN))
  }

  const beginDrag = (e: React.MouseEvent<HTMLDivElement>, date: string) => {
    if (e.button !== 0 || naming || selected) return   // a popover is open; a stray drag would hide it
    const column = e.currentTarget
    const at = minutesAt(e.clientY, column)
    dragging.current = { date, anchorMinutes: at }
    setDraft({ date, fromMinutes: at, toMinutes: at + MIN_DURATION })

    const move = (ev: MouseEvent) => {
      const held = dragging.current
      if (!held) return
      const to = minutesAt(ev.clientY, column)
      const from = Math.min(held.anchorMinutes, to)
      const until = Math.max(held.anchorMinutes, to)
      setDraft({ date, fromMinutes: from, toMinutes: Math.max(from + MIN_DURATION, until) })
    }
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      dragging.current = null
      setCardAt({ x: ev.clientX, y: ev.clientY })
      setDraft(current => { if (current) { setNaming(current); setTitle(''); setAgenda(''); setNotesUrl(''); setGuests([]) } return null })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ── 회의실 ────────────────────────────────────────────────────────────────
  const orgId = useOrgStore(s => s.orgId)
  const watchDates = useOrgStore(s => s.watchDates)
  const bookingsByDate = useOrgStore(s => s.bookings)
  const bookRoom = useOrgStore(s => s.book)
  const releaseRoom = useOrgStore(s => s.release)
  const releaseForEvent = useOrgStore(s => s.releaseForEvent)
  const retitleForEvent = useOrgStore(s => s.retitleForEvent)
  /** 새 일정에서 고른 방. 일정이 아직 없으므로 저장할 때까지 여기 있습니다. */
  const [draftRoom, setDraftRoom] = useState<string | null>(null)

  // 보고 있는 날짜의 예약만 구독합니다.
  useEffect(() => {
    if (orgId) watchDates('timeline', days)
  }, [orgId, days.join(','), watchDates])

  const bookingFor = (date: string, eventId: string): Booking | null =>
    (bookingsByDate[date] ?? []).find(b => b.eventId === eventId) ?? null

  /** 일정의 시간이 바뀌었을 때, 그 일정에 붙은 예약을 같은 시간으로. */
  const moveBookingWith = async (eventId: string, date: string, next: { from: number; to: number }) => {
    const held = bookingFor(date, eventId)
    if (!held || !myEmail) return
    const clashes = clashesFor(bookingsByDate[date] ?? [], held.roomId, next, eventId)
    const room = useOrgStore.getState().rooms.find(r => r.id === held.roomId)
    if (clashes.length) {
      useToast.getState().show(`${room?.name ?? '회의실'} 예약은 옮기지 못했습니다 — 그 시간에 이미 잡혀 있습니다`)
      return
    }
    await releaseRoom(date, held.id)
    await bookRoom({
      date, roomId: held.roomId, from: next.from, to: next.to,
      title: held.title, eventId, by: myEmail, byName: getNameByEmail(myEmail),
    })
  }

  const save = async () => {
    if (!naming || saving) return
    const name = title.trim()
    if (!name) { setNaming(null); return }
    setSaving(true)
    /**
     * 방 이름을 구글 일정의 **장소**에도 적습니다.
     *
     * 예약 자체는 우리 데이터베이스에 있고 그건 조직원만 읽습니다. 그런데
     * 프로젝트에는 도메인 밖 사람도 있고, 애초에 이 앱을 안 쓰는 사람도
     * 있습니다. 그들에게 '이 회의 어디서 하지'를 답해 줄 유일한 공통 자리가
     * 구글 일정의 장소 칸입니다.
     *
     * 만들 때 같이 넣습니다 — 나중에 붙이면 이미 나간 초대 메일에는 장소가
     * 없고, 메일만 보는 사람에게는 그게 전부입니다.
     */
    const roomName = draftRoom
      ? useOrgStore.getState().rooms.find(r => r.id === draftRoom)?.name
      : undefined
    const description = joinAgenda(notesUrl, agenda)
    const eventId = await createEvent({
      summary: name,
      ...(roomName ? { location: roomName } : {}),
      ...(description ? { description } : {}),
      startDateTime: localIso(naming.date, naming.fromMinutes),
      endDateTime: localIso(naming.date, naming.toMinutes),
      attendees: guests,
    })
    /**
     * 일정이 생긴 뒤에 방을 잡습니다.
     *
     * 순서가 중요합니다 — 예약은 일정 id로 자기가 어느 회의의 것인지 기억하고,
     * 그 id는 구글이 일정을 만들어 준 다음에야 존재합니다. 반대로 하면 주인
     * 없는 예약이 남고, 회의를 지워도 방이 계속 잡혀 있게 됩니다.
     *
     * 일정 만들기가 실패하면 방도 안 잡습니다. 회의 없는 예약은 아무도
     * 치울 수 없습니다.
     */
    if (eventId && draftRoom && myEmail) {
      await bookRoom({
        date: naming.date, roomId: draftRoom,
        from: naming.fromMinutes, to: naming.toMinutes,
        title: name, eventId, by: myEmail, byName: getNameByEmail(myEmail),
      })
    }
    setSaving(false)
    if (eventId) { setNaming(null); setTitle(''); setAgenda(''); setNotesUrl(''); setGuests([]); setDraftRoom(null) }
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  const eventsByDate = useMemo(() => {
    const map = new Map<string, GCalEvent[]>()
    for (const ev of events) {
      if (ev.allDay) continue
      if (!map.has(ev.start)) map.set(ev.start, [])
      map.get(ev.start)!.push(ev)
    }
    return map
  }, [events])

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!t.due) continue
      if (!map.has(t.due)) map.set(t.due, [])
      map.get(t.due)!.push(t)
    }
    return map
  }, [tasks])

  // All-day entries sit above the hours rather than in them, which is where
  // Google Calendar puts both its all-day events and anything merely due today.
  const allDayByDate = useMemo(() => {
    const map = new Map<string, GCalEvent[]>()
    for (const ev of events) {
      if (!ev.allDay) continue
      for (let d = ev.start; d <= ev.end; d = fmtYMD(addDays(toDate(d), 1))) {
        if (!map.has(d)) map.set(d, [])
        map.get(d)!.push(ev)
      }
    }
    return map
  }, [events])

  /**
   * 고른 일정의 제목 — **효과가 아니라 파생 값입니다.**
   *
   * 예전에는 `selectedTitle` 상태를 두고 일정이 바뀔 때 useEffect로 채웠습니다.
   * 그런데 효과는 그린 **다음에** 돕니다. 일정을 고른 첫 프레임에는 제목이
   * 아직 이전 값이라, '고친 게 있다'로 판단돼서 파란 저장 버튼이 한 번 번쩍
   * 하고 사라졌습니다. 일정을 누를 때마다요.
   *
   * 초안이 어느 일정 것인지 함께 들고 있으면 효과가 필요 없습니다. 아직 아무
   * 것도 안 친 일정에서는 구글이 아는 제목이 곧 화면의 제목이고, 그러면 첫
   * 프레임부터 '고친 것 없음'입니다.
   */
  const [titleDraft, setTitleDraft] = useState<{ id: string; text: string } | null>(null)
  const selectedInfo = useMemo(() => {
    if (!selected) return null
    // 날짜도 같이 들고 나옵니다 — 회의실이 비었는지 물으려면 필요하고,
    // 여기서만 알 수 있는 값입니다(이 map의 키입니다).
    for (const [date, list] of eventsByDate) {
      const found = place(list).find(p => p.event.id === selected)
      if (found) return { ...found, date }
    }
    return null
  }, [selected, eventsByDate])
  const shownTitle = selectedInfo
    ? (titleDraft?.id === selectedInfo.event.id ? titleDraft.text : (selectedInfo.event.summary ?? ''))
    : ''

  /** 구글이 아는 설명을 아젠다와 회의록 링크로 갈라 놓은 것. */
  const savedAgenda = useMemo(
    () => splitAgenda(selectedInfo?.event.description),
    [selectedInfo?.event.description],
  )
  const shownAgenda = selectedInfo && agendaDraft?.id === selectedInfo.event.id
    ? agendaDraft
    : { agenda: savedAgenda.agenda, notesUrl: savedAgenda.notesUrl }

  /**
   * 고른 일정에서 실제로 고친 게 있는가 — 이름이나 참석자.
   *
   * 참석자는 순서가 다를 수 있으니 정렬해서 비교합니다. 사람을 넣었다 빼면
   * 목록의 순서가 바뀌는데, 그걸 '고쳤다'로 읽으면 저장 버튼이 안 사라집니다.
   */
  const selectedDirty = useMemo(() => {
    if (!selectedInfo) return false
    if (shownTitle.trim() !== (selectedInfo.event.summary ?? '')) return true
    if (joinAgenda(shownAgenda.notesUrl, shownAgenda.agenda) !== (selectedInfo.event.description ?? '')) return true
    const was = (selectedInfo.event.attendees ?? [])
      .map(a => a.email)
      .filter(email => email !== myEmail?.toLowerCase())
      .sort()
    const now = [...guests].sort()
    return was.length !== now.length || was.some((email, i) => email !== now[i])
  }, [selectedInfo, shownTitle, shownAgenda, guests, myEmail])

  const todayStr = fmtYMD(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  // Open at the start of the working day rather than midnight. The team starts
  // at 10, so the small hours are dead space that only costs a scroll.
  useEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = DAY_START_HOUR * 60 * PX_PER_MIN
  }, [])

  if (!token) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--t3)' }}>
        <div style={{ fontSize: 26, opacity: .4 }}>◷</div>
        <div style={{ fontSize: 14 }}>구글 캘린더를 연동하면 타임라인이 열립니다</div>
        <div style={{ fontSize: 12 }}>캘린더 뷰 상단에서 연동해 주세요</div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Day headers stay put while the hours scroll. */}
      {!bare && (
      <div style={{ display: 'flex', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
        <div style={{ width: GUTTER, flexShrink: 0 }} />
        <Track lead={lead} count={days.length}>
        {days.map(d => {
          const dt = toDate(d)
          const isToday = d === todayStr
          return (
            // The header is the one place in this view that means "the day
            // itself" rather than an hour in it, so it is where placing a task
            // on the day belongs. Dragging the grid below still makes a
            // calendar event, which is a different thing.
            <div
              key={d}
              onClick={() => openTaskModal({ due: d, projectId: projectId ?? undefined })}
              title="이 날에 업무 배치"
              style={{ flex: 1, minWidth: 0, padding: '7px 8px 8px', textAlign: 'center', borderLeft: '1px solid var(--bd)', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ fontSize: 11, color: isToday ? 'var(--ac)' : 'var(--t3)' }}>
                {['일','월','화','수','목','금','토'][dt.getDay()]}
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 1 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: 24, height: 24, borderRadius: '50%',
                  fontSize: 14, fontWeight: isToday ? 700 : 500,
                  background: isToday ? 'var(--ac)' : 'transparent',
                  color: isToday ? '#fff' : 'var(--t1)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {dt.getDate()}
                </span>
              </div>

            </div>
          )
        })}
        </Track>
        <div style={{ width: rail, flexShrink: 0 }} />
      </div>
      )}

      {/* All-day strip: things pinned to the day rather than to a time. */}
      <div style={{
        display: 'flex', flexShrink: 0,
        borderBottom: '1px solid var(--bd2)', background: 'var(--bg2)',
        maxHeight: 112, overflowY: 'scroll', scrollbarGutter: 'stable',
      }}>
        <div style={{ width: GUTTER, flexShrink: 0 }} />
        <Track lead={lead} count={days.length}>
        {days.map(date => (
          <div key={date} style={{ flex: 1, borderLeft: '1px solid var(--bd)', padding: '3px 4px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            {(allDayByDate.get(date) ?? []).map(ev => (
              <a key={ev.id} href={ev.htmlLink || undefined} target="_blank" rel="noopener noreferrer"
                title={ev.summary}
                style={{
                  fontSize: 10, lineHeight: 1.4, padding: '2px 6px', borderRadius: 4,
                  ...(awaitingMe(ev)
                    ? {
                        background: 'transparent',
                        border: `1.5px dashed ${ev.calendarColor || '#337EA9'}`,
                        boxSizing: 'border-box' as const,
                      }
                    : {
                        background: tint(ev.calendarColor || '#337EA9', .13),
                        borderLeft: `3px solid ${ev.calendarColor || '#337EA9'}`,
                      }),
                  color: 'var(--t1)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none',
                }}>
                {ev.summary}
              </a>
            ))}
            {!bare && (tasksByDate.get(date) ?? []).map(task => (
              <DueTask
                key={task.id}
                task={task}
                overdue={date < todayStr}
                onToggle={() => updateTask(task.id, { status: task.status === '완료' ? '진행중' : '완료' })}
                onOpen={() => openTaskDetail(task.id)}
              />
            ))}
            {!(allDayByDate.get(date)?.length || (!bare && tasksByDate.get(date)?.length)) && (
              <div style={{ height: 16 }} />
            )}
          </div>
        ))}
        </Track>
      </div>

      {naming && cardAt && (
        <EventCard
          at={cardAt}
          heading={`${hhmm(naming.fromMinutes)} – ${hhmm(naming.toMinutes)}`}
          title={title}
          onTitle={setTitle}
          agenda={agenda}
          onAgenda={setAgenda}
          notesUrl={notesUrl}
          onNotesUrl={setNotesUrl}
          saving={saving}
          teammates={teammates}
          guests={guests}
          nameOf={getNameByEmail}
          onToggleGuest={email => setGuests(g => g.includes(email) ? g.filter(x => x !== email) : [...g, email])}
          slot={{ date: naming.date, from: naming.fromMinutes, to: naming.toMinutes }}
          /* 아직 일정이 없어서 예약도 없습니다. 고른 방만 기억해 두고, 저장할
             때 새로 생긴 일정 id로 잡습니다. */
          booking={draftRoom ? { id: '', roomId: draftRoom, from: naming.fromMinutes, to: naming.toMinutes, by: '', at: 0 } : null}
          onRoom={setDraftRoom}
          onSave={save}
          onClose={() => { setNaming(null); setTitle(''); setAgenda(''); setNotesUrl(''); setGuests([]); setDraftRoom(null) }}
        />
      )}

      {selectedInfo && cardAt && (
        <EventCard
          at={cardAt}
          heading={`${hhmm(selectedInfo.from)} – ${hhmm(selectedInfo.to)}`}
          title={shownTitle}
          onTitle={text => setTitleDraft({ id: selectedInfo.event.id, text })}
          agenda={shownAgenda.agenda}
          onAgenda={text => setAgendaDraft({ id: selectedInfo.event.id, agenda: text, notesUrl: shownAgenda.notesUrl })}
          notesUrl={shownAgenda.notesUrl}
          onNotesUrl={url => setAgendaDraft({ id: selectedInfo.event.id, agenda: shownAgenda.agenda, notesUrl: url })}
          saving={saving}
          teammates={teammates}
          guests={guests}
          nameOf={getNameByEmail}
          onToggleGuest={email => setGuests(g => g.includes(email) ? g.filter(x => x !== email) : [...g, email])}
          onSave={async () => {
            setSaving(true)
            /**
             * 저장할 때 **나를 다시 넣습니다.**
             *
             * 화면의 참석자 목록에서 나는 빼 놓습니다 — 내 응답은 아래 따로
             * 있고, 목록에서 나를 지울 수 있으면 안 되니까요. 그런데 저장은
             * 그 목록을 그대로 구글에 보냅니다. 그러면 참석자를 한 명
             * 추가하려고 저장한 순간 내가 회의에서 빠집니다.
             *
             * 원래 참석자가 아무도 없던 일정(혼자 쓰는 시간 블록)은 그대로
             * 둡니다. 나 하나를 참석자로 만들면 구글이 나에게 초대장을
             * 보냅니다 — 내가 만든 내 블록에 대해서요.
             */
            const had = selectedInfo.event.attendees ?? []
            const withMe = had.some(a => a.self) && myEmail
              ? [...guests, myEmail.toLowerCase()]
              : guests
            const summary = shownTitle.trim() || selectedInfo.event.summary
            await updateEvent(selectedInfo.event.id, {
              summary, attendees: withMe,
              description: joinAgenda(shownAgenda.notesUrl, shownAgenda.agenda),
            })
            // 예약에 적힌 제목도 같이. 사본은 늙습니다 — 남들이 방 목록에서
            // 읽는 '무슨 회의로 찼는지'가 그 사본입니다.
            await retitleForEvent(selectedInfo.date, selectedInfo.event.id, summary)
            setSaving(false)
            setSelected(null)
          }}
          onDelete={async () => {
            // 방을 먼저 풉니다. 일정이 사라진 뒤에는 어느 예약이 그 일정
            // 것이었는지 알 수 없고, 아무도 못 치우는 예약이 남습니다.
            await releaseForEvent(selectedInfo.date, selectedInfo.event.id)
            await removeEvent(selectedInfo.event.id)
            setSelected(null)
          }}
          openLink={selectedInfo.event.htmlLink}
          responses={selectedInfo.event.attendees}
          slot={{ date: selectedInfo.date, from: selectedInfo.from, to: selectedInfo.to }}
          booking={bookingFor(selectedInfo.date, selectedInfo.event.id)}
          /**
           * 이미 있는 일정은 **바로** 잡고 바로 풉니다.
           *
           * 제목과 달리 회의실은 '고치는 중'인 값이 아닙니다 — 고른 순간이
           * 결정입니다. 저장을 눌러야 반영되면, 고르고 창을 닫은 사람은
           * 방을 잡은 줄 알고 나갑니다. 그건 이 기능이 없애려던 실수와
           * 정확히 같은 실수입니다.
           */
          onRoom={async roomId => {
            const had = bookingFor(selectedInfo.date, selectedInfo.event.id)
            if (had) await releaseForEvent(selectedInfo.date, selectedInfo.event.id)
            const room = roomId ? useOrgStore.getState().rooms.find(r => r.id === roomId) : undefined
            if (roomId && room && myEmail) {
              await bookRoom({
                date: selectedInfo.date, roomId,
                from: selectedInfo.from, to: selectedInfo.to,
                title: selectedInfo.event.summary, eventId: selectedInfo.event.id,
                by: myEmail, byName: getNameByEmail(myEmail),
              })
            }
            /**
             * 장소 칸도 같이 맞춥니다 — 조직 밖 사람이 방을 알 수 있는 유일한
             * 자리입니다.
             *
             * 풀 때는 **그 방 이름일 때만** 지웁니다. 사람이 손으로 적어 둔
             * 장소('3층 로비', 줌 링크)를 예약을 취소했다는 이유로 지우면,
             * 우리가 쓰지도 않은 값을 우리가 없앤 것입니다.
             */
            const location = room ? room.name
              : had?.roomName && selectedInfo.event.location === had.roomName ? ''
              : undefined
            if (location !== undefined) {
              await updateEvent(selectedInfo.event.id, { location })
            }
          }}
          dirty={selectedDirty}
          /* 주최자에게는 안 묻습니다 — myAttendance 참고. 응답 값이 아예
             없는 초대는 '아직 안 함'입니다. 없다고 버튼을 감추면 답할
             방법이 사라집니다. */
          myResponse={(() => {
            const me = myAttendance(selectedInfo.event)
            return me ? (me.responseStatus ?? 'needsAction') : undefined
          })()}
          onRespond={r => { void respond(selectedInfo.event.id, r) }}
          onClose={() => setSelected(null)}
        />
      )}

      <div ref={gridRef} style={{ flex: 1, overflowY: 'scroll', scrollbarGutter: 'stable', position: 'relative' }}>
        <div style={{ display: 'flex', position: 'relative', height: 24 * SLOT_H }}>
          {/* Hour labels */}
          <div style={{ width: GUTTER, flexShrink: 0, position: 'relative' }}>
            {HOURS.map(h => (
              <div key={h} style={{
                position: 'absolute', top: h * SLOT_H - 7, right: 10,
                fontSize: 10, lineHeight: '14px', color: 'var(--t3)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>

          <Track lead={lead} count={days.length} fill>
          {days.map(date => (
            <div
              key={date}
              data-day-column
              onMouseDown={e => beginDrag(e, date)}
              style={{
                flex: 1, minWidth: 0, position: 'relative', cursor: 'crosshair',
                borderLeft: '1px solid var(--bd)',
                background: date === todayStr ? 'rgba(35,131,226,.025)' : 'transparent',
              }}
            >
              {HOURS.map(h => (
                <React.Fragment key={h}>
                  <div style={{ position: 'absolute', top: h * SLOT_H, left: 0, right: 0, height: 1, background: 'var(--bd)' }} />
                  {/* Half-hour guide, faint — it helps aim without ruling the grid. */}
                  <div style={{ position: 'absolute', top: h * SLOT_H + SLOT_H / 2, left: 0, right: 0, height: 1, background: 'var(--bd)', opacity: .4 }} />
                </React.Fragment>
              ))}

              {draft?.date === date && <DraftBlock draft={draft} />}
              {naming?.date === date && <DraftBlock draft={naming} />}

              {place(eventsByDate.get(date) ?? []).map(p => (
                <EventBlock
                  key={p.event.id}
                  placed={p}
                  ghost={ghost?.id === p.event.id ? ghost : null}
                  selected={selected === p.event.id}
                  onSelect={e => {
                    setCardAt({ x: e.clientX, y: e.clientY })
                    setGuests((p.event.attendees ?? []).map(a => a.email).filter(email => email !== myEmail?.toLowerCase()))
                    setSelected(p.event.id)
                  }}
                  onMove={(e, mode) => beginMove(e, p.event, date, p.from, p.to, mode)}
                />
              ))}
              {date === todayStr && (
                <div style={{ position: 'absolute', top: nowMinutes * PX_PER_MIN, left: 0, right: 0, height: 2, background: 'var(--danger)', zIndex: 3 }}>
                  <div style={{ position: 'absolute', left: -4, top: -3, width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)' }} />
                </div>
              )}
            </div>
          ))}
          </Track>
        </div>
      </div>
    </div>
  )
}

/**
 * One horizontal strip of day columns, clipped to the frame.
 *
 * The track is wider than the frame by the two buffer days, and sits pulled
 * left by exactly one of them; --slide, written by the scroll gesture, is the
 * remainder of the day currently being crossed. Percentages do the arithmetic,
 * so nothing here has to know how wide a column actually is.
 */
function Track({ lead, count, fill, children }: {
  lead: number; count: number; fill?: boolean; children: React.ReactNode
}) {
  const visible = Math.max(1, count - lead * 2)
  return (
    <div style={{ flex: 1, minWidth: 0, overflowX: 'clip', ...(fill ? { alignSelf: 'stretch' } : null) }}>
      <div style={{
        display: 'flex',
        width: `${(count / visible) * 100}%`,
        height: fill ? '100%' : undefined,
        transform: lead
          ? `translateX(calc(${(-lead / count) * 100}% + var(--slide, 0px)))`
          : undefined,
      }}>
        {children}
      </div>
    </div>
  )
}

/** Where an event sits and how tall it is, from its own start and end. */
export function geometry(event: GCalEvent): { from: number; to: number } | null {
  if (!event.startIso) return null
  const start = new Date(event.startIso)
  const end = event.endIso ? new Date(event.endIso) : new Date(start.getTime() + 30 * 60000)
  const from = start.getHours() * 60 + start.getMinutes()
  const rawTo = end.getHours() * 60 + end.getMinutes()
  // An event running past midnight reports an earlier clock time for its end.
  const to = rawTo <= from ? 24 * 60 : rawTo
  return { from, to: Math.max(from + MIN_DURATION, to) }
}

export interface Placed {
  event: GCalEvent
  from: number
  to: number
  lane: number
  lanes: number
}

/**
 * Puts overlapping events side by side instead of on top of each other.
 *
 * Two meetings at the same hour is exactly the case this view exists for, so
 * one hiding the other would defeat the point.
 */
export function place(events: GCalEvent[]): Placed[] {
  const spans = events
    .map(event => ({ event, ...(geometry(event) ?? { from: -1, to: -1 }) }))
    .filter(s => s.from >= 0)
    .sort((a, b) => a.from - b.from || a.to - b.to)

  const out: Placed[] = []
  let cluster: typeof spans = []
  let clusterEnd = -1

  const flush = () => {
    if (!cluster.length) return
    const laneEnds: number[] = []
    const assigned = cluster.map(span => {
      let lane = laneEnds.findIndex(end => end <= span.from)
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(span.to) }
      else laneEnds[lane] = span.to
      return { ...span, lane }
    })
    assigned.forEach(a => out.push({ ...a, lanes: laneEnds.length }))
    cluster = []
    clusterEnd = -1
  }

  for (const span of spans) {
    if (cluster.length && span.from >= clusterEnd) flush()
    cluster.push(span)
    clusterEnd = Math.max(clusterEnd, span.to)
  }
  flush()
  return out
}

function EventBlock({ placed, ghost, selected, onSelect, onMove }: {
  placed: Placed
  ghost: { from: number; to: number } | null
  selected: boolean
  onSelect: (e: React.MouseEvent) => void
  onMove: (e: React.MouseEvent, mode: 'move' | 'resize') => void
}) {
  const { event, lane, lanes } = placed
  const from = ghost?.from ?? placed.from
  const to = ghost?.to ?? placed.to
  const width = 100 / lanes
  const colour = event.calendarColor || '#337EA9'
  // 아직 수락 안 한 초대는 면을 안 칠합니다 — 확정된 것만 칠해져 있어야
  // 오늘이 실제로 얼마나 찼는지 보입니다. awaitingMe 참고.
  const pending = awaitingMe(event)
  const height = Math.max(18, (to - from) * PX_PER_MIN - 2)
  // Below roughly two lines there is no room to stack the time above the name,
  // so they share one line and the name takes what is left.
  const roomy = height >= 40

  return (
    <div
      onMouseDown={e => onMove(e, 'move')}
      onClick={e => { e.stopPropagation(); onSelect(e) }}
      title={`${hhmm(from)}–${hhmm(to)}  ${event.summary}`}
      style={{
        position: 'absolute',
        top: from * PX_PER_MIN,
        height,
        left: `calc(${lane * width}% + 3px)`,
        width: `calc(${width}% - 6px)`,
        background: pending ? 'transparent' : tint(colour, ghost ? .28 : .13),
        // 왼쪽 굵은 선은 '이 캘린더의 확정된 일정'이라는 표시입니다. 점선
        // 테두리가 그 자리를 대신하므로 둘을 같이 쓰지 않습니다.
        ...(pending
          ? { border: `1.5px dashed ${colour}`, boxSizing: 'border-box' as const }
          : { borderLeft: `3px solid ${colour}` }),
        borderRadius: 5,
        boxShadow: selected ? `0 0 0 2px ${colour}` : 'none',
        color: 'var(--t1)',
        padding: roomy ? '3px 6px' : '2px 6px',
        fontSize: 11, lineHeight: 1.35,
        overflow: 'hidden', zIndex: selected ? 5 : 2, cursor: 'grab',
        display: 'flex', flexDirection: roomy ? 'column' : 'row',
        gap: roomy ? 0 : 5, alignItems: roomy ? 'stretch' : 'baseline',
      }}
    >
      <span style={{
        fontSize: 10, color: readable(colour), fontWeight: 600,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        {hhmm(from)}
      </span>
      <span style={{
        overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: roomy ? 'normal' : 'nowrap',
        display: roomy ? '-webkit-box' : 'block',
        WebkitLineClamp: roomy ? 2 : undefined,
        WebkitBoxOrient: roomy ? 'vertical' : undefined,
        minWidth: 0,
      }}>
        {event.summary}
      </span>
      <div
        onMouseDown={e => onMove(e, 'resize')}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 8, cursor: 'ns-resize' }}
      />
    </div>
  )
}

/**
 * A task whose deadline lands on this day.
 *
 * Deadlines are not appointments — they belong to the day, not to an hour — so
 * they sit in the all-day strip with a checkbox, the way Google Calendar shows
 * anything due. Ticking it here marks the task complete in the app; there is no
 * calendar entry behind it.
 */
function DueTask({ task, overdue, onToggle, onOpen }: {
  task: Task
  overdue: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const done = task.status === '완료'
  const late = overdue && !done
  return (
    <div
      onClick={onOpen}
      title={`${task.name}${late ? ' · 기한 지남' : ''}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        fontSize: 10, lineHeight: 1.3, padding: '2px 4px', borderRadius: 3,
        border: '1px solid var(--bd)',
        borderLeft: `3px solid ${late ? 'var(--danger)' : done ? 'var(--bd2)' : 'var(--ac)'}`,
        background: 'var(--bg)', cursor: 'pointer', minWidth: 0,
        opacity: done ? .55 : 1,
      }}
    >
      <button
        onClick={e => { e.stopPropagation(); onToggle() }}
        title={done ? '완료 취소' : '완료로 표시'}
        style={{
          width: 12, height: 12, flexShrink: 0, padding: 0, cursor: 'pointer',
          borderRadius: '50%', border: `1.5px solid ${done ? '#448361' : 'var(--bd2)'}`,
          background: done ? '#448361' : 'transparent', color: '#fff', fontSize: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
        }}
      >{done ? '✓' : ''}</button>
      {task.priority === '높음' && !done && (
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--danger)', flexShrink: 0 }} />
      )}
      <span style={{
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textDecoration: done ? 'line-through' : 'none',
        color: late ? 'var(--danger)' : 'var(--t1)',
      }}>{task.name}</span>
    </div>
  )
}

/**
 * ── 참석자 ───────────────────────────────────────────────────────────────────
 *
 * 예전에는 팀원 **전원**을 동그란 칩으로 늘어놓고 고르게 했습니다. 열다섯 명일
 * 때도 벽이었는데 우리는 쉰 명입니다 — 그러면 일정 하나 만드는 데 필요한
 * 이름 두 개를 마흔여덟 개 사이에서 찾아야 합니다. 게다가 이미 초대된
 * 사람들의 응답('수락', '대기')은 카드 저 아래 따로 적혀 있어서, 같은 사람이
 * 화면의 두 군데에 다른 모습으로 있었습니다.
 *
 * 그래서 뒤집었습니다. **초대된 사람만 목록으로** 보이고, 응답은 그 사람 이름
 * 왼쪽에 붙습니다. 추가는 밑의 '초대할 사람'을 눌러 이름을 쳐서 합니다.
 * 화면에 있는 이름 수가 쉰이 아니라 실제 참석자 수만큼입니다.
 *
 * 저장하는 순간 구글이 메일을 보내므로, 아직 발송되지 않은 사람이 몇 명인지
 * 미리 말해 둡니다. 초대장이 조용히 나가면 안 됩니다.
 */

const ROW_H = 26

/** 응답을 한 글자로. 색이 안 보여도 모양이 다릅니다. */
const RESPONSE_MARK: Record<string, { glyph: string; color: string; label: string }> = {
  accepted:    { glyph: '✓', color: '#448361',      label: '수락' },
  declined:    { glyph: '✕', color: 'var(--danger)', label: '거절' },
  tentative:   { glyph: '~', color: '#D9730D',      label: '미정' },
  needsAction: { glyph: '?', color: 'var(--t3)',    label: '응답 대기' },
}

function AttendeeList({ teammates, chosen, nameOf, onToggle, responses }: {
  teammates: string[]
  chosen: string[]
  nameOf: (email: string) => string
  onToggle: (email: string) => void
  responses?: { email: string; responseStatus?: string }[]
}) {
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const [pick, setPick] = useState(0)
  /** 긴 목록은 접습니다. 280px 카드에서 여덟 줄은 카드 전체가 참석자 목록입니다. */
  const [all, setAll] = useState(false)

  const answered = new Map((responses ?? []).map(r => [r.email, r.responseStatus ?? 'needsAction']))
  // 목록에 있지만 아직 구글이 모르는 사람 = 이번에 저장하면 초대장이 갈 사람.
  const fresh = chosen.filter(e => !answered.has(e))

  const needle = q.trim().toLowerCase()
  const candidates = teammates.filter(email =>
    !chosen.includes(email) &&
    (!needle || nameOf(email).toLowerCase().includes(needle) || email.toLowerCase().includes(needle)),
  )

  /**
   * 목록에 없는 주소로도 초대합니다.
   *
   * 회의에 부를 사람이 늘 우리 팀인 건 아닙니다 — 출연자, 외주 디자이너,
   * 클라이언트. 구글은 어떤 주소로든 초대장을 보낼 수 있는데 우리 창만
   * 팀원 목록으로 막고 있었습니다. 막을 이유가 없습니다: 프로젝트 접근
   * 권한과는 아무 상관이 없고, 캘린더 초대장 한 통일 뿐입니다.
   *
   * 이미 목록에 있거나 팀원 후보에 있는 주소면 안 내놓습니다 — 같은 사람이
   * 두 줄로 보이면 어느 쪽을 눌러야 하는지 알 수 없습니다.
   */
  const typedEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(needle) ? needle : null
  const newEmail = typedEmail
      && !chosen.some(e => e.toLowerCase() === typedEmail)
      && !candidates.some(e => e.toLowerCase() === typedEmail)
    ? typedEmail
    : null

  /**
   * 팀원은 이름으로, 바깥 사람은 주소 그대로.
   *
   * getNameByEmail은 모르는 주소를 만나면 앞부분만 떼서 돌려줍니다 —
   * `jh832013@gmail.com`이 'jh832013'이 됩니다. 그러면 바깥으로 나가는
   * 초대가 팀원처럼 보입니다. 밖으로 보내는 것은 밖으로 보이는 게 맞습니다.
   */
  const label = (email: string) => (teammates.includes(email) ? nameOf(email) : email)

  /** 화살표와 Enter가 훑는 한 줄기. 새 주소는 늘 맨 아래입니다 — 'kim@'까지
      쳤을 때 아직 팀원을 좁히는 중일 수 있고, 그때 Enter가 생주소로
      튀면 안 됩니다. */
  const picks: string[] = newEmail ? [...candidates, newEmail] : candidates

  useEffect(() => { setPick(0) }, [q])

  const COLLAPSE_AT = 4
  // 하나만 숨기게 되는 경우는 접지 않습니다 — '1명 전체 보기' 줄이 숨긴 줄과
  // 같은 자리를 차지하니 아낀 게 없습니다.
  const expanded = all || chosen.length <= COLLAPSE_AT + 1
  const shown = expanded ? chosen : chosen.slice(0, COLLAPSE_AT)
  const hidden = chosen.length - shown.length

  /**
   * '2명 수락 · 5명 대기'.
   *
   * 아무도 답하지 않았으면 안 씁니다 — 줄마다 빈 동그라미가 이미 그 말을
   * 하고 있고, 같은 사실을 두 번 말하면 둘 다 안 읽힙니다.
   */
  const tally = (() => {
    if (!chosen.length) return null
    const count = { accepted: 0, declined: 0, tentative: 0, waiting: 0 }
    for (const email of chosen) {
      const status = answered.get(email)
      if (status === 'accepted') count.accepted++
      else if (status === 'declined') count.declined++
      else if (status === 'tentative') count.tentative++
      else count.waiting++
    }
    if (!count.accepted && !count.declined && !count.tentative) return null
    return [
      count.accepted && `${count.accepted}명 수락`,
      count.tentative && `${count.tentative}명 미정`,
      count.declined && `${count.declined}명 거절`,
      count.waiting && `${count.waiting}명 대기`,
    ].filter(Boolean).join(' · ')
  })()

  const add = (email: string | undefined) => {
    if (!email) return
    onToggle(email)
    // 창을 닫지 않습니다 — 회의에 한 명만 부르는 경우는 드뭅니다.
    setQ('')
    setPick(0)
  }

  return (
    <div>
      {chosen.length === 0 && !adding && (
        <div style={{ fontSize: 11, color: 'var(--t3)', padding: '2px 0 4px' }}>아직 아무도 없습니다</div>
      )}

      {/* 몇 명이 답했는지. 여덟 줄을 눈으로 세는 것보다 한 줄이 낫고,
          접혀 있을 때는 이 줄이 접힌 부분을 대신 말해 줍니다. */}
      {tally && (
        <div style={{ fontSize: 11, color: 'var(--t3)', padding: '0 4px 4px' }}>{tally}</div>
      )}

      {shown.map(email => {
        const mark = RESPONSE_MARK[answered.get(email) ?? ''] ?? null
        return (
          <AttendeeRow
            key={email}
            name={label(email)}
            email={email}
            mark={mark}
            onRemove={() => onToggle(email)}
          />
        )
      })}

      {hidden > 0 && (
        <SoftRow icon="⋮" onClick={() => setAll(true)}>
          참석자 {chosen.length}명 전체 보기
        </SoftRow>
      )}

      {adding ? (
        <div style={{ marginTop: 4 }}>
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (isComposing(e)) return
              if (e.key === 'Escape') { e.stopPropagation(); setQ(''); setAdding(false) }
              if (e.key === 'ArrowDown') { e.preventDefault(); setPick(p => Math.min(p + 1, picks.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setPick(p => Math.max(p - 1, 0)) }
              // 카드 전체의 Enter는 '저장'입니다. 이름을 고르는 중에는 여기서 멈춰야 합니다.
              if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(picks[pick]) }
            }}
            placeholder="이름 또는 이메일"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '5px 8px',
              borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
              background: 'var(--bg2)', color: 'var(--t1)', fontSize: 12,
              outline: 'none', fontFamily: 'var(--font)',
            }}
          />
          {/* 여섯 줄까지. 더 있으면 스크롤이 그렇다고 말합니다 — 이름을 더
              치면 좁혀진다는 것도 같이. */}
          <div style={{ maxHeight: ROW_H * 6, overflowY: 'auto', marginTop: 4 }}>
            {picks.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--t3)', padding: '4px 2px', lineHeight: 1.5 }}>
                {needle
                  ? '찾는 사람이 없습니다. 이메일을 전부 쓰면 그 주소로 초대할 수 있습니다.'
                  : teammates.length ? '이름을 쓰거나 이메일을 넣으세요' : '초대할 팀원이 없습니다'}
              </div>
            )}
            {picks.map((email, i) => {
              const outside = email === newEmail
              return (
                <div
                  key={email}
                  onMouseEnter={() => setPick(i)}
                  onMouseDown={e => { e.preventDefault(); add(email) }}
                  title={email}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, height: ROW_H, padding: '0 6px',
                    borderRadius: 'var(--r1)', cursor: 'pointer', fontSize: 12,
                    color: 'var(--t1)', background: i === pick ? 'var(--bg3)' : 'transparent',
                    overflow: 'hidden', whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label(email)}</span>
                  {/* 팀 밖으로 나간다는 것은 말해 줘야 합니다. 주소를 잘못 치면
                      모르는 사람의 받은메일함에 회의가 하나 생깁니다. */}
                  {outside && (
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>
                      팀 밖으로 초대
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <button
            onClick={() => { setQ(''); setAdding(false) }}
            style={{ ...linkBtn, marginTop: 2 }}
          >닫기</button>
        </div>
      ) : (
        <SoftRow icon="＋" onClick={() => setAdding(true)}>초대할 사람</SoftRow>
      )}

      {fresh.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 6, lineHeight: 1.5 }}>
          저장하면 {fresh.length}명에게 구글 캘린더 초대장이 발송됩니다.
        </div>
      )}
    </div>
  )
}

/**
 * 목록 아래에 붙는 한 줄 — '전체 보기', '초대할 사람'.
 *
 * 예전에는 파란 글자 링크였습니다. 링크는 글 안에서 쓰는 것이고, 목록 끝에서
 * 줄 하나를 차지하는 것은 누를 수 있는 **면**이어야 합니다. 테두리는 안 두고
 * 옅게 채웁니다 — 테두리를 두면 위의 참석자 줄들과 같은 무게로 경쟁합니다.
 */
function SoftRow({ icon, children, onClick }: {
  icon: string
  children: React.ReactNode
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        height: ROW_H + 4, padding: '0 4px', marginTop: 2,
        borderRadius: 'var(--r1)', border: 'none', cursor: 'pointer',
        background: hovered ? 'var(--bg2)' : 'var(--bg3)',
        color: 'var(--t2)', fontSize: 12, fontFamily: 'var(--font)',
        textAlign: 'left', transition: 'background .1s',
      }}
    >
      <span style={{
        width: 20, flexShrink: 0, fontSize: 13, lineHeight: 1, color: 'var(--t3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</span>
      {children}
    </button>
  )
}

function AttendeeRow({ name, email, mark, onRemove }: {
  name: string
  email: string
  mark: { glyph: string; color: string; label: string } | null
  onRemove: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={mark ? `${email} · ${mark.label}` : `${email} · 초대 예정`}
      style={{
        display: 'flex', alignItems: 'center', gap: 7, height: ROW_H, padding: '0 4px',
        borderRadius: 'var(--r1)', background: hovered ? 'var(--bg3)' : 'transparent',
      }}
    >
      {/* 아직 초대 안 나간 사람은 빈 동그라미. 응답이 없는 것과 물어본 적이
          없는 것은 다른 상태입니다. */}
      <span style={{
        width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${mark ? mark.color : 'var(--bd2)'}`,
        color: mark ? mark.color : 'transparent', fontSize: 9, lineHeight: 1,
      }}>{mark?.glyph ?? ''}</span>
      <span style={{
        flex: 1, minWidth: 0, fontSize: 12, color: 'var(--t1)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{name}</span>
      <button
        onClick={onRemove}
        aria-label={`${name} 빼기`}
        style={{
          flexShrink: 0, background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--t3)', fontSize: 13, lineHeight: 1, padding: '0 2px',
          opacity: hovered ? 1 : 0, fontFamily: 'var(--font)',
        }}
      >×</button>
    </div>
  )
}

const linkBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--t3)', fontSize: 11, padding: '2px 4px', fontFamily: 'var(--font)',
}

/**
 * The floating panel for naming a new block or editing an existing one.
 *
 * It follows the pointer rather than sitting inside the day column: a week's
 * columns are only tens of pixels wide, and the scrolling grid clips anything
 * that overflows one.
 */
function EventCard({
  at, heading, title, onTitle, saving, teammates, guests, nameOf, onToggleGuest,
  onSave, onDelete, onClose, openLink, slot, booking, onRoom, responses, myResponse, onRespond, dirty = true,
  agenda, onAgenda, notesUrl, onNotesUrl,
}: {
  at: { x: number; y: number }
  heading: string
  title: string
  onTitle: (v: string) => void
  /** 회의 아젠다. 구글 일정의 설명 칸에 그대로 들어갑니다. */
  agenda: string
  onAgenda: (v: string) => void
  /** 회의록 링크. 설명의 첫 줄에 적힙니다 — splitAgenda 참고. */
  notesUrl: string
  onNotesUrl: (v: string) => void
  saving: boolean
  teammates: string[]
  guests: string[]
  nameOf: (email: string) => string
  onToggleGuest: (email: string) => void
  onSave: () => void
  onDelete?: () => void
  onClose: () => void
  openLink?: string
  /**
   * 이 카드가 가리키는 시간. 회의실이 비었는지 물으려면 날짜와 구간이
   * 필요하고, 머리글 문자열에서 그걸 다시 파싱하는 건 같은 값을 두 번
   * 만드는 일입니다.
   */
  slot: { date: string; from: number; to: number }
  /** 지금 잡혀 있는 회의실 예약. 새 일정에는 없습니다. */
  booking?: Booking | null
  onRoom?: (roomId: string | null) => void
  responses?: { email: string; responseStatus?: string }[]
  /** 내 응답. 초대받은 일정에만 있습니다 — 내가 만든 것에는 답할 게 없습니다. */
  myResponse?: string
  onRespond?: (response: Rsvp) => void
  /**
   * 고친 게 있는가.
   *
   * 아무것도 안 고쳤는데 '저장'이 놓여 있으면, 그 버튼이 무엇을 저장하는지
   * 알 수가 없습니다 — 누르면 뭔가 일어날 것 같아서 안 누르게 되고, 그 자리는
   * 계속 신경 쓰이는 자리로 남습니다. 새 일정은 늘 저장할 게 있으므로 기본이
   * 참입니다.
   */
  dirty?: boolean
}) {
  const WIDTH = 280
  const MARGIN = 8
  /** 이만큼도 안 남으면 아래가 아니라 위로 엽니다. */
  const MIN_H = 240

  /**
   * ── 카드는 열린 자리에 그대로 있습니다 ─────────────────────────────────────
   *
   * 전에는 자기 높이를 재서 위치를 다시 잡았습니다. ResizeObserver로 계속
   * 보다가, 창 밖으로 넘칠 것 같으면 위로 밀어 올렸습니다. 문제는 **높이가
   * 한 번에 정해지지 않는다**는 것입니다 — 처음 그릴 때는 0이라 280으로
   * 가정하고, 그 다음 프레임에 진짜 높이(400 남짓)가 오면 위치가 다시
   * 계산됩니다. 그게 일정을 누를 때마다 한 번씩 '타닥' 하고 자리가 바뀌던
   * 것입니다. 참석자 이름이 나중에 도착하거나 칩이 줄바꿈되면 또 움직였고요.
   *
   * 재지 않습니다. 대신 **남은 공간을 카드의 최대 높이로 줍니다.** 아래로
   * 열면 아래 남은 만큼, 위로 열면 위 남은 만큼. 내용이 그보다 길어지면
   * 카드가 제 안에서 스크롤할 뿐 자리는 안 움직입니다. 높이를 몰라도 창
   * 밖으로 안 나가는 게 확실하니 알아볼 이유가 없어집니다.
   *
   * 위로 열 때는 top이 아니라 bottom으로 붙입니다. top으로 붙이면 내용이
   * 늘 때 아래로 자라서 다시 창을 넘습니다.
   */
  const place = useMemo(() => {
    const left = Math.min(Math.max(MARGIN, at.x - WIDTH / 2), window.innerWidth - WIDTH - MARGIN)
    const below = window.innerHeight - at.y - 8 - MARGIN
    if (below >= MIN_H) return { left, top: at.y + 8, maxHeight: below }
    const above = at.y - 8 - MARGIN
    // 위아래 다 좁으면(작은 창) 넓은 쪽으로. 어느 쪽이든 스크롤합니다.
    if (above > below) return { left, bottom: window.innerHeight - at.y + 8, maxHeight: above }
    return { left, top: at.y + 8, maxHeight: Math.max(below, 160) }
  }, [at.x, at.y])

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9600 }} onMouseDown={onClose} />
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{
          position: 'fixed', ...place, width: WIDTH, zIndex: 9601,
          background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)',
          boxShadow: 'var(--sh-lg)', padding: 12,
          overflowY: 'auto', boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--t3)' }}>{heading}</span>
          {/* 삭제는 여기 들어갑니다. 아래에 빨간 버튼으로 놓여 있으면 '저장'
              옆에 나란히 앉아서, 자주 하는 일과 되돌릴 수 없는 일이 같은
              크기로 같은 줄에 있게 됩니다. */}
          {onDelete && (
            <div style={{ marginLeft: 'auto' }}>
              <MoreMenu items={[{ label: '일정 삭제', icon: 'trash', danger: true, onSelect: onDelete }]} />
            </div>
          )}
        </div>
        <input
          autoFocus
          value={title}
          disabled={saving}
          onChange={e => onTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !isComposing(e)) onSave()
            if (e.key === 'Escape') onClose()
          }}
          placeholder="일정 이름"
          style={{
            width: '100%', padding: '6px 8px', borderRadius: 'var(--r1)',
            border: '1px solid var(--bd)', background: 'var(--bg)',
            fontSize: 13, color: 'var(--t1)', outline: 'none', fontFamily: 'var(--font)',
          }}
        />

        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', margin: '10px 0 4px' }}>참석자</div>
        {/* 응답도 여기 있습니다. 예전에는 카드 아래에 '김하연 · 수락'이 따로
            적혀 있어서 같은 사람이 화면 두 군데에 다른 모습으로 있었습니다. */}
        <AttendeeList
          teammates={teammates} chosen={guests} nameOf={nameOf}
          onToggle={onToggleGuest} responses={responses}
        />

        {onRoom && <RoomRow slot={slot} booking={booking ?? null} onPick={onRoom} />}

        <AgendaRow
          agenda={agenda} onAgenda={onAgenda}
          notesUrl={notesUrl} onNotesUrl={onNotesUrl}
          disabled={saving}
        />

        {onRespond && myResponse && (
          <RsvpRow current={myResponse} onRespond={onRespond} />
        )}

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 12, minHeight: 24 }}>
          {dirty && (
            <button onClick={onSave} disabled={saving} style={{ ...navStyle, borderColor: 'var(--ac)', color: '#fff', background: 'var(--ac)' }}>
              {saving ? '저장 중…' : '저장'}
            </button>
          )}
          {openLink && (
            <a href={openLink} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)' }}>
              구글에서 열기 ↗
            </a>
          )}
        </div>
      </div>
    </>
  )
}

/**
 * ── 아젠다와 회의록 ──────────────────────────────────────────────────────────
 *
 * 여기서 만드는 일정의 대부분은 회의입니다. 회의에는 두 가지가 따라다닙니다 —
 * 무슨 얘기를 할 건지, 어디에 적을 건지.
 *
 * 둘 다 구글 일정의 **설명** 칸으로 갑니다. 우리 데이터베이스에 따로 두지
 * 않습니다: 초대받은 사람 중에는 이 앱을 안 쓰는 사람도, 도메인 밖 사람도
 * 있고, 그들이 볼 수 있는 유일한 자리가 거기입니다. 그리고 사본은 늙습니다.
 *
 * 비어 있으면 한 줄로 접혀 있습니다. 대부분의 일정에는 아젠다가 없고, 늘
 * 펴져 있는 빈 상자는 카드를 두 배로 만들 뿐입니다. 적힌 게 있으면 펴집니다 —
 * 접혀 있는데 안에 뭐가 있으면 없는 것과 같으니까요.
 */
function AgendaRow({ agenda, onAgenda, notesUrl, onNotesUrl, disabled }: {
  agenda: string
  onAgenda: (v: string) => void
  notesUrl: string
  onNotesUrl: (v: string) => void
  disabled: boolean
}) {
  const filled = !!agenda.trim() || !!notesUrl.trim()
  const [open, setOpen] = useState(filled)

  // 다른 일정을 골라 카드 내용이 통째로 바뀌면 펼침 상태도 그 일정을 따라야
  // 합니다. 안 그러면 아젠다가 있는 일정이 접힌 채로 열립니다.
  useEffect(() => { setOpen(filled) }, [filled])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          marginTop: 10, padding: 0, border: 'none', background: 'transparent',
          color: 'var(--t3)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font)',
        }}
      >
        + 아젠다 · 회의록 링크
      </button>
    )
  }

  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', margin: '10px 0 4px' }}>아젠다</div>
      <textarea
        value={agenda}
        disabled={disabled}
        onChange={e => onAgenda(e.target.value)}
        rows={3}
        placeholder={'· 지난 주 정리\n· 이번 주 할 것'}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '6px 8px',
          borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
          background: 'var(--bg)', color: 'var(--t1)',
          fontSize: 12, lineHeight: 1.6, fontFamily: 'var(--font)',
          outline: 'none', resize: 'vertical', minHeight: 56,
        }}
      />

      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', margin: '10px 0 4px' }}>회의록</div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input
          value={notesUrl}
          disabled={disabled}
          onChange={e => onNotesUrl(e.target.value)}
          placeholder="링크 붙여넣기"
          style={{
            flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '5px 8px',
            borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
            background: 'var(--bg)', color: 'var(--t1)',
            fontSize: 12, fontFamily: 'var(--font)', outline: 'none',
          }}
        />
        {/* 이미 적혀 있으면 열어 볼 수 있어야 합니다 — 링크를 적어 두고
            그 링크로 못 가는 칸은 반쪽입니다. */}
        {notesUrl.trim() && (
          <button
            onClick={() => void openExternal(notesUrl.trim())}
            title="회의록 열기"
            style={{
              flexShrink: 0, width: 26, height: 26, borderRadius: 'var(--r1)',
              border: '1px solid var(--bd)', background: 'transparent',
              color: 'var(--t2)', cursor: 'pointer', fontSize: 11,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon name="external" size={13} />
          </button>
        )}
      </div>
      <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4, lineHeight: 1.5 }}>
        초대받은 사람 모두가 구글 일정에서 봅니다.
      </div>
    </>
  )
}

/**
 * ── 회의실 ───────────────────────────────────────────────────────────────────
 *
 * 지금까지는 여기서 일정을 만들고, 예약 사이트에 따로 들어가 같은 시간을 한 번
 * 더 입력했습니다. 같은 결정을 두 번 적는 일이고, 두 번째를 잊으면 회의실이
 * 없는 회의가 됩니다.
 *
 * **빈 방과 찬 방을 같이 보여줍니다.** 빈 것만 남기면 '그 방이 왜 없지'를
 * 알 수 없고, 회의 시간을 옮길지 방을 바꿀지 정하려면 누가 쓰고 있는지가
 * 필요합니다. 찬 방은 누를 수 없고 누가 쓰는지 적힙니다.
 *
 * 조직이 없거나 등록된 방이 없으면 이 칸 자체가 없습니다. 회의실이 없는
 * 회사에 회의실 칸을 보여줄 이유가 없습니다.
 */
function RoomRow({ slot, booking, onPick }: {
  slot: { date: string; from: number; to: number }
  booking: Booking | null
  onPick: (roomId: string | null) => void
}) {
  const rooms = useOrgStore(s => s.rooms)
  // 없는 날짜에 매번 새 빈 배열을 돌려주면 무한 렌더입니다 — NO_BOOKINGS 참고.
  const bookings = useOrgStore(s => s.bookings[slot.date] ?? NO_BOOKINGS)
  const orgId = useOrgStore(s => s.orgId)
  const watchDates = useOrgStore(s => s.watchDates)
  const [open, setOpen] = useState(false)

  // 이 카드가 보는 날짜의 예약을 확보합니다. 타임라인이 보는 날짜와 같을
  // 때가 대부분이지만, 주 경계에서 카드만 다른 날을 볼 수 있습니다.
  useEffect(() => {
    if (!orgId) return
    watchDates('card', [slot.date])
    // 카드가 닫히면 이 몫을 놓습니다. 안 그러면 한 번 열어 본 날짜의
    // 리스너가 앱이 살아 있는 동안 계속 남습니다.
    return () => watchDates('card', [])
  }, [orgId, slot.date, watchDates])

  const usable = rooms.filter(r => r.active !== false)
  if (!orgId || !usable.length) return null

  const chosen = booking ? usable.find(r => r.id === booking.roomId) : undefined

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--bd)' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', marginBottom: 6 }}>회의실</div>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '6px 8px', borderRadius: 'var(--r1)', border: 'none', cursor: 'pointer',
            background: 'var(--bg3)', color: chosen ? 'var(--t1)' : 'var(--t3)',
            fontSize: 12.5, fontFamily: 'var(--font)', textAlign: 'left',
          }}
        >
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {chosen ? chosen.name : booking ? '(없어진 회의실)' : '고르지 않음'}
          </span>
          <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>{chosen ? '바꾸기' : '고르기'}</span>
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {usable.map(room => (
            <RoomOption
              key={room.id}
              room={room}
              clashes={clashesFor(bookings, room.id, slot, booking?.eventId)}
              chosen={booking?.roomId === room.id}
              onPick={() => { onPick(room.id); setOpen(false) }}
            />
          ))}
          {booking && (
            <button
              onClick={() => { onPick(null); setOpen(false) }}
              style={{
                marginTop: 2, padding: '5px 8px', borderRadius: 'var(--r1)', border: 'none',
                background: 'transparent', color: 'var(--danger)', fontSize: 12,
                cursor: 'pointer', fontFamily: 'var(--font)', textAlign: 'left',
              }}
            >회의실 예약 취소</button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 목록의 방 한 줄.
 *
 * **찬 방은 무엇 때문에 찼는지까지 말합니다.** 시간과 사람만 적었더니
 * '10:30–12:00 김하연'이었는데, 그걸로는 내 회의를 미룰지 방을 바꿀지 정할
 * 수가 없습니다. 무슨 회의인지 알면 판단이 됩니다 — 주간 정기 회의라면
 * 내가 옮기고, 잠깐 잡아 둔 것이면 물어보면 되니까요.
 *
 * 그래서 찬 방만 두 줄입니다. 첫 줄은 방과 시간, 둘째 줄은 회의 제목과
 * 잡은 사람. 빈 방은 한 줄이고, 그게 대부분이라 목록은 여전히 짧습니다.
 */
function RoomOption({ room, clashes, chosen, onPick }: {
  room: Room
  clashes: Booking[]
  chosen: boolean
  onPick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const taken = clashes.length > 0
  const first = clashes[0]

  return (
    <button
      onClick={taken ? undefined : onPick}
      disabled={taken}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 1, width: '100%',
        padding: taken ? '5px 8px 6px' : '5px 8px',
        borderRadius: 'var(--r1)', border: 'none',
        cursor: taken ? 'default' : 'pointer', fontFamily: 'var(--font)', textAlign: 'left',
        background: chosen ? 'var(--ac-l)' : hovered && !taken ? 'var(--bg3)' : 'transparent',
        opacity: taken ? .6 : 1,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, width: '100%', minWidth: 0 }}>
        <span style={{
          fontSize: 12.5, color: chosen ? 'var(--ac)' : 'var(--t1)',
          fontWeight: chosen ? 600 : 400,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{room.name}</span>
        {taken && first && (
          <span style={{
            marginLeft: 'auto', flexShrink: 0, fontSize: 10.5, color: 'var(--t3)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {hhmm(first.from)}–{hhmm(first.to)}
            {/* 여러 건 겹치면 첫 건만 자세히 적고 나머지는 셉니다. 셋을 다
                적으면 이 줄이 카드 절반을 씁니다. */}
            {clashes.length > 1 ? ` +${clashes.length - 1}` : ''}
          </span>
        )}
      </span>

      {taken && first && (
        <span style={{
          fontSize: 10.5, color: 'var(--t3)', width: '100%', minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {first.title || '(제목 없음)'}
          {first.byName ? ` · ${first.byName}` : ''}
        </span>
      )}

      {!taken && room.note && (
        <span style={{
          fontSize: 10.5, color: 'var(--t3)', width: '100%', minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{room.note}</span>
      )}
    </button>
  )
}

/**
 * ── 갈 건가 ──────────────────────────────────────────────────────────────────
 *
 * 초대만 받아 놓은 일정은 점선으로 그려 두었는데, 그것만으로는 절반입니다 —
 * 점선을 보고 나서 답하려면 앱을 나가 구글로 가야 했습니다. 그 화면에서 하는
 * 일이 '오늘 뭘 할지 정하는 것'인데 정하는 버튼이 딴 데 있었던 겁니다.
 *
 * 세 개를 다 놓습니다. 수락만 놓으면 안 가는 회의를 거절할 데가 없어서 점선이
 * 영원히 남고, 그러면 점선이 '아직 안 정함'이 아니라 '무시하는 것'이 됩니다.
 *
 * **답한 뒤에도 셋이 남지만, 조용해집니다.** 답을 바꾸는 일은 자주 있습니다 —
 * 일정이 겹쳐서 못 가게 되면요 — 그래서 없애면 구글까지 나가야 합니다. 다만
 * 셋이 똑같은 크기로 똑같이 강조돼 있으면 이미 답했는데도 계속 묻고 있는
 * 것처럼 보입니다. 그래서 정하기 전에는 질문의 모양(큰 버튼 셋, '초대받았
 * 습니다')이고, 정한 뒤에는 상태의 모양(작은 한 줄, 고른 것만 표시)입니다.
 * 있는 것은 같고 목소리만 다릅니다.
 */
function RsvpRow({ current, onRespond }: { current: string; onRespond: (r: Rsvp) => void }) {
  const undecided = current === 'needsAction'
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--bd)' }}>
      <div style={{
        fontSize: 11, marginBottom: 6,
        color: undecided ? 'var(--t2)' : 'var(--t3)',
        fontWeight: undecided ? 600 : 400,
      }}>
        {undecided ? '초대받았습니다' : '내 응답'}
      </div>
      <RsvpPicker current={current} onRespond={onRespond} />
    </div>
  )
}

function DraftBlock({ draft }: { draft: Draft }) {
  const height = (draft.toMinutes - draft.fromMinutes) * PX_PER_MIN
  return (
    <div style={{
      position: 'absolute',
      top: draft.fromMinutes * PX_PER_MIN,
      height,
      left: 3, right: 3, borderRadius: 6, zIndex: 7,
      // Opacity on the whole box faded the label along with it; the wash carries
      // the transparency instead so the outline and text stay solid.
      background: 'rgba(35,131,226,.14)',
      border: '1.5px solid var(--ac)',
      boxShadow: '0 1px 4px rgba(35,131,226,.25)',
      padding: '3px 6px', pointerEvents: 'none',
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-start',
      overflow: 'hidden',
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ac)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {hhmm(draft.fromMinutes)} – {hhmm(draft.toMinutes)}
      </span>
      {height >= 34 && (
        <span style={{ fontSize: 10, color: 'var(--ac)', opacity: .75 }}>
          {draft.toMinutes - draft.fromMinutes}분
        </span>
      )}
    </div>
  )
}

const navStyle: React.CSSProperties = {
  padding: '3px 10px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
  background: 'transparent', color: 'var(--t2)', fontSize: 12, cursor: 'pointer',
  fontFamily: 'var(--font)',
}
