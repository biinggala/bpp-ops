import React, { useState, useMemo, useRef, useEffect, useCallback, Component } from 'react'
import { createPortal } from 'react-dom'
import { useUiStore } from '../../../store/uiStore'
import { useFilteredTasks } from '../../../hooks/useFilteredTasks'
import { useTaskStore } from '../../../store/taskStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { haptic } from '../../../lib/haptics'
import { useProjectStore } from '../../../store/projectStore'
import { useGCalStore, warmCalendarAuth, targetCalendarOf, PEEK_COLOR } from '../../../store/gcalStore'
import { ActionMenu } from '../../shared/ContextMenu'
import { TimeRange, BusyStrip, localIso, minutesOfIso } from '../../shared/TimePick'
import { TimelineGrid, AttendeeList, RoomRow, GUTTER as HOUR_GUTTER } from '../timeline'
import { writableCalendars } from '../../../lib/googleCalendar'
import { useOrgStore } from '../../../store/orgStore'
import { useAuthStore } from '../../../store/authStore'
import { useUserProfileStore } from '../../../store/userProfileStore'
import { useToast } from '../../shared/Toast'
import type { CalRange } from '../../../types'
import type { GCalEvent } from '../../../store/gcalStore'
import { awaitingMe } from '../../../store/gcalStore'
import { useMobile } from '../../../hooks/useMobile'
import { getCatColor, NOTION } from '../../../types'
import { addDays, toDate, fmtYMD, dayDiff, getBlockingCascade, authorizedEmails, isComposing } from '../../../lib/utils'
import type { Task } from '../../../types'
import { useShallow } from 'zustand/react/shallow'

type Chip = { kind: 'gcal'; ev: GCalEvent } | { kind: 'task'; t: Task }

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

const fmt = fmtYMD
const parseDate = toDate

// Google Calendar event color
const GCAL_BG   = 'rgba(68,131,97,.18)'
const GCAL_TEXT = '#448361'

// ── Status badge (mobile) ─────────────────────────────────────────────────────

const MOB_STATUS: Record<string, { bg: string; color: string }> = {
  '진행중': { bg: 'rgba(35,131,226,.15)', color: '#487CA5' },
  '대기':   { bg: 'rgba(120,117,114,.14)', color: '#5a5857' },
  '검토중': { bg: '#fef3c7',              color: '#D9730D' },
  '완료':   { bg: '#d1fae5',              color: '#448361' },
}

// ── GCal connect button ───────────────────────────────────────────────────────

function GCalButton() {
  const { token, loading, autoRefreshing, wasConnected, error, calendars, enabledCalendarIds, targetCalendarId, connect, disconnect, autoReconnect, fetchCalendars, setCalendarEnabled, refreshEvents } = useGCalStore(useShallow(s => ({ token: s.token, loading: s.loading, autoRefreshing: s.autoRefreshing, wasConnected: s.wasConnected, error: s.error, calendars: s.calendars, enabledCalendarIds: s.enabledCalendarIds, targetCalendarId: s.targetCalendarId, connect: s.connect, disconnect: s.disconnect, autoReconnect: s.autoReconnect, fetchCalendars: s.fetchCalendars, setCalendarEnabled: s.setCalendarEnabled, refreshEvents: s.refreshEvents })))
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const target = targetCalendarOf({ calendars, targetCalendarId })

  // The calendar list is what makes shared team calendars reachable at all, so
  // it is read as soon as there is a token to read it with.
  React.useEffect(() => {
    if (token && !calendars.length) fetchCalendars()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // On mount: if user was connected before but token expired, silently refresh
  React.useEffect(() => {
    if (wasConnected && !token && !loading && !autoRefreshing) autoReconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // And get the Google client ready, so pressing 연동 opens its window in the
  // same instant as the tap. On a phone that is the difference between working
  // and doing nothing at all.
  React.useEffect(() => { if (!token) warmCalendarAuth() }, [token])

  if (token) {
    // One control for the whole integration. A chip announcing "연동됨" states
    // what the visible events already prove, and an always-present ✕ puts
    // disconnecting a click away from nothing — it belongs inside the menu with
    // the rest of the settings.
    return (
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setPickerOpen(o => !o)}
          title="표시할 캘린더 선택"
          style={{
            height: CTRL_H, boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 12, color: error ? 'var(--danger)' : 'var(--t2)',
            background: 'transparent',
            border: `1px solid ${error ? 'rgba(212,76,71,.35)' : 'var(--bd2)'}`,
            cursor: 'pointer', padding: '0 9px', borderRadius: 'var(--r2)',
            fontFamily: 'var(--font)', whiteSpace: 'nowrap', lineHeight: 1,
          }}
        >
          <GoogleDot />
          {error ? '일정 로드 오류' : loading ? '불러오는 중…' : `캘린더 ${enabledCalendarIds?.length ?? 0}/${calendars.length}`}
          <span style={{ fontSize: 9, opacity: .5 }}>▾</span>
        </button>

        {pickerOpen && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 8998 }} onClick={() => setPickerOpen(false)} />
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 8999,
              background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)',
              boxShadow: 'var(--sh-md)', minWidth: 230, maxHeight: 320, overflowY: 'auto', padding: '4px 0',
            }} data-scrolls>
              {error && (
                <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--danger)', lineHeight: 1.5 }}>{error}</div>
              )}
              {calendars.length === 0 && (
                <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--t3)' }}>캘린더를 불러오는 중…</div>
              )}
              {calendars.map(c => {
                const on = (enabledCalendarIds ?? []).includes(c.id)
                /*
                  ── 넣는 곳은 못 숨깁니다 ──────────────────────────────────
                  둘이 어긋나면 끌어다 놓은 일정이 만드는 순간엔 보였다가
                  다음에 읽을 때 조용히 사라집니다 — 안 만들어진 것처럼
                  보이는데 구글에는 남아 있습니다. 눌러도 안 되는 것을
                  눌리게 두지 않고, 왜 안 되는지 옆에 적습니다.
                */
                const isTarget = c.id === target
                return (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', fontSize: 13, color: 'var(--t1)', cursor: isTarget ? 'default' : 'pointer' }}
                    title={isTarget ? '새 일정이 여기로 갑니다. 넣는 곳은 숨길 수 없습니다.' : undefined}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <input type="checkbox" checked={on} disabled={isTarget} onChange={() => setCalendarEnabled(c.id, !on)}
                      style={{ accentColor: 'var(--ac)', width: 13, height: 13, cursor: isTarget ? 'default' : 'pointer', flexShrink: 0, opacity: isTarget ? .55 : 1 }} />
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: c.backgroundColor, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.summary}</span>
                    {isTarget && (
                      <span style={{ flexShrink: 0, fontSize: 10.5, color: 'var(--t3)' }}>여기에 추가</span>
                    )}
                  </label>
                )
              })}
              <div style={{ height: 1, background: 'var(--bd)', margin: '4px 0' }} />
              <PeekPeople />
              <div style={{ height: 1, background: 'var(--bd)', margin: '4px 0' }} />
              <button
                onClick={() => { setPickerOpen(false); refreshEvents() }}
                style={{
                  width: '100%', textAlign: 'left', padding: '6px 12px', fontSize: 12,
                  color: 'var(--t2)', background: 'transparent', border: 'none',
                  cursor: 'pointer', fontFamily: 'var(--font)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                지금 새로고침
              </button>
              <button
                onClick={() => { setPickerOpen(false); disconnect() }}
                style={{
                  width: '100%', textAlign: 'left', padding: '6px 12px', fontSize: 12,
                  color: 'var(--danger)', background: 'transparent', border: 'none',
                  cursor: 'pointer', fontFamily: 'var(--font)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                연동 해제
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // Silent reconnect in progress
  if (autoRefreshing) {
    return (
      <span style={{ height: CTRL_H, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--t3)', background: 'var(--bg3)', padding: '0 8px', borderRadius: 20 }}>
        <GoogleDot /> 갱신 중…
      </span>
    )
  }

  // Was connected before but token expired and silent refresh failed → compact reconnect button
  if (wasConnected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <button
          onClick={connect}
          disabled={loading}
          title={error ?? undefined}
          style={{
            height: CTRL_H, boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '0 8px', borderRadius: 20,
            border: `1px solid ${error ? 'rgba(212,76,71,.35)' : 'rgba(68,131,97,.35)'}`,
            background: error ? 'rgba(212,76,71,.07)' : 'rgba(68,131,97,.07)',
            fontSize: 12, color: error ? 'var(--danger)' : '#448361',
            cursor: loading ? 'default' : 'pointer',
            opacity: loading ? .6 : 1,
            fontFamily: 'var(--font)', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          <GoogleDot /> {loading ? '연동 중…' : '캘린더 재연동'}
        </button>
        {/* A reconnect that failed used to say nothing at all — the button
            simply came back, which reads as the click having done nothing. */}
        {error && !loading && (
          <span style={{ fontSize: 11, color: 'var(--danger)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }} title={error}>
            {error}
          </span>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, justifyContent: 'flex-end' }}>
      <button
        onClick={connect}
        disabled={loading}
        style={{
          height: CTRL_H, boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '0 10px', borderRadius: 'var(--r1)',
          border: `1px solid ${error ? '#fca5a5' : 'var(--bd)'}`,
          background: error ? 'rgba(212,76,71,.07)' : 'transparent',
          fontSize: 12, color: error ? 'var(--danger)' : 'var(--t2)',
          cursor: loading ? 'default' : 'pointer',
          opacity: loading ? .6 : 1,
          fontFamily: 'var(--font)',
          whiteSpace: 'nowrap', flexShrink: 0,
        }}
        onMouseEnter={e => { if (!loading) e.currentTarget.style.background = 'var(--bg2)' }}
        onMouseLeave={e => { e.currentTarget.style.background = error ? 'rgba(212,76,71,.07)' : 'transparent' }}
      >
        <GoogleDot />
        {loading ? '연동 중…' : error ? '다시 연동' : '구글 캘린더 연동'}
      </button>
      {/* Written out, not a tooltip: a phone has nothing to hover with, so a
          failed first connect there said nothing whatsoever. */}
      {error && !loading && (
        <span style={{ fontSize: 11, color: 'var(--danger)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }} title={error}>
          {error}
        </span>
      )}
    </div>
  )
}

/**
 * ── 같이 볼 사람 ─────────────────────────────────────────────────────────────
 *
 * 구글 캘린더의 '다른 캘린더 검색'과 같은 자리입니다. 주소를 넣으면 그 사람의
 * 일정이 내 달력 위에 회색으로 같이 그려집니다 — **읽기만 합니다.**
 *
 * 보이는 정도는 그 사람의 공유 설정이 정합니다. 상세를 열어 뒀으면 제목까지,
 * 아니면 '바쁨'만 옵니다. 우리가 정하는 것이 아니고, 그래서 화면이 둘 중
 * 어느 쪽인지 말해 줍니다 — '바쁨'만 나오는 것을 보고 그 사람이 정말 종일
 * 회의 중이라고 읽으면 곤란합니다.
 *
 * 아는 사람을 먼저 내놓습니다(같이 일하는 사람들). 목록에 없어도 주소를 다
 * 적으면 됩니다 — 회사에는 아직 이 앱을 안 켜 본 사람이 있고, 그 사람 일정도
 * 구글에는 있습니다.
 */
function PeekPeople() {
  const { peeking, setPeeking, peekLoading, peekEvents } = useGCalStore(useShallow(s => ({
    peeking: s.peeking, setPeeking: s.setPeeking, peekLoading: s.peekLoading, peekEvents: s.peekEvents,
  })))
  const myEmail = useAuthStore(s => s.email)
  const projects = useProjectStore(s => s.projects)
  const profiles = useUserProfileStore(s => s.profiles)
  const [query, setQuery] = React.useState('')

  const known = React.useMemo(() => {
    const mine = myEmail?.toLowerCase()
    const domain = mine?.split('@')[1] ?? ''
    const out = new Map<string, string>()
    for (const mail of authorizedEmails(projects, myEmail)) {
      if (mail === mine) continue
      out.set(mail, mail)
    }
    // 이름이 있으면 이름으로 찾게 합니다. 주소를 외우고 있는 사람은 없습니다.
    for (const p of Object.values(profiles)) {
      const mail = p.email?.toLowerCase()
      if (!mail || mail === mine) continue
      if (domain && !mail.endsWith(`@${domain}`)) continue
      out.set(mail, p.name || mail)
    }
    return [...out.entries()].map(([email, name]) => ({ email, name })).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [projects, profiles, myEmail])

  const q = query.trim().toLowerCase()
  const matches = q
    ? known.filter(k => !peeking.includes(k.email) && (k.email.includes(q) || k.name.toLowerCase().includes(q))).slice(0, 5)
    : []
  const typedIsEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(q) && !peeking.includes(q)

  const nameOf = (mail: string) => known.find(k => k.email === mail)?.name ?? mail
  const busyOnly = (mail: string) => peekEvents.some(e => e.peekOf === mail && e.busyOnly)

  return (
    <div style={{ padding: '2px 0' }}>
      <div style={{ padding: '4px 12px 2px', fontSize: 11, fontWeight: 600, color: 'var(--t3)' }}>
        같이 볼 사람
      </div>
      {peeking.map(mail => (
        <label key={mail} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', fontSize: 13, color: 'var(--t1)', cursor: 'pointer' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <input type="checkbox" checked onChange={() => setPeeking(mail, false)}
            style={{ accentColor: 'var(--ac)', width: 13, height: 13, cursor: 'pointer', flexShrink: 0 }} />
          <span style={{ width: 9, height: 9, borderRadius: 2, background: PEEK_COLOR, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {nameOf(mail)}
            {/* 제목이 안 보이는 이유를 말해 줍니다. 안 말하면 '바쁨'이 그
                사람의 일정 제목인 줄 압니다. */}
            {busyOnly(mail) && (
              <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--t3)' }}>바쁨만</span>
            )}
          </span>
        </label>
      ))}
      <div style={{ padding: '4px 12px 6px' }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key !== 'Enter' || isComposing(e)) return
            const pick = matches[0]?.email ?? (typedIsEmail ? q : null)
            if (pick) { setPeeking(pick, true); setQuery('') }
          }}
          placeholder="이름 또는 이메일"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '4px 7px',
            borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
            background: 'var(--bg2)', color: 'var(--t1)', fontSize: 12,
            outline: 'none', fontFamily: 'var(--font)',
          }}
        />
        {peekLoading && <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 4 }}>불러오는 중…</div>}
      </div>
      {matches.map(m => (
        <button
          key={m.email}
          onClick={() => { setPeeking(m.email, true); setQuery('') }}
          style={{
            width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 12.5,
            color: 'var(--t1)', background: 'transparent', border: 'none',
            cursor: 'pointer', fontFamily: 'var(--font)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {m.name}{m.name !== m.email && <span style={{ color: 'var(--t3)' }}> · {m.email}</span>}
        </button>
      ))}
      {!!q && !matches.length && (
        <div style={{ padding: '2px 12px 6px', fontSize: 11, color: 'var(--t3)', lineHeight: 1.5 }}>
          {typedIsEmail ? 'Enter를 누르면 이 주소를 봅니다.' : '이메일 주소 전체를 넣으면 목록에 없는 사람도 볼 수 있습니다.'}
        </div>
      )}
    </div>
  )
}

function GoogleDot() {
  return (
    <svg width="12" height="12" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 12.015 17.64 10.734 17.64 9.2z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  )
}

// ── Mobile calendar ───────────────────────────────────────────────────────────

function MobileCalendar() {
  const { openTaskModal, openTaskDetail, projectId } = useUiStore(useShallow(s => ({ openTaskModal: s.openTaskModal, openTaskDetail: s.openTaskDetail, projectId: s.projectId })))
  const tasks = useFilteredTasks()
  const { token, events: gcalEvents, ensureEvents } = useGCalStore(useShallow(s => ({ token: s.token, events: s.events, ensureEvents: s.ensureEvents })))
  const todayDate = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const todayStr  = useMemo(() => fmt(todayDate), [todayDate])
  const [selectedDate, setSelectedDate] = useState(todayStr)
  /** Placing work on one day, from that day's section header. */

  // Fetch GCal events for a 3-month window around today. Re-runs when the set of
  // shown calendars changes, otherwise ticking one on would do nothing visible.
  const enabledKey = (useGCalStore(s => s.enabledCalendarIds) ?? []).join(',')
  useEffect(() => {
    if (!token) return
    const from = fmt(addDays(todayDate, -14))
    const to   = fmt(addDays(todayDate, 75))
    ensureEvents(from, to)
  }, [token, enabledKey])

  // Group tasks by due date, finished ones at the foot of each day — the same
  // rule the list follows, for the same reason: a day's remaining work is what
  // is being read, and what is done is only there to be counted.
  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>()
    tasks.forEach(t => {
      const key = t.due ?? t.start
      if (!key) return
      const list = map.get(key)
      if (list) list.push(t)
      else map.set(key, [t])
    })
    for (const list of map.values()) {
      list.sort((a, b) => (a.status === '완료' ? 1 : 0) - (b.status === '완료' ? 1 : 0))
    }
    return map
  }, [tasks])

  // Group GCal events by START date only (avoid repeating multi-day events on every day in list view)
  const gcalByDate = useMemo(() => {
    const map = new Map<string, GCalEvent[]>()
    gcalEvents.forEach(ev => {
      if (!ev.start) return
      if (!map.has(ev.start)) map.set(ev.start, [])
      map.get(ev.start)!.push(ev)
    })
    return map
  }, [gcalEvents])

  const overdueTasks = useMemo(() =>
    tasks.filter(t => {
      const due = t.due ?? t.start
      return due && due < todayStr && t.status !== '완료'
    }),
    [tasks, todayStr]
  )

  // Date strip: 14 days before + 45 days after
  const stripDates = useMemo(() => {
    const dates: string[] = []
    for (let i = -14; i <= 45; i++) dates.push(fmt(addDays(todayDate, i)))
    return dates
  }, [todayDate])

  // Content dates: days with tasks or GCal events, plus selected date
  const contentDates = useMemo(() => {
    const set = new Set<string>()
    for (let i = 0; i <= 75; i++) {
      const d = fmt(addDays(todayDate, i))
      if (tasksByDate.has(d) || gcalByDate.has(d)) set.add(d)
    }
    set.add(selectedDate)
    return Array.from(set).sort()
  }, [tasksByDate, gcalByDate, todayDate, selectedDate])

  const stripRef    = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useEffect(() => {
    const el = stripRef.current?.querySelector(`[data-date="${selectedDate}"]`) as HTMLElement | null
    if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedDate])

  const handleDateSelect = (dateStr: string) => {
    haptic('tap')
    setSelectedDate(dateStr)
    setTimeout(() => {
      const el = sectionRefs.current.get(dateStr)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  const fmtSection = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00')
    const dow = DAY_LABELS[d.getDay()]
    const diff = Math.round((d.getTime() - todayDate.getTime()) / 86400000)
    const m = d.getMonth() + 1; const day = d.getDate()
    if (diff === 0) return `오늘 (${m}/${day} ${dow})`
    if (diff === 1) return `내일 (${m}/${day} ${dow})`
    if (diff === -1) return `어제 (${m}/${day} ${dow})`
    return `${m}/${day} (${dow})`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ background: 'var(--bg)', borderBottom: '1px solid var(--bd)', padding: '10px 16px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          {overdueTasks.length > 0 ? (
            <div
              onClick={() => {
                const el = sectionRefs.current.get('__overdue__')
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(212,76,71,.12)', color: 'var(--danger)', borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              <span>⚠</span> 기한 초과 {overdueTasks.length}개
            </div>
          ) : <div />}
          <GCalButton />
        </div>

        {/* The filter row that used to sit here is now the ⚙ sheet in the top
            bar, together with the sort and grouping a phone had nowhere to put.
            One door, and a few more lines of calendar on screen. */}

        {/* Date strip */}
        <div ref={stripRef} style={{ display: 'flex', gap: 2, overflowX: 'auto', paddingBottom: 10, scrollbarWidth: 'none' }}>
          {stripDates.map(dateStr => {
            const d = new Date(dateStr + 'T00:00:00')
            const dow = DAY_LABELS[d.getDay()]
            const day = d.getDate()
            const isToday    = dateStr === todayStr
            const isSelected = dateStr === selectedDate
            const hasTasks   = tasksByDate.has(dateStr)
            const hasGCal    = gcalByDate.has(dateStr)
            const isSun = d.getDay() === 0
            const isSat = d.getDay() === 6
            return (
              <button
                key={dateStr}
                data-date={dateStr}
                onClick={() => handleDateSelect(dateStr)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 44, padding: '6px 4px', border: 'none', borderRadius: 10, background: isSelected ? 'var(--ac)' : 'transparent', cursor: 'pointer', flexShrink: 0 }}
              >
                <span style={{ fontSize: 10, fontWeight: 500, color: isSelected ? 'rgba(255,255,255,.8)' : isSun ? 'var(--danger)' : isSat ? '#3b82f6' : 'var(--t3)' }}>
                  {isToday ? '오늘' : dow}
                </span>
                <span style={{ fontSize: 16, fontWeight: isToday || isSelected ? 700 : 400, color: isSelected ? '#fff' : isToday ? 'var(--ac)' : 'var(--t1)', lineHeight: 1 }}>
                  {day}
                </span>
                {/* Dots: task dot (blue) + GCal dot (green) */}
                <div style={{ display: 'flex', gap: 3 }}>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: hasTasks ? (isSelected ? 'rgba(255,255,255,.7)' : 'var(--ac)') : 'transparent' }} />
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: hasGCal ? (isSelected ? 'rgba(255,255,255,.7)' : GCAL_TEXT) : 'transparent' }} />
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 20px' }}>
        {/* Overdue */}
        {overdueTasks.length > 0 && (
          <div ref={el => { if (el) sectionRefs.current.set('__overdue__', el) }}>
            <SectionHeader label="기한 초과" count={overdueTasks.length} color="var(--danger)" />
            {overdueTasks.map(t => <MobCalTaskRow key={t.id} task={t} onOpen={() => openTaskDetail(t.id)} overdue />)}
          </div>
        )}

        {/* Per-day sections */}
        {contentDates.map(dateStr => {
          const dayTasks = tasksByDate.get(dateStr) ?? []
          const dayGCal  = gcalByDate.get(dateStr) ?? []
          const total = dayTasks.length + dayGCal.length
          return (
            <div key={dateStr} ref={el => { if (el) sectionRefs.current.set(dateStr, el) }}>
              {/* Tapping the day's heading opens the planner for it — the same
                  place the desktop grid puts it, and the only element here that
                  means "this day" rather than "this task". */}
              <div onClick={() => { haptic('tap'); openTaskModal({ due: dateStr, projectId: projectId ?? undefined }) }} style={{ cursor: 'pointer' }}>
                <SectionHeader label={fmtSection(dateStr)} count={total} color={dateStr === todayStr ? 'var(--ac)' : 'var(--t2)'} />
              </div>
              {dayGCal.map(ev => <MobGCalRow key={ev.id} event={ev} />)}
              {dayTasks.length === 0 && dayGCal.length === 0 ? (
                <div
                  onClick={() => { haptic('tap'); openTaskModal({ due: dateStr, projectId: projectId ?? undefined }) }}
                  style={{ padding: '10px 16px', fontSize: 13, color: 'var(--t3)', cursor: 'pointer' }}
                >
                  업무 없음 · 눌러서 추가
                </div>
              ) : dayTasks.map(t => <MobCalTaskRow key={t.id} task={t} onOpen={() => openTaskDetail(t.id)} />)}
            </div>
          )
        })}

        <div style={{ padding: '4px 16px 8px' }}>
          <button
            onClick={() => openTaskModal()}
            style={{ width: '100%', padding: '12px', border: '1px dashed var(--bd2)', borderRadius: 'var(--r2)', background: 'transparent', color: 'var(--t3)', fontSize: 13, cursor: 'pointer' }}
          >
            + 업무 추가
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{ padding: '14px 16px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color, letterSpacing: '0.03em' }}>{label}</span>
      {count > 0 && (
        <span style={{ fontSize: 11, color: 'var(--t3)', background: 'var(--bg3)', borderRadius: 10, padding: '1px 7px' }}>{count}</span>
      )}
    </div>
  )
}

function MobCalTaskRow({ task, onOpen, overdue }: { task: Task; onOpen: () => void; overdue?: boolean }) {
  const st = MOB_STATUS[task.status] ?? MOB_STATUS['대기']
  const isDone = task.status === '완료'
  return (
    <div
      onClick={onOpen}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--bd)', cursor: 'pointer', opacity: isDone ? 0.55 : 1 }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: overdue ? 'var(--danger)' : 'var(--ac)', flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 14, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isDone ? 'line-through' : 'none' }}>
        {task.name}
      </span>
      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: st.bg, color: st.color, flexShrink: 0 }}>
        {task.status}
      </span>
      <span style={{ fontSize: 12, color: 'var(--t3)', flexShrink: 0 }}>›</span>
    </div>
  )
}

function MobGCalRow({ event }: { event: GCalEvent }) {
  return (
    <a
      href={event.htmlLink}
      target="_blank"
      rel="noopener noreferrer"
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--bd)', textDecoration: 'none' }}
    >
      {/* 점 하나로 말해야 하는 자리에서 점선의 대응은 '빈 동그라미'입니다 —
          채워진 점은 확정, 테두리만 있는 점은 아직 대답 안 한 초대. */}
      <span style={{
        width: 7, height: 7, borderRadius: '50%', flexShrink: 0, boxSizing: 'border-box',
        ...(awaitingMe(event)
          ? { border: `1.5px solid ${event.calendarColor || GCAL_TEXT}` }
          : { background: event.calendarColor || GCAL_TEXT }),
      }} />
      <span style={{ flex: 1, fontSize: 14, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {event.startTime && <span style={{ color: event.calendarColor || GCAL_TEXT, fontWeight: 500, marginRight: 5 }}>{event.startTime}</span>}
        {event.summary}
      </span>
      {/* The badge said '구글' next to a coloured dot, a coloured time and an
          arrow that leaves the app — four ways of saying the same thing on a
          390pt row. The dot and the arrow carry it. */}
      <span style={{ fontSize: 12, color: 'var(--t3)', flexShrink: 0 }}>↗</span>
    </a>
  )
}

// ── Error boundary ────────────────────────────────────────────────────────────

class CalendarErrorBoundary extends Component<{ children: React.ReactNode }, { error: string | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : '알 수 없는 오류' }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, color: 'var(--t2)' }}>
          <div style={{ fontSize: 13, color: 'var(--danger)' }}>캘린더 로드 오류</div>
          <div style={{ fontSize: 12, color: 'var(--t3)', textAlign: 'center', maxWidth: 280 }}>{this.state.error}</div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ padding: '6px 14px', borderRadius: 'var(--r2)', border: '1px solid var(--bd)', background: 'transparent', fontSize: 13, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)' }}
          >
            다시 시도
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Desktop calendar ──────────────────────────────────────────────────────────

export function CalendarView() {
  const isMobile = useMobile()
  return (
    <CalendarErrorBoundary>
      {isMobile ? <MobileCalendar /> : <DesktopCalendar />}
    </CalendarErrorBoundary>
  )
}

/**
 * One calendar with a range switch, rather than a calendar view and a timeline
 * view sitting side by side in the tab bar.
 *
 * A team that lives in Google Calendar reads 일/3일/주/월 as one screen showing
 * more or less time; two separate tabs read as two different features, and
 * choosing between them is a question nobody should have to answer.
 */
/**
 * ── Scrolling through time ───────────────────────────────────────────────────
 *
 * Apple Calendar does not turn pages. Scroll a week view and the days travel
 * under your fingers — a flick runs several past and then eases to a stop
 * wherever the momentum ran out, very often mid-week. Two halves make that up,
 * and both are needed or it reads as chunky:
 *
 *   · the whole days, which change the anchor and let React redraw the grid;
 *   · the remainder — the part of the day currently being crossed — which is
 *     written to --slide and moves the columns by transform alone, every frame,
 *     without React in the loop at all.
 *
 * Each grid draws one column of buffer on either side of the frame, so there is
 * always something to see in the gap the remainder opens up. The remainder is
 * kept inside half a column: past that, a whole step is handed over and the
 * transform is credited back the same distance, which is why the swap is
 * invisible. When the events stop arriving the remainder is eased to zero — the
 * "스스륵" landing on a day boundary.
 *
 * A step is exactly one column, measured off the DOM rather than assumed, or
 * the days would travel at a different rate from the gesture.
 */
const QUIET_MS = 140
const SETTLE_MS = 220
/** No single wheel event may cover more than this; a stray page-sized delta
 *  would otherwise throw the calendar into next season. */
const MAX_STEP = 4

function useWheelSlide(
  ref: React.RefObject<HTMLDivElement | null>,
  axis: 'x' | 'y',
  stepPx: () => number,
  onStep: (steps: number) => void,
  scrubbing: React.MutableRefObject<boolean>,
) {
  const onStepRef = useRef(onStep); onStepRef.current = onStep
  const stepRef = useRef(stepPx);   stepRef.current = stepPx

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let travelled = 0
    let lastAt = 0
    let idle: number | undefined
    let tween: number | undefined
    // Measured once per gesture. Reading it per event puts a forced layout
    // between two style writes, which is the shape of a stutter.
    let step = 0

    const paint = () => el.style.setProperty('--slide', `${-travelled}px`)

    // Ease-out to the nearest day: fast at first, then barely moving.
    const settle = () => {
      const from = travelled
      scrubbing.current = false
      if (!from) return
      const started = performance.now()
      const tick = (t: number) => {
        const p = Math.min(1, (t - started) / SETTLE_MS)
        travelled = from * (1 - p) ** 3
        paint()
        if (p < 1) tween = requestAnimationFrame(tick)
        else { travelled = 0; paint() }
      }
      tween = requestAnimationFrame(tick)
    }

    const handle = (e: WheelEvent) => {
      /**
       * ── 스스로 구르는 것 위에서는 비켜섭니다 ─────────────────────────────
       *
       * 이 손잡이는 격자 전체에 걸려 있고, 격자 위에 뜬 카드도 DOM으로는 그
       * 안입니다. 그래서 일정 카드 안에서 굴리면 **카드가 아니라 달이**
       * 넘어갔습니다 — 카드는 잘린 채로 있고 뒤의 달력만 움직였습니다.
       *
       * 계산해서 알아내지 않습니다(굴릴 때마다 스타일을 읽으면 그게 곧
       * 끊김입니다). 스스로 구르는 것에 표를 달아 두고, 그 표가 보이면
       * 이 손잡이는 아무것도 안 합니다.
       */
      if ((e.target as Element | null)?.closest?.('[data-scrolls]')) return

      // Lines and pages, as some mice and older browsers report them.
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      const delta  = (axis === 'y' ? e.deltaY : e.deltaX) * scale
      const across = (axis === 'y' ? e.deltaX : e.deltaY) * scale
      // A trackpad never travels on one axis alone. Whichever way the gesture is
      // mostly going wins, so that scrolling the hours does not also drag the
      // days sideways.
      if (delta === 0 || Math.abs(delta) <= Math.abs(across)) return

      // Horizontal travel has to be taken: left, the browser would read it as a
      // back-navigation swipe and the calendar would vanish mid-gesture.
      e.preventDefault()

      if (tween !== undefined) { cancelAnimationFrame(tween); tween = undefined }
      const now = e.timeStamp
      if (now - lastAt > QUIET_MS) { travelled = 0; step = 0 }
      if (!step) step = Math.max(1, stepRef.current())
      lastAt = now

      // The slide-in animation belongs to the arrows; playing it on every day of
      // a scroll would strobe.
      scrubbing.current = true
      window.clearTimeout(idle)
      idle = window.setTimeout(settle, QUIET_MS)

      travelled += delta
      let steps = Math.round(travelled / step)
      if (steps) {
        steps = Math.max(-MAX_STEP, Math.min(MAX_STEP, steps))
        travelled -= steps * step
        // Only a clamped step can leave more than half a column over, and that
        // would show past the buffer.
        travelled = Math.max(-step / 2, Math.min(step / 2, travelled))
        onStepRef.current(steps)
      }
      paint()
    }

    el.addEventListener('wheel', handle, { passive: false })
    return () => {
      el.removeEventListener('wheel', handle)
      window.clearTimeout(idle)
      if (tween !== undefined) cancelAnimationFrame(tween)
      el.style.removeProperty('--slide')
    }
  }, [ref, axis, scrubbing])
}

/**
 * Slides the body in from whichever way time just moved.
 *
 * Animated rather than re-keyed: remounting would reset the hour grid's own
 * scroll, so moving a week would throw you back to nine in the morning.
 */
function useSlideOnChange(
  ref: React.RefObject<HTMLElement | null>,
  anchor: string,
  axis: 'x' | 'y',
  suppress: React.MutableRefObject<boolean>,
) {
  const previous = useRef(anchor)
  useEffect(() => {
    const before = previous.current
    if (before === anchor) return
    previous.current = anchor
    const el = ref.current
    if (!el || suppress.current) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const forward = toDate(anchor) > toDate(before)
    const offset = axis === 'y' ? 18 : 28
    const from = axis === 'y'
      ? `translateY(${forward ? offset : -offset}px)`
      : `translateX(${forward ? offset : -offset}px)`
    el.animate(
      [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }],
      { duration: 240, easing: 'cubic-bezier(.22,.61,.36,1)' },
    )
  }, [anchor, axis, ref, suppress])
}

/** The Sunday the month grid starts on: the one on or before the 1st. */
function monthGridStart(year: number, month: number) {
  const first = new Date(year, month, 1)
  return addDays(first, -first.getDay())
}

function DesktopCalendar() {
  const { calRange, calAnchor, setCalRange, setCalAnchor } = useUiStore(useShallow(s => ({ calRange: s.calRange, calAnchor: s.calAnchor, setCalRange: s.setCalRange, setCalAnchor: s.setCalAnchor })))
  const { calendars, targetCalendarId, canWrite, setTargetCalendar } = useGCalStore(useShallow(s => ({ calendars: s.calendars, targetCalendarId: s.targetCalendarId, canWrite: s.canWrite, setTargetCalendar: s.setTargetCalendar })))

  const anchor = toDate(calAnchor)
  const isMonth = calRange === 'month'

  // The anchor is the first day on screen, so that a scroll can move it by a
  // single day. A week is snapped to its Sunday when it is chosen — as a week
  // is normally read — and left wherever scrolling puts it afterwards.
  useEffect(() => {
    if (calRange !== 7) return
    const a = toDate(useUiStore.getState().calAnchor)
    if (a.getDay() !== 0) setCalAnchor(fmt(addDays(a, -a.getDay())))
  }, [calRange])

  // One day of buffer on either side, so a scroll parked between two days has
  // something to show in the gap.
  const LEAD = 1
  const visibleDays = useMemo(
    () => (isMonth ? [] : Array.from({ length: calRange as number }, (_, i) => fmt(addDays(anchor, i)))),
    [calAnchor, calRange],
  )
  const days = useMemo(
    () => (isMonth ? [] : Array.from({ length: (calRange as number) + LEAD * 2 }, (_, i) => fmt(addDays(anchor, i - LEAD)))),
    [calAnchor, calRange],
  )

  // The month grid keeps its own offset: scrolling it moves whole weeks, and a
  // month that starts mid-grid is still that month until another one takes over
  // the middle row, at which point the label — and the anchor behind it — follow.
  const [weekOffset, setWeekOffsetState] = useState(0)
  const weekRef = useRef(0)
  const setWeekOffset = (n: number) => { weekRef.current = n; setWeekOffsetState(n) }
  const gridStart = useMemo(
    () => addDays(monthGridStart(anchor.getFullYear(), anchor.getMonth()), weekOffset * 7),
    [calAnchor, weekOffset],
  )

  const shift = (direction: number) => {
    if (isMonth) {
      setWeekOffset(0)
      setCalAnchor(fmt(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1)))
    } else {
      setCalAnchor(fmt(addDays(anchor, direction * calRange)))
    }
  }

  const goToday = () => {
    setWeekOffset(0)
    const now = new Date()
    setCalAnchor(fmt(calRange === 7 ? addDays(now, -now.getDay()) : now))
  }

  // Scrolling reads from the store rather than from this render: a flick fires
  // several steps before React has drawn any of them.
  const scrubDays = (steps: number) => {
    setCalAnchor(fmt(addDays(toDate(useUiStore.getState().calAnchor), steps)))
  }
  const scrubWeeks = (steps: number) => {
    const cur = toDate(useUiStore.getState().calAnchor)
    const nextStart = addDays(
      addDays(monthGridStart(cur.getFullYear(), cur.getMonth()), weekRef.current * 7),
      steps * 7,
    )
    // Row three is the middle of the grid, so the month it falls in is the month
    // the grid is mostly showing.
    const middle = addDays(nextStart, 17)
    if (middle.getMonth() !== cur.getMonth() || middle.getFullYear() !== cur.getFullYear()) {
      const aligned = monthGridStart(middle.getFullYear(), middle.getMonth())
      setCalAnchor(fmt(new Date(middle.getFullYear(), middle.getMonth(), 1)))
      setWeekOffset(Math.round(dayDiff(aligned, nextStart) / 7))
    } else {
      setWeekOffset(weekRef.current + steps)
    }
  }

  // Months move under a vertical scroll, days and weeks under a horizontal one —
  // the axis each range is already laid out along, so the gesture matches the
  // grid rather than fighting it. One step is one column: a day sideways, a week
  // down.
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrubbing = useRef(false)
  // Measured, not assumed: the transform and the anchor have to agree on how
  // far one column is, or the swap between them shows.
  const stepPx = () => {
    const el = bodyRef.current
    if (!el) return 120
    const cell = el.querySelector(isMonth ? '[data-month-cell]' : '[data-day-column]')
    if (cell) {
      const box = cell.getBoundingClientRect()
      const size = isMonth ? box.height : box.width
      if (size > 1) return size
    }
    return isMonth ? el.clientHeight / 6 : (el.clientWidth - HOUR_GUTTER) / (calRange as number)
  }
  useWheelSlide(bodyRef, isMonth ? 'y' : 'x', stepPx, isMonth ? scrubWeeks : scrubDays, scrubbing)
  useSlideOnChange(bodyRef, calAnchor, isMonth ? 'y' : 'x', scrubbing)

  const label = isMonth
    ? `${anchor.getFullYear()}년 ${MONTHS[anchor.getMonth()]}`
    : visibleDays.length === 1
      ? `${anchor.getFullYear()}년 ${MONTHS[anchor.getMonth()]} ${anchor.getDate()}일`
      : (() => {
          const first = toDate(visibleDays[0]); const last = toDate(visibleDays[visibleDays.length - 1])
          const sameMonth = first.getMonth() === last.getMonth()
          return sameMonth
            ? `${first.getFullYear()}년 ${MONTHS[first.getMonth()]} ${first.getDate()} – ${last.getDate()}`
            : `${MONTHS[first.getMonth()]} ${first.getDate()} – ${MONTHS[last.getMonth()]} ${last.getDate()}`
        })()

  const writable = writableCalendars(calendars)
  const target = targetCalendarOf({ calendars, targetCalendarId }) ?? ''

  // Coming back to the tab is the moment someone expects to see what changed in
  // Google meanwhile. The cached window is only re-read if it has gone stale.
  useEffect(() => {
    const onFocus = () => {
      const { loadedFrom, loadedTo } = useGCalStore.getState()
      if (loadedFrom && loadedTo) useGCalStore.getState().ensureEvents(loadedFrom, loadedTo)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ background: 'var(--bg)', borderBottom: '1px solid var(--bd)', padding: '0 16px', minHeight: 44, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
        <NavBtn onClick={goToday}>오늘</NavBtn>
        <NavBtn onClick={() => shift(-1)}>‹</NavBtn>
        <NavBtn onClick={() => shift(1)}>›</NavBtn>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)', minWidth: 130 }}>{label}</span>

        <RangeSwitch value={calRange} onChange={r => { setWeekOffset(0); setCalRange(r) }} />

        <div style={{ flex: 1 }} />

        {!isMonth && writable.length > 0 && (
          <select
            value={target}
            onChange={e => setTargetCalendar(e.target.value)}
            title={canWrite ? '새 일정을 넣을 캘린더' : '첫 생성 시 구글 권한을 요청합니다'}
            style={{ height: CTRL_H, boxSizing: 'border-box', padding: '0 6px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'transparent', fontSize: 12, color: 'var(--t2)', fontFamily: 'var(--font)', maxWidth: 170, lineHeight: 1 }}
          >
            {writable.map(c => <option key={c.id} value={c.id}>{c.summary}에 추가</option>)}
          </select>
        )}
        <GCalButton />
      </div>

      <div ref={bodyRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {isMonth
          ? <MonthGrid gridStart={fmt(gridStart)} calYear={anchor.getFullYear()} calMonth={anchor.getMonth()} />
          : <TimelineGrid days={days} lead={LEAD} />}
      </div>
    </div>
  )
}

/**
 * 캘린더 바에 서는 컨트롤의 키.
 *
 * 넷이 서로 다른 방식으로 높이가 정해지고 있었습니다 — 버튼은 padding과
 * lineHeight로, 알약은 안쪽 버튼 + 바깥 padding으로, select는 브라우저가
 * 알아서. 같은 줄에 선 것들이 1~3px씩 어긋나면 줄 자체가 흔들려 보입니다.
 * 하나로 못박고 안에서 가운데 정렬합니다.
 */
const CTRL_H = 26

/** 일 / 3일 / 주 / 월, as one segmented control. */
function RangeSwitch({ value, onChange }: { value: CalRange; onChange: (r: CalRange) => void }) {
  const options: { key: CalRange; label: string }[] = [
    { key: 1, label: '일' },
    { key: 3, label: '3일' },
    { key: 7, label: '주' },
    { key: 'month', label: '월' },
  ]
  return (
    <div style={{
      height: CTRL_H, boxSizing: 'border-box',
      display: 'inline-flex', alignItems: 'center', gap: 2, padding: 2,
      background: 'var(--bg3)', borderRadius: 999, flexShrink: 0,
    }}>
      {options.map(o => {
        const on = o.key === value
        return (
          <button
            key={String(o.key)}
            onClick={() => onChange(o.key)}
            style={{
              height: '100%', boxSizing: 'border-box',
              display: 'inline-flex', alignItems: 'center',
              padding: '0 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
              background: on ? 'var(--bg)' : 'transparent',
              color: on ? 'var(--t1)' : 'var(--t2)',
              fontWeight: on ? 600 : 400, fontSize: 12,
              boxShadow: on ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
              fontFamily: 'var(--font)', whiteSpace: 'nowrap',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function MonthGrid({ gridStart, calYear, calMonth }: { gridStart: string; calYear: number; calMonth: number }) {
  // 날짜를 누르면 그 날짜로 채워진 새 업무 창이 열립니다 — onPlanDay 참고.
  const { openTaskDetail, projectId, openTaskModal } = useUiStore(useShallow(s => ({ openTaskDetail: s.openTaskDetail, projectId: s.projectId, openTaskModal: s.openTaskModal })))
  const tasks = useFilteredTasks()
  const { updateTask, tasks: allTasks } = useTaskStore(useShallow(s => ({ updateTask: s.updateTask, tasks: s.tasks })))
  const allMilestones = useMilestoneStore(s => s.milestones)
  const updateMilestone = useMilestoneStore(s => s.updateMilestone)
  const projects = useProjectStore(s => s.projects)
  const milestones = useMemo(() => {
    const ids = new Set(projects.map(p => p.id))
    return allMilestones.filter(m => ids.has(m.projectId))
  }, [allMilestones, projects])
  const { token, events: gcalEvents, peekEvents, ensureEvents, updateEvent, calendars } = useGCalStore(useShallow(s => ({ token: s.token, events: s.events, peekEvents: s.peekEvents, ensureEvents: s.ensureEvents, updateEvent: s.updateEvent, calendars: s.calendars })))
  const moveBookingToDate = useOrgStore(s => s.moveBookingToDate)
  const myEmail = useAuthStore(s => s.email)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  /**
   * 끌 수 있는 일정인가 — 내가 쓸 수 있는 캘린더의 것만.
   *
   * 남의 캘린더를 읽기만 하는 경우가 흔합니다(팀 공유 캘린더, 초대받은 회의).
   * 그걸 끌게 두면 구글이 거절할 때까지는 옮겨진 것처럼 보이고, 되돌아가는
   * 것을 보고서야 안 된다는 걸 압니다. 못 하는 일은 처음부터 안 잡히는
   * 편이 낫습니다.
   */
  const writableIds = useMemo(
    () => new Set(writableCalendars(calendars).map(c => c.id)),
    [calendars],
  )
  // 남의 일정은 읽기만 합니다. 캘린더 목록에 없으니 writableIds로도 걸리지만,
  // 그건 우연히 맞는 것이라 이유를 적어 둡니다.
  const canMove = useCallback(
    (ev: GCalEvent) => !ev.peekOf && writableIds.has(ev.calendarId),
    [writableIds],
  )

  // A buffer week above and below the six on screen, so a scroll parked between
  // two weeks has something to show in the gap.
  const trackStart = useMemo(() => addDays(toDate(gridStart), -7), [gridStart])

  // Fetch GCal events for the grid on screen, whichever weeks it happens to
  // start and end on.
  useEffect(() => {
    if (!token) return
    ensureEvents(fmt(trackStart), fmt(addDays(trackStart, 55)))
  }, [token, gridStart])

  const milestoneByDate = useMemo(() => {
    const map: Record<string, { id: string; name: string; color: string }[]> = {}
    const filtered = projectId ? milestones.filter(m => m.projectId === projectId) : milestones
    filtered.forEach(m => {
      if (!map[m.dueDate]) map[m.dueDate] = []
      map[m.dueDate].push({ id: m.id, name: m.name, color: '#9065B0' })
    })
    return map
  }, [milestones, projectId])

  // Everything a cell draws, indexed by day and built once.
  //
  // Each cell used to filter the whole task list for itself — 56 passes per
  // render — and rebuild its own arrays, so no cell could ever be skipped on a
  // re-render. Scrolling a month redrew all 56 for the sake of the 7 that had
  // changed, and that is what made it stutter. Stable arrays let MonthCell's
  // memo hold.
  //
  // Events are indexed by their start day only; a week-long one would otherwise
  // flood every cell it touches.
  const chipsByDate = useMemo(() => {
    const map = new Map<string, Chip[]>()
    const put = (day: string, chip: Chip) => {
      const at = map.get(day)
      if (at) at.push(chip); else map.set(day, [chip])
    }
    gcalEvents.forEach(ev => { if (ev.start) put(ev.start, { kind: 'gcal', ev }) })
    // 같이 보고 있는 사람들. 내 것 뒤에 섭니다 — 내 하루가 먼저고, 남의
    // 일정은 그 옆에 참고로 놓이는 것입니다.
    peekEvents.forEach(ev => { if (ev.start) put(ev.start, { kind: 'gcal', ev }) })
    tasks.forEach(t => { const day = t.due ?? t.start; if (day) put(day, { kind: 'task', t }) })
    return map
  }, [gcalEvents, peekEvents, tasks])

  const [dragOver, setDragOver]     = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  /**
   * ── 일정을 다른 날로 ──────────────────────────────────────────────────────
   *
   * 시각은 그대로 두고 날짜만 옮깁니다. 3시 회의를 목요일로 끌면 목요일
   * 3시입니다 — 달의 한 칸은 하루라, 그 안에서 몇 시인지는 이 화면이 묻지
   * 않은 것입니다. 묻지 않은 것을 바꾸지 않습니다.
   *
   * 며칠짜리 일정은 **길이를 지킵니다.** 시작을 옮긴 만큼 끝도 같이 갑니다.
   */
  const moveEvent = useCallback(async (eventId: string, from: string, to: string) => {
    if (from === to) return
    const ev = useGCalStore.getState().events.find(e => e.id === eventId)
    if (!ev) return
    const offset = dayDiff(parseDate(from), parseDate(to))
    const shift = (ymd: string) => fmt(addDays(parseDate(ymd), offset))
    /**
     * 시각 있는 일정의 새 시각.
     *
     * 문자열에서 날짜만 갈아 끼우면 구글이 준 시간대 꼬리표(`+09:00`)가 그대로
     * 따라옵니다. 이 앱의 나머지가 보내는 모양은 **꼬리표 없는 벽시계 + 시간대
     * 이름**이라(localIso), 섞으면 보는 사람의 시간대와 일정의 시간대가 다를 때
     * 어긋납니다.
     *
     * 화면에 3시로 보이는 것을 끌었으면 옮긴 날도 3시입니다. 그게 사람이
     * 방금 한 일이고, 날짜에 더하는 것이라 서머타임 경계도 알아서 맞습니다.
     */
    const shiftIso = (iso: string | undefined, fallbackDay: string) => {
      if (!iso) return `${shift(fallbackDay)}T00:00:00`
      const d = new Date(iso)
      d.setDate(d.getDate() + offset)
      const pad = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        + `T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
    }

    const ok = ev.allDay
      /**
       * 끝 날짜에 하루를 더합니다.
       *
       * 구글에서 종일 일정의 end는 **안 포함하는** 값입니다 — 8월 26일
       * 하루짜리의 end가 8월 27일입니다. 우리는 읽어 올 때 하루를 빼서
       * 포함하는 값으로 바꿔 뒀고(gcalStore의 toGCalEvent), 돌려보낼 때는
       * 다시 더해야 합니다. 안 더하면 옮길 때마다 하루씩 짧아집니다.
       */
      ? await updateEvent(eventId, {
          startDate: shift(ev.start),
          endDate: fmt(addDays(parseDate(shift(ev.end)), 1)),
        })
      : await updateEvent(eventId, {
          startDateTime: shiftIso(ev.startIso, ev.start),
          endDateTime: shiftIso(ev.endIso, ev.end),
        })
    if (!ok) return

    /**
     * 회의실 예약도 따라갑니다.
     *
     * 안 따라가면 예약은 옛 날짜에 남습니다 — 목요일로 미룬 회의의 방이
     * 화요일에 잡혀 있고, 목요일에는 남이 그 방을 잡을 수 있습니다. 화면에는
     * 아무 문제가 없어 보이고, 회의 시간에 방에 가면 다른 팀이 있습니다.
     *
     * 옮긴 날에 이미 남의 예약이 있으면 일정만 가고 방은 남습니다. 그때는
     * 조용히 넘기지 않고 말해 줍니다 — 방이 없어진 것을 회의 당일에 알면
     * 그때는 늦습니다.
     */
    if (!myEmail) return
    const { moved, roomName } = await moveBookingToDate(from, to, eventId, myEmail, getNameByEmail(myEmail))
    if (moved === 'busy') {
      useToast.getState().show(`${roomName ?? '회의실'} 예약은 못 옮겼습니다 — 그날 이미 잡혀 있습니다`)
    }
  }, [updateEvent, moveBookingToDate, myEmail, getNameByEmail])

  const todayStr = fmt(new Date())

  const cells: { date: Date; isCurrentMonth: boolean }[] = []
  for (let i = 0; i < 56; i++) {
    const date = addDays(trackStart, i)
    cells.push({ date, isCurrentMonth: date.getMonth() === calMonth && date.getFullYear() === calYear })
  }

  const handleDrop = useCallback((e: React.DragEvent, dropDay: string) => {
    e.preventDefault()

    // A milestone is a single date, so there is nothing to shift relative to —
    // it simply lands where it was dropped, and its tasks stay where they are.
    const milestoneId = e.dataTransfer.getData('milestoneId')
    if (milestoneId) {
      updateMilestone(milestoneId, { dueDate: dropDay })
      setDragOver(null)
      setDraggingId(null)
      return
    }

    /**
     * ── 구글 일정 옮기기 ──────────────────────────────────────────────────
     *
     * 시각은 그대로 두고 **날짜만** 옮깁니다. 3시 회의를 목요일로 끌면
     * 목요일 3시입니다 — 달의 한 칸은 하루라, 그 안에서 몇 시인지는 이
     * 화면이 묻지 않은 것입니다. 묻지 않은 것을 바꾸면 안 됩니다.
     *
     * 종일 일정은 날짜로만 삽니다. 시각 모양으로 고치려 하면 구글이 종일이
     * 아닌 일정으로 바꿔 버립니다 — 옮기려다 종류를 바꾸는 셈입니다.
     */
    const eventId = e.dataTransfer.getData('eventId')
    const eventFrom = e.dataTransfer.getData('fromDate')
    if (eventId && eventFrom) {
      setDragOver(null)
      setDraggingId(null)
      void moveEvent(eventId, eventFrom, dropDay)
      return
    }

    const taskId      = e.dataTransfer.getData('taskId')
    const fromDateStr = e.dataTransfer.getData('fromDate')
    if (!taskId || !fromDateStr) return
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    const dropDate = parseDate(dropDay)
    const offset = dayDiff(parseDate(fromDateStr), dropDate)
    if (offset === 0) { setDragOver(null); return }
    const patch: Partial<Task> = {}
    if (task.start) patch.start = fmt(addDays(parseDate(task.start), offset))
    if (task.due)   patch.due   = fmt(addDays(parseDate(task.due),   offset))
    if (!task.start && !task.due) patch.due = fmt(dropDate)
    updateTask(taskId, patch)
    getBlockingCascade(taskId, allTasks).forEach(id => {
      const dep = allTasks.find(t => t.id === id)
      if (!dep) return
      const cp: Partial<Task> = {}
      if (dep.start) cp.start = fmt(addDays(parseDate(dep.start), offset))
      if (dep.due)   cp.due   = fmt(addDays(parseDate(dep.due),   offset))
      updateTask(id, cp)
    })
    setDragOver(null)
  }, [tasks, allTasks, updateTask, updateMilestone, moveEvent])

  const onDragOverDay   = useCallback((day: string) => setDragOver(day), [])
  const onDragLeaveDay  = useCallback(() => setDragOver(null), [])
  /**
   * 날짜를 누르면 **새 업무 창**이 그 날짜로 채워진 채 열립니다.
   *
   * 예전에는 날짜 옆에 뜨는 별도 팝오버(DayPlanner)였습니다. 업무를 만드는
   * 창이 두 개가 되고, 두 개는 언젠가 어긋납니다 — 한쪽에만 담당자가 있고
   * 다른 쪽에만 우선순위가 있는 식으로요. 팝오버가 하던 나머지 절반(날짜
   * 없는 업무를 이 날로 옮기기)은 그 창 안으로 들어갔습니다.
   *
   * 두 번째 인자(anchor)는 이제 안 씁니다 — 창이 화면 가운데 뜨므로 어디를
   * 눌렀는지가 필요 없습니다.
   */
  const onPlanDay       = useCallback((day: string) => openTaskModal({ due: day, projectId: projectId ?? undefined }), [openTaskModal, projectId])
  const onTaskDragStart = useCallback((taskId: string) => setDraggingId(taskId), [])
  const onTaskDragEnd   = useCallback(() => { setDraggingId(null); setDragOver(null) }, [])

  /**
   * ── 날짜 칸을 누르면 무엇이 생기나 ────────────────────────────────────────
   *
   * 전에는 곧장 새 업무 창이 열렸습니다. 그런데 달력에서 날짜를 누르는 사람이
   * 늘 업무를 만들려는 것은 아닙니다 — 회의를 잡으려는 손도 같은 자리를
   * 누릅니다. 둘 중 하나로 정해 두면 나머지 절반은 매번 창을 닫고 다른 데로
   * 가야 합니다.
   *
   * 그래서 **무엇을 만들지 먼저 묻습니다.** 두 줄짜리 메뉴 한 번이 잘못 열린
   * 창을 닫는 것보다 짧습니다.
   */
  /**
   * ── 한 칸에 몇 줄이 들어가나 ───────────────────────────────────────────────
   *
   * 다섯 줄로 못 박아 두었습니다. 그런데 칸 높이는 창 높이를 여섯으로 나눈
   * 값이라 창을 줄이면 같이 줄고, 그러면 다섯 줄이 안 들어갑니다 — 아래가
   * 그냥 **잘렸습니다.** 'n개 더보기'는 다섯 개를 넘을 때만 뜨니까, 넷이
   * 있는데 셋만 보이는 칸에서는 아무 말도 안 했습니다.
   *
   * 칸마다 재지 않습니다. 쉰여섯 칸이 다 같은 높이라(격자가 그렇게 나눕니다)
   * 격자를 한 번 재면 답이 나옵니다.
   */
  const trackRef = useRef<HTMLDivElement>(null)
  const [rowsFit, setRowsFit] = useState(5)
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const measure = () => {
      // 격자는 여덟 줄짜리고 위아래 한 줄씩은 스크롤용 여분입니다.
      const perCell = el.clientHeight / 8
      setRowsFit(Math.max(1, Math.floor((perCell - CELL_HEAD_H) / CELL_ROW_H)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [menu, setMenu] = useState<{ x: number; y: number; day: string } | null>(null)
  const [quick, setQuick] = useState<{ x: number; y: number; day: string } | null>(null)
  const onPickDay = useCallback((day: string, x: number, y: number) => setMenu({ x, y, day }), [])

  /**
   * 날짜 숫자를 누르면 그 날부터 3일.
   *
   * 월 화면의 칸 하나에는 다섯 줄밖에 안 들어갑니다. '그 날 뭐가 있나'를
   * 물으려면 결국 다른 화면으로 가야 하는데, 지금까지는 3일 뷰로 바꾸고
   * 화살표로 그 날짜까지 걸어가야 했습니다. 구글 캘린더에서 숫자를 누르면
   * 그 날이 열리는 것과 같은 자리입니다.
   */
  const setCalRange = useUiStore(s => s.setCalRange)
  const setCalAnchor = useUiStore(s => s.setCalAnchor)
  const onOpenDay = useCallback((day: string) => {
    setCalAnchor(day)
    setCalRange(3)
  }, [setCalAnchor, setCalRange])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Day-of-week labels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: '1px solid var(--bd)', background: 'var(--bg2)', flexShrink: 0 }}>
        {DAY_LABELS.map((d, i) => (
          <div key={d} style={{ padding: '7px 10px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--t3)', opacity: i === 0 || i === 6 ? .75 : 1 }}>
            {d}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflow: 'hidden', background: 'var(--bg)' }}>
        {/* Eight rows in the height of six, pulled up by one: the first and last
            are the buffer the scroll slides into. --slide is the part of a week
            currently being crossed; see useWheelSlide.

            minmax(0, 1fr) rather than 1fr: a track sized 1fr still refuses to go
            below its content's own width, so one long entry used to widen its
            column and squeeze the rest. Paired with minWidth: 0 down the tree,
            the seven columns stay identical at any window size. */}
        <div
          ref={trackRef}
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            gridTemplateRows: 'repeat(8, 1fr)', height: `${(8 / 6) * 100}%`,
            transform: 'translateY(calc(-12.5% + var(--slide, 0px)))',
            willChange: 'transform',
          }}
        >
          {cells.map(({ date, isCurrentMonth }, i) => {
            const dateStr = fmt(date)
            return (
              <MonthCell
                key={dateStr}
                day={dateStr}
                dayOfMonth={date.getDate()}
                column={i % 7}
                isCurrentMonth={isCurrentMonth}
                isToday={dateStr === todayStr}
                isDragTarget={dragOver === dateStr}
                chips={chipsByDate.get(dateStr)}
                milestones={milestoneByDate[dateStr]}
                rowsFit={rowsFit}
                draggingId={draggingId}
                canMove={canMove}
                onDragOverDay={onDragOverDay}
                onDragLeaveDay={onDragLeaveDay}
                onDropDay={handleDrop}
                onPickDay={onPickDay}
                onOpenDay={onOpenDay}
                onOpenTask={openTaskDetail}
                onTaskDragStart={onTaskDragStart}
                onTaskDragEnd={onTaskDragEnd}
              />
            )
          })}
        </div>
      </div>

      {menu && (
        <>
          {/*
            ── 바깥을 누르면 닫힙니다 ──────────────────────────────────────────
            ActionMenu는 mousedown으로 닫습니다. 그런데 이 메뉴를 여는 것은
            칸의 click이라, 다른 칸을 누르면 **닫혔다가 곧바로 다시 열렸습니다**
            — mousedown에서 닫고, 뒤따라 오는 click이 새로 여는 순서입니다.
            사람 눈에는 아무리 눌러도 안 닫히는 메뉴였습니다.

            그래서 판을 하나 깔아 클릭을 여기서 멈춥니다. 판을 누른 것은
            '닫겠다'는 뜻이고, 그 클릭이 칸까지 내려가면 안 됩니다.
          */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 499 }}
            onClick={() => setMenu(null)}
            onContextMenu={e => { e.preventDefault(); setMenu(null) }}
          />
          <ActionMenu
            x={menu.x} y={menu.y}
            actions={[
              { label: '업무 추가', icon: 'plus', onSelect: () => onPlanDay(menu.day) },
              { label: '일정 추가', icon: 'calendar', onSelect: () => setQuick({ x: menu.x, y: menu.y, day: menu.day }) },
            ]}
            onClose={() => setMenu(null)}
          />
        </>
      )}

      {quick && (
        <QuickEvent
          x={quick.x} y={quick.y} day={quick.day}
          onClose={() => setQuick(null)}
        />
      )}
    </div>
  )
}

/**
 * ── 날짜 칸에서 만드는 일정 ──────────────────────────────────────────────────
 *
 * 월 화면의 칸에는 시각이 없습니다. 그렇다고 종일로만 만들게 두면, 회의를
 * 잡으려고 날짜를 누른 사람은 만들어 놓고 다시 3일 화면으로 가서 끌어 옮겨야
 * 합니다 — 두 번 만드는 셈입니다.
 *
 * 그래서 **여기서 시간까지 정합니다.** 시각을 고르는 방법은 업무의 일정
 * 패널과 같은 격자입니다(DayTimeGrid) — 그 날 이미 잡힌 것이 같이 그려져
 * 있어서, '이 자리가 비었나'를 묻지 않고 보고 고릅니다.
 *
 * 종일은 한 번 눌러 갈 수 있습니다. 하루짜리 표시(휴가, 마감일)에는 시각이
 * 없는 편이 맞고, 우리가 정해 붙이면 아무도 안 정한 시간이 캘린더에 사실처럼
 * 적힙니다.
 */
function QuickEvent({ x, y, day, onClose }: {
  x: number; y: number; day: string; onClose: () => void
}) {
  const createEvent = useGCalStore(s => s.createEvent)
  const events = useGCalStore(s => s.events)
  const bookRoom = useOrgStore(s => s.book)
  const myEmail = useAuthStore(s => s.email)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const projects = useProjectStore(s => s.projects)
  const [title, setTitle] = useState('')
  const [allDay, setAllDay] = useState(false)
  const [startMin, setStartMin] = useState(14 * 60)
  const [minutes, setMinutes] = useState(60)
  const [guests, setGuests] = useState<string[]>([])
  const [room, setRoom] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 남의 일정은 빼고 내 것만. 띠는 '내 하루가 얼마나 찼나'를 그립니다.
  const dayEvents = useMemo(
    () => events.filter(ev => !ev.peekOf && (ev.startIso ?? ev.start).slice(0, 10) === day),
    [events, day],
  )
  // 부를 수 있는 사람 — 내가 같이 일하는 프로젝트의 멤버들. 타임라인 카드와
  // 같은 셈입니다.
  const teammates = useMemo(
    // 보관한 프로젝트는 뺍니다 — 치워 둔 일의 사람들이 후보로 서면 지금
    // 같이 일하는 사람을 그만큼 늦게 찾습니다. 타임라인 카드와 같은 셈입니다.
    () => [...authorizedEmails(projects.filter(p => !p.archived), myEmail)]
      .filter(e => e !== myEmail?.toLowerCase()).sort(),
    [projects, myEmail],
  )
  const slot = useMemo(
    () => ({ date: day, from: startMin, to: startMin + minutes }),
    [day, startMin, minutes],
  )

  const submit = async () => {
    const summary = title.trim()
    if (!summary || busy) return
    setBusy(true)
    // 실패하면 스토어가 error를 세우고 캘린더 단추가 그걸 말합니다. 여기서
    // 창을 닫아 버리면 방금 친 제목이 같이 사라집니다.
    /*
      방 이름을 구글 일정의 **장소**에도 적습니다. 예약 자체는 우리
      데이터베이스에 있고 그건 조직원만 읽는데, 회의에는 도메인 밖 사람도
      있습니다 — 그들에게 '어디서 하지'를 답해 줄 유일한 공통 자리입니다.
      만들 때 같이 넣습니다. 나중에 붙이면 이미 나간 초대 메일에는 없습니다.
    */
    const roomName = room
      ? useOrgStore.getState().rooms.find(r => r.id === room)?.name
      : undefined
    const id = await createEvent(allDay
      ? { summary, allDayDate: day, ...(guests.length ? { attendees: guests } : {}) }
      : {
          summary,
          startDateTime: localIso(day, startMin),
          endDateTime: localIso(day, startMin + minutes),
          ...(guests.length ? { attendees: guests } : {}),
          ...(roomName ? { location: roomName } : {}),
        })
    /*
      일정이 생긴 뒤에 방을 잡습니다. 예약은 일정 id로 자기가 어느 회의의
      것인지 기억하고, 그 id는 구글이 만들어 준 다음에야 있습니다. 반대로
      하면 주인 없는 예약이 남아 아무도 못 치웁니다.
    */
    if (id && room && myEmail && !allDay) {
      await bookRoom({
        date: day, roomId: room, from: startMin, to: startMin + minutes,
        title: summary, eventId: id, by: myEmail, byName: getNameByEmail(myEmail),
      })
    }
    setBusy(false)
    if (id) onClose()
  }

  const d = toDate(day)

  /**
   * ── 카드가 창을 안 넘습니다 ───────────────────────────────────────────────
   *
   * 높이를 손으로 적어 뒀었습니다(`330`). 그런데 카드 높이는 그날 회의실이
   * 몇 개인지, 부른 사람이 몇 명인지에 따라 매번 다릅니다 — 적어 둔 숫자는
   * 만든 날의 카드 높이일 뿐이라, 칸이 하나 늘면 그만큼 화면 밖으로
   * 밀려납니다. 같은 실수를 세 번째 하고 있습니다.
   *
   * 재지도 않습니다. 재면 첫 프레임은 잰 값이 없는 채로 그려져서 자리가 한 번
   * '타닥' 하고 바뀝니다. 대신 **남은 공간을 카드의 최대 높이로 줍니다** —
   * 아래로 열면 아래 남은 만큼, 위로 열면 위 남은 만큼. 내용이 그보다 길면
   * 카드가 제 안에서 스크롤할 뿐 자리는 안 움직입니다. 타임라인 카드가
   * 같은 방식입니다.
   */
  // 폭은 하나입니다. 시간/종일을 오갈 때마다 카드가 넓어졌다 좁아졌다 하면,
  // 바꾼 것은 한 칸인데 화면 전체가 움직인 것처럼 보입니다.
  const W = 306
  const M = 8
  const MIN_H = 220
  const place = (() => {
    const left = Math.max(M, Math.min(x, window.innerWidth - W - M))
    const top = Math.max(M, y)
    const below = window.innerHeight - top - M
    if (below >= MIN_H) return { left, top, maxHeight: below }
    const above = y - M
    // 위로 열 때는 top이 아니라 bottom으로 붙입니다. top으로 붙이면 내용이
    // 늘 때 아래로 자라서 다시 창을 넘습니다.
    if (above > below) return { left, bottom: window.innerHeight - y, maxHeight: above }
    return { left, top, maxHeight: Math.max(below, 160) }
  })()

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 8998 }} onClick={onClose} />
      <div
        style={{
          position: 'fixed', ...place,
          zIndex: 8999, width: W, background: 'var(--bg)', border: '1px solid var(--bd)',
          borderRadius: 'var(--r3)', boxShadow: 'var(--sh-lg)', padding: 12,
          overflowY: 'auto', boxSizing: 'border-box',
        }}
        data-scrolls
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
      >
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); void submit() } }}
          placeholder="일정 제목"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '6px 8px', marginBottom: 8,
            borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'var(--bg2)',
            color: 'var(--t1)', fontSize: 13, outline: 'none', fontFamily: 'var(--font)',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {/* 날짜만입니다. 시각과 길이는 바로 아래 목록이 말하고 있어서,
              여기 또 적으면 같은 말이 두 줄이 됩니다. */}
          <span style={{ fontSize: 11.5, color: 'var(--t2)', flex: 1, minWidth: 0 }}>
            {`${d.getMonth() + 1}월 ${d.getDate()}일`}
          </span>
          {/*
            두 값뿐인 축이라 목록이 아니라 스위치입니다. 시간이 있는 일정과
            종일은 정말로 둘 중 하나고, 그 사이에 낄 값이 없습니다.
          */}
          <div style={{ display: 'flex', gap: 2, padding: 2, flexShrink: 0, borderRadius: 'var(--r2)', background: 'var(--bg3)' }}>
            {([['시간', false], ['종일', true]] as const).map(([label, on]) => (
              <button
                key={label}
                onClick={() => setAllDay(on)}
                style={{
                  padding: '2px 8px', borderRadius: 'var(--r1)', border: 'none',
                  fontSize: 11.5, fontFamily: 'var(--font)',
                  cursor: allDay === on ? 'default' : 'pointer',
                  background: allDay === on ? 'var(--bg)' : 'transparent',
                  color: allDay === on ? 'var(--t1)' : 'var(--t3)',
                  fontWeight: allDay === on ? 600 : 400,
                  boxShadow: allDay === on ? 'var(--sh-sm)' : 'none',
                }}
              >{label}</button>
            ))}
          </div>
        </div>

        {!allDay && (
          <>
            <TimeRange
              startMin={startMin} minutes={minutes}
              onChange={(s2, m) => { setStartMin(s2); setMinutes(m) }}
            />
            <div style={{ marginTop: 8 }}>
              <BusyStrip
                dayEvents={dayEvents} startMin={startMin} minutes={minutes}
                onChange={setStartMin}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8 }}>
              {[30, 60, 90].map(m => (
                <button
                  key={m}
                  onClick={() => setMinutes(Math.min(m, 24 * 60 - startMin))}
                  style={{
                    padding: '2px 8px', fontSize: 11, borderRadius: 'var(--r1)', background: 'transparent',
                    border: `1px solid ${minutes === m ? 'var(--ac)' : 'var(--bd)'}`,
                    color: minutes === m ? 'var(--ac)' : 'var(--t3)',
                    cursor: 'pointer', fontFamily: 'var(--font)',
                  }}
                >{m < 60 ? `${m}분` : `${m / 60}시간`}</button>
              ))}
              {/* 내 일정과 겹치면 그 자리에서 말합니다 — 띠에도 보이지만,
                  띠는 훑어보는 것이고 이 줄은 읽히는 것입니다. */}
              {dayEvents.some(ev => {
                if (ev.allDay || !ev.startIso || !ev.endIso) return false
                const s2 = minutesOfIso(ev.startIso), e2 = minutesOfIso(ev.endIso)
                return startMin < e2 && s2 < startMin + minutes
              }) && <span style={{ fontSize: 11, color: '#D9730D' }}>겹치는 일정 있음</span>}
            </div>
          </>
        )}

        {/*
          ── 참석자와 회의실 ──────────────────────────────────────────────────
          타임라인 카드의 그 칸을 그대로 씁니다. 같은 일을 하는 화면이 둘이면
          둘 중 하나는 언젠가 뒤처집니다 — 여기만 회의실 목록이 옛것이거나,
          저기만 응답 표시가 있는 식으로요.

          종일에는 안 붙입니다. 회의실은 시각이 있어야 잡히고(누가 언제
          쓰는지가 예약의 전부입니다), 시각 없는 하루를 통째로 잡는 것은
          이 카드가 할 일이 아닙니다.
        */}
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--bd)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', marginBottom: 4 }}>참석자</div>
          <AttendeeList
            teammates={teammates}
            chosen={guests}
            nameOf={getNameByEmail}
            onToggle={email => setGuests(g => g.includes(email) ? g.filter(x => x !== email) : [...g, email])}
          />
        </div>

        {/*
          아직 안 잡은 방을 예약인 척 넘깁니다. RoomRow는 '지금 고른 방'을
          예약에서 읽는데, 여기서는 저장하기 전이라 예약이 없습니다 — null을
          주면 골라도 아무 표시가 안 나서 안 골라진 것처럼 보였습니다.
          타임라인의 새 일정 카드도 같은 방식으로 넘깁니다.
        */}
        {!allDay && (
          <RoomRow
            slot={slot}
            booking={room ? { id: '', roomId: room, from: startMin, to: startMin + minutes, by: '', at: 0 } : null}
            onPick={setRoom}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <button
            onClick={() => void submit()}
            disabled={!title.trim() || busy}
            style={{
              padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--r1)',
              border: 'none', background: 'var(--ac)', color: '#fff', fontFamily: 'var(--font)',
              cursor: title.trim() && !busy ? 'pointer' : 'default',
              opacity: title.trim() && !busy ? 1 : .5,
            }}
          >{busy ? '만드는 중…' : '만들기'}</button>
          <span style={{ fontSize: 11, color: 'var(--t3)' }}>
            {allDay ? '시각 없이 하루로' : guests.length ? '초대 메일이 발송됩니다' : ''}
          </span>
        </div>
      </div>
    </>
  )
}

/**
 * One day of the month grid.
 *
 * Memoised, and that is the point: scrolling a month swaps seven cells and
 * leaves forty-nine exactly as they were. Every prop is a primitive or an array
 * whose identity the parent holds stable, so React can compare them cheaply and
 * skip the rest.
 */
const MonthCell = React.memo(function MonthCell({
  day, dayOfMonth, column, isCurrentMonth, isToday, isDragTarget,
  chips, milestones, rowsFit, draggingId, canMove,
  onDragOverDay, onDragLeaveDay, onDropDay, onPickDay, onOpenDay, onOpenTask,
  onTaskDragStart, onTaskDragEnd,
}: {
  day: string
  dayOfMonth: number
  column: number
  isCurrentMonth: boolean
  isToday: boolean
  isDragTarget: boolean
  chips?: Chip[]
  milestones?: { id: string; name: string; color: string }[]
  /** 이 칸에 들어가는 줄 수. 창 높이에 따라 달라집니다 — MonthGrid가 잽니다. */
  rowsFit: number
  draggingId: string | null
  /** 이 일정을 끌 수 있나 — 내가 쓸 수 있는 캘린더의 것만. */
  canMove: (ev: GCalEvent) => boolean
  onDragOverDay: (day: string) => void
  onDragLeaveDay: () => void
  onDropDay: (e: React.DragEvent, day: string) => void
  /** 빈 자리를 누른 곳. 무엇을 만들지 묻는 메뉴가 거기 섭니다. */
  onPickDay: (day: string, x: number, y: number) => void
  /** 날짜 숫자를 누른 것 — 그 날부터 3일 화면으로. */
  onOpenDay: (day: string) => void
  onOpenTask: (id: string) => void
  onTaskDragStart: (taskId: string) => void
  onTaskDragEnd: () => void
}) {
  const all = chips ?? []
  const hasMilestone = !!milestones?.length
  /** 몰린 마일스톤을 펼쳐 보는 자리. 누른 지점에 섭니다. */
  const [showAll, setShowAll] = useState<{ x: number; y: number } | null>(null)
  /** 그 목록에서 무언가를 끌고 있는가 — 아래 '판'을 비켜 주려고 씁니다. */
  const [dragOut, setDragOut] = useState(false)
  const isWeekend = column === 0 || column === 6

  // 마일스톤이 한 줄 차지하면 일정은 한 줄 덜 들어갑니다.
  const LIMIT = Math.max(1, rowsFit - (hasMilestone ? 1 : 0))
  const visible = all.length <= LIMIT ? all : all.slice(0, LIMIT - 1)
  const overflow = all.length - visible.length

  return (
    <div
      data-month-cell
      onDragOver={e => { e.preventDefault(); onDragOverDay(day) }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) onDragLeaveDay() }}
      onDrop={e => onDropDay(e, day)}
      onClick={e => onPickDay(day, e.clientX, e.clientY)}
      style={{
        cursor: 'pointer',
        borderRight: column === 6 ? 'none' : '1px solid var(--bd)',
        borderBottom: '1px solid var(--bd)',
        display: 'flex', flexDirection: 'column',
        minHeight: 90, minWidth: 0, overflow: 'hidden',
        background: isDragTarget ? 'var(--ac-l)' : hasMilestone ? 'rgba(144,101,176,.05)' : !isCurrentMonth ? 'var(--bg2)' : isToday ? 'rgba(35,131,226,.03)' : isWeekend ? 'var(--bg2)' : 'transparent',
        outline: isDragTarget ? '2px solid var(--ac)' : hasMilestone ? '2px solid rgba(144,101,176,.30)' : 'none',
        outlineOffset: '-2px',
        transition: 'background .08s',
      }}
    >
      {/*
        ── 날짜 줄에는 날짜만 ────────────────────────────────────────────────
        마일스톤 알약이 여기 같이 서 있었습니다. 마일스톤과 일정으로 칸이
        꽉 차면 **누를 빈 자리가 한 뼘도 없어서**, 그 날에 무언가 만들려면
        만들 수가 없었습니다.

        마일스톤은 한 칸 내려 일정 블록 맨 위로 갔습니다 — 날짜에 붙은
        것이라는 뜻은 그대로고, 이 줄은 통째로 '여기에 만들기'가 됩니다.
      */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '5px 8px 3px', gap: 4 }}>
        {/* 숫자는 '이 날을 열기'입니다. 칸의 나머지는 '여기에 만들기'고요 —
            같은 칸에 두 가지 뜻이 있으니 숫자 쪽이 눌리는 것처럼 보여야
            합니다(손이 오면 동그라미가 뜹니다). */}
        <button
          onClick={e => { e.stopPropagation(); onOpenDay(day) }}
          title="이 날부터 3일 보기"
          className={isToday ? 'bpp-daynum on' : 'bpp-daynum'}
          style={{
            border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font)',
            fontSize: 12, fontWeight: isToday ? 700 : 400,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 22, height: 22, borderRadius: '50%',
            /*
              오늘이 아닐 때는 배경을 **여기서 안 정합니다.**

              인라인 스타일은 클래스 규칙을 이깁니다. `background: transparent`를
              적어 두었더니 `.bpp-daynum:hover`가 늘 졌고, 그래서 동그라미가
              한 번도 안 떴습니다 — 규칙은 있는데 화면에는 없는 상태였습니다.
              같은 값을 두 곳에서 정하면 어느 쪽이 이기는지를 매번 기억해야
              하니, 배경은 CSS 한 곳에만 둡니다.
            */
            ...(isToday ? { background: 'var(--ac)' } : {}),
            color: isToday ? '#fff' : !isCurrentMonth ? 'var(--t3)' : 'var(--t2)',
          }}
        >
          {dayOfMonth}
        </button>
      </div>

      {/*
        ── 줄들은 잘리고, '더보기'는 안 잘립니다 ──────────────────────────────
        재서 넣지만 글자 크기나 줄바꿈 때문에 한 줄이 삐져나올 수 있습니다.
        그때 잘려야 하는 것은 일정이지 '몇 개가 더 있다'는 말이 아닙니다 —
        그게 잘리면 못 본 것이 있다는 사실 자체가 사라집니다.

        그래서 줄들만 남는 높이 안에서 잘리고(flex: 1 + hidden), 더보기 줄은
        그 아래 제 자리를 따로 갖습니다.
      */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 3px 4px', minWidth: 0, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/*
          ── 마일스톤이 몰린 날 ──────────────────────────────────────────────
          한 줄에 나란히 세워 두었습니다. 하나일 때는 이름이 다 보이는데,
          넷이 겹치는 날에는 서로를 눌러서 **다이아몬드만 넷** 남았습니다 —
          무엇이 있는지 알 방법이 화면에 없었습니다. 마감이 몰린 날이 정작
          제일 알고 싶은 날인데요.

          둘 이상이면 개수 하나로 접고, 누르면 이름을 펼칩니다. 이름이 다
          보이는 하나짜리는 그대로 둡니다 — 대부분이 그쪽이고, 접으면 한 번
          더 눌러야 알게 됩니다.
        */}
        {hasMilestone && (
          /*
            `flex: 1`이 남아 있었습니다. 날짜 줄에 있을 때는 '남는 가로를 다
            먹어라'였는데, 세로로 쌓는 목록으로 내려오니 **남는 세로를 다
            먹고** 그 안에서 알약이 가운데 섰습니다. 위에 붙어야 합니다.
          */
          <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexShrink: 0, minWidth: 0, overflow: 'hidden' }}>
            {milestones!.length > 1 ? (
              <button
                onClick={e => { e.stopPropagation(); setShowAll({ x: e.clientX, y: e.clientY }) }}
                title={milestones!.map(m => m.name).join(', ')}
                style={{ ...MS_CHIP, border: 'none', cursor: 'pointer', fontFamily: 'var(--font)' }}
              >
                <StackedDiamonds />
                마일스톤 {milestones!.length}개
              </button>
            ) : (
              /* Draggable, like the tasks below: a milestone's date is the one
                 thing about it this view shows, so this is where it should be
                 possible to change it. */
              milestones!.map(ms => (
                <span
                  key={ms.id}
                  draggable
                  title={`${ms.name} — 끌어서 날짜 변경`}
                  onDragStart={e => {
                    e.stopPropagation()
                    e.dataTransfer.setData('milestoneId', ms.id)
                    e.dataTransfer.effectAllowed = 'move'
                    onTaskDragStart(ms.id)
                  }}
                  onDragEnd={onTaskDragEnd}
                  onClick={e => e.stopPropagation()}
                  style={{
                    ...MS_CHIP,
                    cursor: 'grab', userSelect: 'none',
                    opacity: draggingId === ms.id ? .35 : 1, transition: 'opacity .1s',
                  }}
                >
                  ◆ {ms.name}
                </span>
              ))
            )}
          </div>
        )}

        {visible.map((chip, ci) => {
          if (chip.kind === 'gcal') {
            const ev = chip.ev
            const movable = canMove(ev)
            return (
              <a
                key={ev.id}
                href={ev.htmlLink}
                target="_blank"
                rel="noopener noreferrer"
                title={ev.peekOf ? `${ev.peekOf} · ${ev.summary}` : movable ? `${ev.summary} — 끌어서 날짜 변경` : ev.summary}
                draggable={movable}
                onDragStart={movable ? (e => {
                  e.stopPropagation()
                  // 링크는 브라우저가 알아서 '주소 끌기'로 만듭니다. 그 위에
                  // 우리 것을 덮어써야 놓는 쪽이 무엇을 받았는지 압니다.
                  e.dataTransfer.clearData()
                  e.dataTransfer.setData('eventId', ev.id)
                  e.dataTransfer.setData('fromDate', day)
                  e.dataTransfer.effectAllowed = 'move'
                  onTaskDragStart(ev.id)
                }) : undefined}
                onDragEnd={movable ? onTaskDragEnd : undefined}
                /* 아직 수락 안 한 초대는 칠하지 않고 점선으로. 달의 한 칸에
                   칩이 넷 놓일 때, 확정된 것만 칠해져 있어야 그날이 실제로
                   얼마나 찼는지 보입니다. */
                style={{
                  fontSize: 10, fontWeight: 500, padding: '2px 6px', borderRadius: 3,
                  color: GCAL_TEXT, overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap', textDecoration: 'none', display: 'block',
                  // 자리가 모자라면 줄은 **잘려야지 눌리면 안 됩니다.** 기본값
                  // (flex-shrink: 1)으로 두었더니 일정이 많은 날만 줄 높이가
                  // 찌그러져서, 같은 일정이 날마다 다른 크기로 보였습니다.
                  flexShrink: 0,
                  cursor: movable ? 'grab' : 'pointer', minWidth: 0, boxSizing: 'border-box',
                  userSelect: 'none',
                  opacity: draggingId === ev.id ? .35 : 1, transition: 'opacity .1s',
                  ...(ev.peekOf
                    // 남의 것은 내 것과 확실히 달라 보여야 합니다. 내 하루가
                    // 얼마나 찼는지를 읽는 화면인데 남의 일정이 같은 색으로
                    // 섞이면 그 셈이 틀립니다.
                    ? { background: 'transparent', border: `1px solid ${PEEK_COLOR}`, color: PEEK_COLOR, opacity: .85 }
                    : awaitingMe(ev)
                      ? { background: 'transparent', border: `1px dashed ${GCAL_TEXT}` }
                      : { background: GCAL_BG }),
                }}
                onClick={e => e.stopPropagation()}
                onMouseEnter={e => { if (draggingId !== ev.id) e.currentTarget.style.opacity = '.75' }}
                onMouseLeave={e => { if (draggingId !== ev.id) e.currentTarget.style.opacity = '1' }}
              >
                {ev.startTime ? `${ev.startTime} ` : ''}{ev.summary}
              </a>
            )
          }
          const t = chip.t
          const color = getCatColor(t.cat)
          const isBeingDragged = draggingId === t.id
          return (
            <div
              key={t.id + ci}
              draggable
              onDragStart={e => { e.dataTransfer.setData('taskId', t.id); e.dataTransfer.setData('fromDate', day); e.dataTransfer.effectAllowed = 'move'; onTaskDragStart(t.id) }}
              onDragEnd={onTaskDragEnd}
              onClick={e => { e.stopPropagation(); onOpenTask(t.id) }}
              style={{ fontSize: 10, fontWeight: 500, padding: '2px 6px', borderRadius: 3, background: color.bg, color: color.text, cursor: 'grab', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: isBeingDragged ? .35 : 1, transition: 'opacity .1s', userSelect: 'none', minWidth: 0, flexShrink: 0 }}
              onMouseEnter={e => { if (!isBeingDragged) e.currentTarget.style.opacity = '.75' }}
              onMouseLeave={e => { if (!isBeingDragged) e.currentTarget.style.opacity = '1' }}
            >
              {t.name}
            </div>
          )
        })}
      </div>

        {/*
        ── 못 보여준 것이 몇 개인지 ──────────────────────────────────────────
        나머지가 있다는 것을 10px 회색 글자로만 말하고 있었더니, 줄들 사이에
        섞여서 '아래에 더 있다'가 아니라 '흐린 일정 하나'로 읽혔습니다.

        위의 줄들과 다른 것이니 다르게 생겨야 합니다 — 옅은 판을 깔아
        누르는 것으로 보이게 합니다. 누르면 그 날로 갑니다: 더 보는 일이지
        만드는 일이 아니라서, 칸을 누른 것으로 치면 안 됩니다.

        칸의 바닥에 삽니다. 줄 목록 안에 있으면 목록이 잘릴 때 같이 잘리고,
        그러면 못 본 것이 있다는 사실 자체가 사라집니다.
      */}
      {overflow > 0 && (
        <button
          onClick={e => { e.stopPropagation(); onOpenDay(day) }}
          style={{
            border: 'none', background: 'var(--bg3)', textAlign: 'left',
            fontSize: 10.5, color: 'var(--t2)', padding: '2px 6px',
            borderRadius: 3, cursor: 'pointer', fontFamily: 'var(--font)',
            // 줄들과 같은 왼쪽 선에 맞춥니다 — 목록 밖으로 나와서 그 여백을
            // 이제 스스로 가져야 합니다.
            margin: '0 3px 4px', flexShrink: 0, alignSelf: 'flex-start',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg4)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg3)' }}
        >{overflow}개 더보기</button>
      )}

      {/*
        ── 판을 떠나서 뜹니다 ────────────────────────────────────────────────
        `position: fixed`는 조상에 `transform`이 걸려 있으면 **화면이 아니라 그
        조상을 기준으로** 놓입니다. 월 격자는 스크롤을 위해 통째로 translateY
        되어 있어서, 화면 좌표로 적어 둔 자리가 격자 안 좌표로 읽혔고 팝업이
        화면 밖 저 멀리 떴습니다.

        고칠 방법은 좌표를 고치는 게 아니라 **그 나무를 떠나는 것**입니다.
        (같은 이유로 목록 화면의 메뉴들도 body로 나갑니다 — shared/Menu.)
      */}
      {showAll && createPortal(
        <>
          {/*
            ── 끌 때는 판이 비켜섭니다 ──────────────────────────────────────
            바깥을 눌러 닫으라고 화면 전체에 판을 하나 깔아 두었습니다. 그런데
            그 판은 **끄는 동안에도** 화면을 덮고 있어서, 끌고 간 날짜 칸이
            드롭을 아예 못 받았습니다 — 손은 옮겼는데 아무 일도 안 일어납니다.
            판을 안 깔면 바깥 클릭이 칸까지 내려가 엉뚱한 창이 열리므로, 판은
            두되 끄는 동안만 통과시킵니다.
          */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 8900, pointerEvents: dragOut ? 'none' : 'auto' }}
            onClick={e => { e.stopPropagation(); setShowAll(null) }}
          />
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed', zIndex: 8901,
              left: Math.max(8, Math.min(showAll.x, window.innerWidth - 248)),
              top: Math.max(8, Math.min(showAll.y, window.innerHeight - 40 - milestones!.length * 26)),
              width: 240, padding: 6, background: 'var(--bg)',
              border: '1px solid var(--bd)', borderRadius: 'var(--r2)', boxShadow: 'var(--sh-md)',
            }}
          >
            {/* 여기서도 끌어서 날짜를 옮깁니다. 접었다고 할 수 있던 일이
                없어지면, 마감이 몰린 날에서만 못 옮기게 됩니다 — 정작 제일
                옮기고 싶은 날에서요. */}
            {milestones!.map(ms => (
              <div
                key={ms.id}
                draggable
                title={`${ms.name} — 끌어서 날짜 변경`}
                onDragStart={e => {
                  e.stopPropagation()
                  e.dataTransfer.setData('milestoneId', ms.id)
                  e.dataTransfer.effectAllowed = 'move'
                  onTaskDragStart(ms.id)
                  setDragOut(true)
                }}
                /*
                  창은 **끝날 때** 닫습니다. `dragstart`에서 닫았더니 끌던 줄이
                  그 자리에서 사라졌고, 브라우저는 없어진 것을 계속 끌지
                  않습니다 — 손은 움직이는데 아무 데도 안 놓였습니다.
                */
                onDragEnd={() => { onTaskDragEnd(); setDragOut(false); setShowAll(null) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 7px', borderRadius: 'var(--r1)',
                  fontSize: 12.5, color: 'var(--t1)', cursor: 'grab', userSelect: 'none',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ color: NOTION.purple.text, flexShrink: 0 }}>◆</span>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{ms.name}</span>
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
})

/**
 * 겹쳐 놓은 마름모.
 *
 * 하나짜리와 여럿을 같은 `◆` 하나로 그렸더니, 접혀 있다는 것이 옆의 숫자
 * 에서만 보였습니다. 모양이 먼저 말해 주는 편이 낫습니다 — 두 장이 겹쳐 있으면
 * '여러 개'라는 뜻이 글자를 읽기 전에 전해집니다.
 */
function StackedDiamonds() {
  return (
    <svg width="13" height="10" viewBox="0 0 13 10" style={{ flexShrink: 0, display: 'block' }} aria-hidden>
      {/* 뒤쪽 한 장. 앞의 것과 같은 색이면 겹친 자리가 안 보여서, 옅게 둡니다. */}
      <path d="M4 1 L7 5 L4 9 L1 5 Z" fill="currentColor" opacity=".45" />
      <path d="M9 1 L12 5 L9 9 L6 5 Z" fill="currentColor" />
    </svg>
  )
}

/**
 * 칸의 치수.
 *
 * 날짜 줄(위 여백 5 + 아래 3 + 동그라미 22)과 줄 하나의 높이입니다. 재는
 * 대신 적어 둡니다 — 쉰여섯 칸 안의 줄을 다 재면 그게 매 프레임의 값이고,
 * 여기서 필요한 건 '몇 줄이 들어가나' 하나뿐입니다.
 *
 * 넉넉하게 잡습니다. 모자라게 잡으면 한 줄이 잘리는데, 그건 지금 고치고 있는
 * 바로 그 증상입니다.
 */
const CELL_HEAD_H = 32
const CELL_ROW_H = 17

/** 마일스톤 알약. 접힌 것과 펼친 것이 같은 모양이어야 같은 것으로 읽힙니다. */
const MS_CHIP: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600,
  flexShrink: 0,
  color: NOTION.purple.text, background: NOTION.purple.bg, borderRadius: 4, padding: '1px 5px',
  minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

function NavBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ height: CTRL_H, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', padding: '0 10px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)', background: 'transparent', fontSize: 12, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)', lineHeight: 1 }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg2)'; e.currentTarget.style.color = 'var(--t1)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t2)' }}
    >
      {children}
    </button>
  )
}
