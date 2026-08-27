import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from '../../../store/authStore'
import { NO_BOOKINGS, useOrgStore, type Booking } from '../../../store/orgStore'
import { useGearStore, teamOfEmail } from '../../../store/gearStore'
import { useUserProfileStore } from '../../../store/userProfileStore'
import { addDays, fmtYMD, isComposing } from '../../../lib/utils'
import {
  DAY, dayNo, dayYMD, gearClash, gearRangeError, gearWhen, groupGear, hhmm,
  type GearBooking, type GearRange,
} from '../../../lib/gear'
import { TimeMenu } from '../../shared/TimePick'
import { DateField } from '../../shared/DatePicker'
import { Icon, type IconName } from '../../shared/Icon'
import { askConfirm } from '../../shared/Confirm'
import { assignLanes } from '../../../lib/lanes'
import { useMobile } from '../../../hooks/useMobile'

/**
 * ── 장비 현황 ────────────────────────────────────────────────────────────────
 *
 * 팀원이 물어본 것은 '내가 빌릴 수 있나'가 아니라 **'지금 무엇이 나가 있나'**
 * 였습니다. 그래서 이 화면의 중심은 예약 폼이 아니라 격자입니다 — 세로가
 * 장비, 가로가 날짜. 한 눈에 비어 있는 칸이 보이면 그게 답입니다.
 *
 * 목록으로 그리지 않은 이유: 예약 열두 건을 시간순으로 늘어놓으면 '9월 3일에
 * A7S3가 비었나'를 사람이 머릿속에서 맞춰 봐야 합니다. 격자는 그 계산을
 * 화면이 대신합니다.
 *
 * **팀 이름을 막대에 적습니다.** 누가 빌렸는지보다 어느 팀이 쓰는지가 먼저
 * 궁금하다고 했습니다 — 이름은 모를 수 있어도 팀은 압니다.
 */

const COL = 46
const ROW_H = 30
const NAME_W = 132
/** 종류 머리줄. 장비 줄보다 낮습니다 — 이름표지 항목이 아닙니다. */
const KIND_H = 20
/** 한 화면에 보이는 날 수. 2주면 '다음 주 촬영'까지 들어옵니다. */
const SPAN = 14

const WEEK = ['일', '월', '화', '수', '목', '금', '토']

/** 팀마다 다른 색. id에서 뽑으므로 새로고침해도 같은 팀은 같은 색입니다. */
const TEAM_HUES = [212, 145, 32, 280, 0, 190, 58, 320]
function teamHue(id: string | undefined): number {
  if (!id) return 212
  let n = 0
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0
  return TEAM_HUES[n % TEAM_HUES.length]
}

/**
 * ── 무엇이 지금 나가 있나 ────────────────────────────────────────────────────
 *
 * 회의실과 장비는 같은 질문에 답합니다 — '이거 지금 비었나'. 그래서 한 화면에
 * 두 탭으로 둡니다. 줄을 둘로 나누면 같은 질문을 두 군데서 물어야 합니다.
 *
 * 두 판은 **같은 격자**입니다. 세로가 자원, 가로가 시간, 막대 하나가 예약
 * 하나. 다른 것은 눈금의 단위뿐입니다 —
 *
 *   회의실   하루를 시각으로 나눕니다. 방은 하루에 대여섯 번 손이 바뀝니다.
 *   장비     2주를 날짜로 나눕니다. 카메라는 며칠씩 나갔다 옵니다.
 *
 * 단위를 맞추려다 둘 중 하나를 못 쓰게 만들지 않습니다. 회의실을 날짜 칸으로
 * 그리면 하루에 다섯 건이 한 칸에 겹치고, 장비를 시각으로 그리면 2주가
 * 화면에 안 들어옵니다.
 */
export function ResourceView() {
  const [tab, setTab] = useState<ResTab>(() => readTab())
  const pick = (next: ResTab) => {
    setTab(next)
    try { localStorage.setItem(TAB_KEY, next) } catch { /* 사파리 프라이빗 */ }
  }
  const tabs = <ResTabs tab={tab} onPick={pick} />
  return tab === 'room' ? <RoomBoard tabs={tabs} /> : <GearBoard tabs={tabs} />
}

type ResTab = 'room' | 'gear'
const TAB_KEY = 'bpp_res_tab'

/** 마지막으로 본 탭. **내 것입니다** — 남의 화면은 안 바뀝니다. */
function readTab(): ResTab {
  try { return localStorage.getItem(TAB_KEY) === 'gear' ? 'gear' : 'room' } catch { return 'room' }
}

function ResTabs({ tab, onPick }: { tab: ResTab; onPick: (t: ResTab) => void }) {
  return (
    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
      <ResTab on={tab === 'room'} onClick={() => onPick('room')} icon="users">회의실</ResTab>
      <ResTab on={tab === 'gear'} onClick={() => onPick('gear')} icon="camera">장비</ResTab>
    </div>
  )
}

/** 뷰 탭 한 장. 업무 화면의 탭과 같은 모양입니다(layout/ViewBar의 ViewTab). */
function ResTab({ on, onClick, icon, children }: {
  on: boolean
  onClick: () => void
  icon: IconName
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-current={on ? 'page' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px',
        borderRadius: 'var(--r2)', fontSize: 13.5, fontWeight: on ? 500 : 400,
        cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
        background: on ? 'var(--bg3)' : 'transparent',
        fontFamily: 'var(--font)',
        color: on ? 'var(--t1)' : 'var(--t2)',
        transition: 'background .1s, color .1s',
      }}
      onMouseEnter={e => { if (!on) { e.currentTarget.style.color = 'var(--t1)'; e.currentTarget.style.background = 'var(--bg3)' } }}
      onMouseLeave={e => { if (!on) { e.currentTarget.style.color = 'var(--t2)'; e.currentTarget.style.background = 'transparent' } }}
    >
      <span style={{ display: 'flex', opacity: on ? 1 : .75 }}><Icon name={icon} size={14} /></span>
      {children}
    </button>
  )
}

/** 하루의 시작·끝. 잡힌 예약이 이 밖으로 나가면 그만큼 넓힙니다 — 새벽 회의도
 *  화면 밖에 두지 않습니다. */
const ROOM_OPEN = 8 * 60
const ROOM_CLOSE = 20 * 60
/** 예약 막대 한 층의 높이. 층은 겹칠 때만 늘어납니다(lib/lanes). */
const LANE_H = 22

function RoomBoard({ tabs }: { tabs: React.ReactNode }) {
  const isMobile = useMobile()
  const email = useAuthStore(s => s.email)
  const { orgId, rooms, admins, watchDates, release, error } = useOrgStore(useShallow(s => ({
    orgId: s.orgId, rooms: s.rooms, admins: s.admins,
    watchDates: s.watchDates, release: s.release, error: s.error,
  })))
  const [date, setDate] = useState(() => fmtYMD(new Date()))
  const [picked, setPicked] = useState<Booking | null>(null)
  // 없는 날짜에 매번 새 빈 배열을 돌려주면 무한 렌더입니다 — NO_BOOKINGS 참고.
  const bookings = useOrgStore(s => s.bookings[date] ?? NO_BOOKINGS)

  // 보고 있는 하루만 듣습니다. 이 화면을 떠나면 놓습니다.
  useEffect(() => {
    if (!orgId) return
    watchDates('resboard', [date])
    return () => watchDates('resboard', [])
  }, [orgId, date, watchDates])

  const today = fmtYMD(new Date())
  const win = useMemo(() => {
    let from = ROOM_OPEN, to = ROOM_CLOSE
    for (const b of bookings) { from = Math.min(from, b.from); to = Math.max(to, b.to) }
    return { from: Math.floor(from / 60) * 60, to: Math.ceil(to / 60) * 60 }
  }, [bookings])
  const hours = useMemo(
    () => Array.from({ length: (win.to - win.from) / 60 + 1 }, (_, i) => win.from + i * 60),
    [win],
  )
  const at = (m: number) => ((m - win.from) / (win.to - win.from)) * 100

  const step = (n: number) => setDate(fmtYMD(addDays(new Date(date.replace(/-/g, '/')), n)))

  if (!orgId) return <BlankPage tabs={tabs}>워크스페이스에 들어가면 회의실을 함께 씁니다. 설정 → 개요에서 만들 수 있습니다.</BlankPage>

  const isAdmin = !!email && admins.includes(email.toLowerCase())
  const wd = new Date(date.replace(/-/g, '/')).getDay()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: isMobile ? '8px 12px' : '10px 18px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
      }}>
        {tabs}
        <div style={{ width: 1, height: 16, background: 'var(--bd)', margin: '0 2px' }} />
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Step label="어제" onClick={() => step(-1)}>‹</Step>
          <button onClick={() => setDate(today)} style={{ ...BTN, padding: '3px 10px' }}>오늘</button>
          <Step label="내일" onClick={() => step(1)}>›</Step>
        </div>
        <div style={{
          fontSize: 13, fontWeight: 500,
          color: date === today ? 'var(--ac)' : wd === 0 ? 'var(--danger)' : 'var(--t1)',
        }}>
          {Number(date.slice(5, 7))}월 {Number(date.slice(8))}일 ({WEEK[wd]})
        </div>

        <div style={{ flex: 1 }} />
        {/* 여기서는 못 잡습니다. 예약은 일정에 붙어 있어서(eventId), 일정
            없이 잡으면 아무도 치울 수 없는 예약이 남습니다. 그래서 어디서
            잡는지 적어 둡니다 — 못 하는 것을 말없이 안 되게 두지 않습니다. */}
        <div style={{ fontSize: 11, color: 'var(--t3)' }}>예약은 캘린더에서 일정을 만들 때 함께 잡습니다.</div>
      </div>

      {error && <div style={{ padding: '7px 18px', fontSize: 12, color: 'var(--danger)', flexShrink: 0 }}>{error}</div>}

      {rooms.length === 0 ? (
        <Blank>
          아직 등록된 회의실이 없습니다.
          {isAdmin ? ' 설정 → 회의실에서 더할 수 있습니다.' : ' 관리자가 목록을 만들면 여기 섭니다.'}
        </Blank>
      ) : (
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {/* 시각 눈금. 굴려도 붙어 있어야 어느 칸인지 압니다. */}
        <div style={{
          display: 'flex', position: 'sticky', top: 0, zIndex: 2,
          background: 'var(--bg)', borderBottom: '1px solid var(--bd)',
        }}>
          <div style={{ width: NAME_W, flexShrink: 0 }} />
          <div style={{ flex: 1, position: 'relative', height: 22 }}>
            {hours.map(h => (
              <div key={h} style={{
                position: 'absolute', left: `${at(h)}%`, top: 4,
                fontSize: 10.5, color: 'var(--t3)', transform: 'translateX(-50%)',
                fontVariantNumeric: 'tabular-nums',
              }}>{h / 60}</div>
            ))}
          </div>
          <div style={{ width: 10, flexShrink: 0 }} />
        </div>

        {rooms.map(room => {
          const mine = bookings.filter(b => b.roomId === room.id)
          const placed = assignLanes(mine)
          const lanes = placed[0]?.lanes ?? 1
          const h = Math.max(34, lanes * LANE_H + 10)
          return (
            <div key={room.id} style={{
              display: 'flex', borderBottom: '1px solid var(--bd2)',
              opacity: room.active === false ? .45 : 1,
            }}>
              <div style={{
                width: NAME_W, flexShrink: 0, padding: '0 10px', height: h,
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
                borderRight: '1px solid var(--bd)',
              }}>
                <div style={{ fontSize: 12, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {room.name}
                </div>
                {room.note && (
                  <div style={{ fontSize: 10, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {room.note}
                  </div>
                )}
              </div>

              <div style={{ flex: 1, position: 'relative', height: h, minWidth: 0 }}>
                {hours.map(h2 => (
                  <div key={h2} style={{
                    position: 'absolute', left: `${at(h2)}%`, top: 0, bottom: 0,
                    width: 1, background: 'var(--bd2)',
                  }} />
                ))}
                {placed.map(({ item: b, lane }) => (
                  <button
                    key={b.id}
                    onClick={() => setPicked(b)}
                    title={`${hhmm(b.from)}–${hhmm(b.to)} · ${b.title || '(제목 없음)'} · ${b.byName || b.by}`}
                    style={{
                      position: 'absolute',
                      left: `${at(b.from)}%`, width: `calc(${at(b.to) - at(b.from)}% - 2px)`,
                      top: 5 + lane * LANE_H, height: LANE_H - 3,
                      borderRadius: 'var(--r1)', border: '1px solid hsl(212 60% 62%)',
                      background: 'hsl(212 72% 93%)', color: 'hsl(212 60% 26%)',
                      fontSize: 10.5, fontFamily: 'var(--font)', cursor: 'pointer',
                      padding: '0 5px', textAlign: 'left', overflow: 'hidden',
                      whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                    }}
                  >
                    {hhmm(b.from)} {b.title || (b.byName || b.by.split('@')[0])}
                  </button>
                ))}
              </div>
              <div style={{ width: 10, flexShrink: 0 }} />
            </div>
          )
        })}
      </div>
      )}

      {picked && (
        <Sheet onClose={() => setPicked(null)} title={picked.roomName || rooms.find(r => r.id === picked.roomId)?.name || '회의실'}>
          <Field label="언제">{Number(date.slice(5, 7))}월 {Number(date.slice(8))}일 {hhmm(picked.from)}–{hhmm(picked.to)}</Field>
          <Field label="무슨 회의">{picked.title || '제목이 없습니다'}</Field>
          <Field label="잡은 사람">{picked.byName || picked.by}</Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 14 }}>
            {(!!email && (picked.by === email.toLowerCase() || isAdmin)) && (
              <button
                onClick={async () => {
                  const ok = await askConfirm({
                    message: '이 회의실 예약을 풉니다',
                    detail: `${hhmm(picked.from)}–${hhmm(picked.to)} · ${picked.title || '제목 없음'}. 일정 자체는 그대로 남습니다.`,
                    confirmLabel: '풀기',
                  })
                  if (!ok) return
                  await release(date, picked.id)
                  setPicked(null)
                }}
                style={{ ...BTN, color: 'var(--danger)' }}
              >예약 풀기</button>
            )}
            <button onClick={() => setPicked(null)} style={BTN}>닫기</button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

function GearBoard({ tabs }: { tabs: React.ReactNode }) {
  const isMobile = useMobile()
  const email = useAuthStore(s => s.email)
  const orgId = useOrgStore(s => s.orgId)
  const admins = useOrgStore(s => s.admins)
  const { ready, gear, teams, teamOf, bookings, error, clearError, release, releaseGroup } = useGearStore(useShallow(s => ({
    ready: s.ready, gear: s.gear, teams: s.teams, teamOf: s.teamOf, bookings: s.bookings,
    error: s.error, clearError: s.clearError, release: s.release, releaseGroup: s.releaseGroup,
  })))
  const [anchor, setAnchor] = useState(() => fmtYMD(new Date()))
  const [picked, setPicked] = useState<GearBooking | null>(null)
  const [adding, setAdding] = useState<{ gearId: string; date: string } | null>(null)
  const [teamFilter, setTeamFilter] = useState<string>('')

  const today = fmtYMD(new Date())
  const days = useMemo(
    () => Array.from({ length: SPAN }, (_, i) => fmtYMD(addDays(new Date(anchor.replace(/-/g, '/')), i))),
    [anchor],
  )
  const first = dayNo(days[0])

  const shown = useMemo(
    () => (teamFilter ? bookings.filter(b => b.team === teamFilter) : bookings),
    [bookings, teamFilter],
  )
  const live = useMemo(() => gear.filter(g => g.active !== false), [gear])
  const rows = useMemo(() => groupGear(gear), [gear])

  if (!orgId) {
    return <BlankPage tabs={tabs}>워크스페이스에 들어가면 장비를 함께 씁니다. 설정 → 개요에서 만들 수 있습니다.</BlankPage>
  }
  if (!ready) return <BlankPage tabs={tabs}>불러오는 중…</BlankPage>
  const isAdmin = !!email && admins.includes(email.toLowerCase())
  if (gear.length === 0) {
    return (
      <BlankPage tabs={tabs}>
        아직 등록된 장비가 없습니다.
        {isAdmin ? ' 설정 → 장비에서 더할 수 있습니다.' : ' 관리자가 목록을 만들면 여기 섭니다.'}
      </BlankPage>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* ── 머리 ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: isMobile ? '10px 12px' : '12px 18px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
      }}>
        {/* 제목은 위 툴바가 답니다 — 캘린더 화면과 같습니다. 한 화면에 같은
            이름이 두 번 서면 둘 중 하나는 소음입니다. */}
        {tabs}
        <div style={{ width: 1, height: 16, background: 'var(--bd)', margin: '0 2px' }} />
        <div style={{ display: 'flex', gap: 2 }}>
          <Step label="이전 주" onClick={() => setAnchor(fmtYMD(addDays(new Date(anchor.replace(/-/g, '/')), -7)))}>‹</Step>
          <button
            onClick={() => setAnchor(today)}
            style={{ ...BTN, padding: '3px 10px' }}
          >오늘</button>
          <Step label="다음 주" onClick={() => setAnchor(fmtYMD(addDays(new Date(anchor.replace(/-/g, '/')), 7)))}>›</Step>
        </div>

        <div style={{ flex: 1 }} />

        {teams.length > 0 && (
          <select
            value={teamFilter}
            onChange={e => setTeamFilter(e.target.value)}
            style={{ ...BTN, padding: '4px 8px' }}
          >
            <option value="">모든 팀</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <button
          onClick={() => setAdding({ gearId: live[0]?.id ?? gear[0].id, date: today })}
          style={{ ...BTN, background: 'var(--ac)', color: '#fff', borderColor: 'transparent', padding: '4px 12px' }}
        >예약하기</button>
      </div>

      {error && (
        <div
          onClick={clearError}
          style={{ padding: '7px 18px', fontSize: 12, color: 'var(--danger)', cursor: 'pointer', flexShrink: 0 }}
        >{error} · 눌러서 닫기</div>
      )}

      {/* ── 격자 ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div style={{ minWidth: NAME_W + SPAN * COL, position: 'relative' }}>
          {/* 날짜 머리. 스크롤해도 붙어 있어야 어느 칸인지 압니다. */}
          <div style={{
            display: 'flex', position: 'sticky', top: 0, zIndex: 2,
            background: 'var(--bg)', borderBottom: '1px solid var(--bd)',
          }}>
            {/* 이 빈 칸도 왼쪽에 붙어 있어야 합니다. 안 붙이면 옆으로
                굴렸을 때 날짜 숫자가 장비 이름 열 위로 올라탑니다 —
                머리줄이 이름 열보다 위층(z)이라서요. */}
            <div style={{ width: NAME_W, flexShrink: 0, position: 'sticky', left: 0, background: 'var(--bg)', zIndex: 1 }} />
            {days.map(d => {
              const wd = new Date(d.replace(/-/g, '/')).getDay()
              return (
                <div key={d} style={{
                  width: COL, flexShrink: 0, textAlign: 'center', padding: '6px 0 5px',
                  fontSize: 10.5, lineHeight: 1.35,
                  color: d === today ? 'var(--ac)' : wd === 0 ? 'var(--danger)' : 'var(--t3)',
                  fontWeight: d === today ? 600 : 400,
                }}>
                  <div>{WEEK[wd]}</div>
                  <div style={{ fontSize: 12 }}>{Number(d.slice(8))}</div>
                </div>
              )
            })}
          </div>

          {/* 종류로 묶어 세웁니다. 카메라 넷·렌즈 여섯·조명 여덟이 한 줄로
              늘어서면 격자가 아니라 벽입니다. 빌리러 온 사람은 늘 종류를
              먼저 정하고("조명 뭐 있지") 그 안에서 고릅니다. */}
          {rows.map(group => (
          <div key={group.kind}>
          {rows.length > 1 && (
            <div style={{
              display: 'flex', height: KIND_H, alignItems: 'center',
              background: 'var(--bg2)', borderBottom: '1px solid var(--bd2)',
            }}>
              <div style={{
                width: NAME_W, flexShrink: 0, padding: '0 10px',
                position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1,
                fontSize: 10.5, fontWeight: 600, color: 'var(--t2)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{group.kind}</div>
              {/* 빈 칸이지만 자리를 잡습니다. 없으면 이 줄만 격자보다 짧아서,
                  옆으로 굴렸을 때 종류 띠가 중간에 끊깁니다. */}
              <div style={{ width: SPAN * COL, flexShrink: 0 }} />
            </div>
          )}
          {group.items.map(item => {
            const mine = shown.filter(b => b.gearId === item.id)
            return (
              <div key={item.id} style={{
                display: 'flex', borderBottom: '1px solid var(--bd2)',
                opacity: item.active === false ? .45 : 1,
              }}>
                <div style={{
                  width: NAME_W, flexShrink: 0, padding: '0 10px',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center',
                  height: ROW_H, borderRight: '1px solid var(--bd)',
                  position: 'sticky', left: 0, background: 'var(--bg)', zIndex: 1,
                }}>
                  <div style={{ fontSize: 12, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name}
                  </div>
                  {item.note && (
                    <div style={{ fontSize: 10, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.note}
                    </div>
                  )}
                </div>

                <div style={{ position: 'relative', height: ROW_H, width: SPAN * COL, flexShrink: 0 }}>
                  {/* 빈 칸도 눌립니다 — 비어 있는 것을 봤을 때 하고 싶은 일은
                      그 자리에 잡는 것입니다. */}
                  {days.map((d, i) => (
                    <button
                      key={d}
                      onClick={() => setAdding({ gearId: item.id, date: d })}
                      title={`${item.name} · ${d}`}
                      disabled={item.active === false}
                      style={{
                        position: 'absolute', left: i * COL, top: 0, width: COL, height: ROW_H,
                        border: 'none', borderRight: '1px solid var(--bd2)',
                        background: d === today ? 'var(--bg2)' : 'transparent',
                        cursor: item.active === false ? 'default' : 'pointer', padding: 0,
                      }}
                    />
                  ))}
                  {mine.map(b => {
                    const from = Math.max(dayNo(b.from) - first, 0)
                    const to = Math.min(dayNo(b.to) - first, SPAN - 1)
                    if (to < 0 || from > SPAN - 1) return null
                    const hue = teamHue(b.team)
                    const who = b.byName || b.by.split('@')[0]
                    /*
                      **한 칸짜리에는 팀 이름을 안 적습니다.** 46px에 '브랜드팀 ·
                      수민'을 넣으면 '브…'가 됩니다 — 다 지운 것과 같습니다.
                      팀은 이미 색이 말하고 있고, 한 칸에 넣을 수 있는 한 가지는
                      사람 이름입니다. 나머지는 눌러서 봅니다.
                    */
                    const wide = to - from >= 1
                    // 창 밖에서 시작했거나 밖에서 끝나면 그쪽 모서리를 각지게
                    // 둡니다. 잘린 것과 거기서 끝난 것은 다릅니다.
                    const openL = dayNo(b.from) - first < 0
                    const openR = dayNo(b.to) - first > SPAN - 1
                    return (
                      <button
                        key={b.id}
                        onClick={() => setPicked(b)}
                        title={`${b.teamName ? b.teamName + ' · ' : ''}${who} · ${b.reason}`}
                        style={{
                          position: 'absolute', left: from * COL + (openL ? 0 : 2), top: 4,
                          width: (to - from + 1) * COL - (openL ? 0 : 2) - (openR ? 0 : 2),
                          height: ROW_H - 8,
                          borderRadius: `${openL ? 0 : 4}px ${openR ? 0 : 4}px ${openR ? 0 : 4}px ${openL ? 0 : 4}px`,
                          border: `1px solid hsl(${hue} 60% 62%)`,
                          background: `hsl(${hue} 72% 92%)`, color: `hsl(${hue} 60% 26%)`,
                          fontSize: 10.5, fontFamily: 'var(--font)', cursor: 'pointer',
                          padding: '0 5px', textAlign: 'left', overflow: 'hidden',
                          whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                        }}
                      >
                        {wide && b.teamName ? `${b.teamName} · ` : ''}
                        {who}{!b.long && wide && ` ${hhmm(b.fromMin)}`}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          </div>
          ))}
        </div>
      </div>

      {picked && (() => {
        // 같이 잡은 것들. group이 없는 옛 예약은 자기 자신뿐입니다 —
        // **안 붙은 것을 없는 것으로 읽지 않습니다.**
        const siblings = picked.group ? bookings.filter(b => b.group === picked.group) : [picked]
        return (
          <BookingCard
            booking={picked}
            siblings={siblings}
            canRelease={!!email && (picked.by === email.toLowerCase() || isAdmin)}
            onClose={() => setPicked(null)}
            onRelease={async () => {
              const ok = await askConfirm({
                message: siblings.length > 1
                  ? `장비 ${siblings.length}개의 예약을 함께 풉니다`
                  : `'${picked.gearName || '장비'}' 예약을 풉니다`,
                detail: `${gearWhen(picked)} · ${picked.reason}`,
                confirmLabel: '풀기',
              })
              if (!ok) return
              const done = picked.group ? await releaseGroup(picked.group) : await release(picked.id)
              if (done) setPicked(null)
            }}
          />
        )
      })()}

      {adding && (
        <BookForm
          gearId={adding.gearId}
          date={adding.date}
          onClose={() => setAdding(null)}
          myTeam={teamOfEmail(teamOf, teams, email)?.id ?? ''}
        />
      )}
    </div>
  )
}

function Blank({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 40, fontSize: 12.5, color: 'var(--t3)', textAlign: 'center', lineHeight: 1.7,
    }}>{children}</div>
  )
}

/**
 * 아무것도 없는 화면에도 탭은 섭니다.
 *
 * 회의실이 아직 없다고 장비 탭까지 사라지면, 둘 중 하나가 비어 있는 동안
 * 다른 하나로 갈 길이 없습니다 — 처음 켠 워크스페이스가 정확히 그 상태입니다.
 */
function BlankPage({ tabs, children }: { tabs: React.ReactNode; children: React.ReactNode }) {
  const isMobile = useMobile()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: isMobile ? '8px 12px' : '10px 18px',
        borderBottom: '1px solid var(--bd)', flexShrink: 0,
      }}>{tabs}</div>
      <Blank>{children}</Blank>
    </div>
  )
}

function Step({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} onClick={onClick} style={{ ...BTN, width: 26, padding: 0 }}>{children}</button>
  )
}

/**
 * 막대를 누르면 뜨는 한 장.
 *
 * **예약 한 건을 통째로** 보여 줍니다. 저장은 장비마다 한 줄이지만 사람이
 * 한 번에 정한 것은 '그 촬영' 하나고, 카메라 줄을 눌렀는데 카메라 얘기만
 * 나오면 같이 나간 조명 셋은 어디서 확인하는지 알 수 없습니다.
 */
function BookingCard({ booking, siblings, canRelease, onClose, onRelease }: {
  booking: GearBooking
  siblings: GearBooking[]
  canRelease: boolean
  onClose: () => void
  onRelease: () => void
}) {
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const gear = useGearStore(s => s.gear)
  const kindOf = (b: GearBooking) => gear.find(g => g.id === b.gearId)?.kind

  return (
    <Sheet onClose={onClose} title={booking.long ? '장기 대여' : '장비 예약'}>
      <Field label="언제">{gearWhen(booking)}</Field>
      <Field label={`장비 ${siblings.length}개`}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
          {siblings.map(b => (
            <GearChip key={b.id} kind={kindOf(b)} name={b.gearName || '장비'} on={b.id === booking.id} />
          ))}
        </div>
      </Field>
      <Field label="누가">
        {getNameByEmail(booking.by) || booking.byName || booking.by}
        {booking.teamName && <span style={{ color: 'var(--t3)' }}> · {booking.teamName}</span>}
      </Field>
      <Field label="사용 내용">{booking.reason}</Field>
      {booking.extra && <Field label="기타 예약">{booking.extra}</Field>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 14 }}>
        {canRelease && (
          <button onClick={onRelease} style={{ ...BTN, color: 'var(--danger)' }}>
            예약 풀기{siblings.length > 1 ? ` (${siblings.length}개)` : ''}
          </button>
        )}
        <button onClick={onClose} style={BTN}>닫기</button>
      </div>
    </Sheet>
  )
}

/** 장비 한 개. 종류가 앞에 붙습니다 — 'FX3'보다 '카메라 · FX3'가 빠릅니다. */
function GearChip({ kind, name, on, onRemove }: {
  kind?: string
  name: string
  on?: boolean
  onRemove?: () => void
}) {
  return (
    <span
      className={onRemove ? 'bpp-row' : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '2px 7px', borderRadius: 'var(--r1)', fontSize: 11,
        border: `1px solid ${on ? 'var(--ac)' : 'var(--bd)'}`,
        background: on ? 'var(--bg3)' : 'var(--bg2)',
        color: 'var(--t1)', maxWidth: '100%',
      }}
    >
      {kind && <span style={{ color: 'var(--t3)' }}>{kind} ·</span>}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      {onRemove && (
        <button
          className="bpp-rowx"
          aria-label={`${name} 빼기`}
          onClick={onRemove}
          style={{
            width: 14, height: 14, flexShrink: 0, marginLeft: 1, padding: 0,
            border: 'none',
            cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 12, lineHeight: 1,
          }}
        >×</button>
      )}
    </span>
  )
}

/**
 * ── 예약 ─────────────────────────────────────────────────────────────────────
 *
 * **장비를 담습니다.** 촬영을 나가면 카메라 하나, 렌즈 둘, 조명 셋, 삼각대가
 * 같은 날 같은 이유로 같이 나갑니다. 한 개씩 잡게 하면 같은 폼을 일곱 번
 * 채우게 되고, 여섯 번째쯤에서 사유가 달라집니다.
 *
 * 고르는 것은 **종류 → 장비** 두 걸음입니다. 스무 개가 한 목록에 있으면
 * 조명을 찾는 데 스무 줄을 읽어야 하는데, 사람은 이미 '조명 뭐 있지'로
 * 시작합니다.
 *
 * 시간 예약과 장기 대여를 한 폼에 둡니다 — 고르는 것이 같은 장비, 같은
 * 내용이고 다른 것은 '언제'뿐입니다.
 */
function BookForm({ gearId, date, myTeam, onClose }: {
  gearId: string
  date: string
  myTeam: string
  onClose: () => void
}) {
  const email = useAuthStore(s => s.email)
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const myName = email ? getNameByEmail(email) : ''
  const { gear, teams, bookings, book } = useGearStore(useShallow(s => ({
    gear: s.gear, teams: s.teams, bookings: s.bookings, book: s.book,
  })))

  const live = useMemo(() => gear.filter(g => g.active !== false), [gear])
  const groups = useMemo(() => groupGear(live), [live])

  const [cart, setCart] = useState<string[]>(gearId ? [gearId] : [])
  const [kind, setKind] = useState(() => groups.find(g => g.items.some(i => i.id === gearId))?.kind ?? groups[0]?.kind ?? '')
  const [long, setLong] = useState(false)
  const [from, setFrom] = useState(date)
  const [to, setTo] = useState(date)
  const [startMin, setStartMin] = useState(600)
  /** 시작으로부터 몇 분. 1440을 넘으면 다음 날로 넘어간 것입니다. */
  const [minutes, setMinutes] = useState(120)
  const [team, setTeam] = useState(myTeam)
  const [reason, setReason] = useState('')
  const [extra, setExtra] = useState('')
  const [busy, setBusy] = useState(false)

  // 반납일이 대여일보다 빠른 상태를 **만들 수 없게** 합니다. 고른 뒤에
  // 빨간 글씨로 알려 주는 것보다, 애초에 그 상태가 없는 편이 낫습니다.
  useEffect(() => { if (to < from) setTo(from) }, [from, to])

  /*
    시각 예약이 자정을 넘을 수 있습니다 — 야간 촬영은 16시에 나가 새벽 1시에
    돌아옵니다. 끝 시각이 하루를 넘으면 반납일이 다음 날이 됩니다.
  */
  const endAbs = startMin + minutes
  const range: GearRange = long
    ? { from, to, fromMin: 0, toMin: DAY, long: true }
    : endAbs > DAY
      ? { from, to: dayYMD(dayNo(from) + 1), fromMin: startMin, toMin: endAbs - DAY }
      : { from, to: from, fromMin: startMin, toMin: endAbs }

  const bad = gearRangeError(range)
  const held = bad ? null : cart
    .map(id => ({ id, clash: gearClash(bookings, id, range) }))
    .find(c => c.clash)
  const stop = bad
    ?? (!cart.length ? '장비를 담아 주세요.' : null)
    ?? (held?.clash
      ? `'${gear.find(g => g.id === held.id)?.name ?? '장비'}'은(는) 이미 ${held.clash.teamName ? held.clash.teamName + ' ' : ''}${held.clash.byName || held.clash.by} 님이 잡아 두었습니다 — ${gearWhen(held.clash)}`
      : null)

  const save = async () => {
    if (!email || busy || stop || !reason.trim()) return
    setBusy(true)
    const ok = await book({
      gearIds: cart, ...range,
      by: email, ...(myName ? { byName: myName } : {}),
      ...(team ? { team } : {}),
      reason, ...(extra.trim() ? { extra } : {}),
    })
    setBusy(false)
    if (ok) onClose()
  }

  const inKind = groups.find(g => g.kind === kind)?.items ?? []

  return (
    <Sheet onClose={onClose} title="장비 예약하기">
      <Row label="소속">
        <select value={team} onChange={e => setTeam(e.target.value)} style={FIELD}>
          <option value="">소속 없음</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Row>

      <Row label="예약 장비">
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={kind} onChange={e => setKind(e.target.value)} style={{ ...FIELD, flex: 1 }}>
            {groups.map(g => <option key={g.kind} value={g.kind}>{g.kind}</option>)}
          </select>
          {/*
            고르는 즉시 담깁니다. '고르기 → 담기'로 두 번 누르게 했더니
            고르고 안 담은 상태가 생기고, 그 상태의 화면은 담긴 것처럼
            보입니다. 값은 늘 비워 두어서 같은 장비를 다시 못 고르는 일이
            없게 합니다.
          */}
          <select
            value=""
            onChange={e => {
              if (e.target.value) setCart(c => c.includes(e.target.value) ? c : [...c, e.target.value])
            }}
            style={{ ...FIELD, flex: 1 }}
          >
            <option value="">장비 선택</option>
            {inKind.map(g => (
              <option key={g.id} value={g.id} disabled={cart.includes(g.id)}>
                {g.name}{g.note ? ` (${g.note})` : ''}{cart.includes(g.id) ? ' · 담김' : ''}
              </option>
            ))}
          </select>
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 4 }}>
          장비를 고르면 바로 아래 목록에 담깁니다.
        </div>
      </Row>

      <div style={{
        background: 'var(--bg2)', borderRadius: 'var(--r2)', padding: '8px 10px',
        margin: '2px 0 10px',
      }}>
        <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 6 }}>담은 장비 {cart.length}개</div>
        {cart.length === 0 ? (
          <div style={{ fontSize: 11.5, color: 'var(--t3)' }}>아직 담긴 장비가 없습니다</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {cart.map(id => {
              const item = gear.find(g => g.id === id)
              return (
                <GearChip
                  key={id}
                  kind={item?.kind}
                  name={item?.name ?? '(없는 장비)'}
                  onRemove={() => setCart(c => c.filter(x => x !== id))}
                />
              )
            })}
          </div>
        )}
      </div>

      <Row label="사용 내용">
        <input
          value={reason}
          onChange={e => setReason(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) void save() }}
          placeholder="사용 내용을 입력하세요"
          style={FIELD}
        />
      </Row>

      <Row label="기타 예약">
        <input
          value={extra}
          onChange={e => setExtra(e.target.value)}
          placeholder="예) 배터리, 악세서리 등 외부 반출의 경우 작성"
          style={FIELD}
        />
      </Row>

      {/* 장기 대여는 촬영 프로젝트에 따라 며칠씩 빌려 가는 것입니다. 시각을
          안 묻습니다 — 물어도 아무도 그 시각에 안 맞춥니다. */}
      <label style={{
        display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0 8px',
        fontSize: 12, color: 'var(--t1)', cursor: 'pointer',
      }}>
        <input type="checkbox" checked={long} onChange={e => setLong(e.target.checked)} />
        장기 대여
      </label>

      {long ? (
        <>
          <Row label="대여일">
            <DateField value={from} format="full" onChange={setFrom} style={FIELD} />
          </Row>
          <Row label="반납일">
            {/* 대여일보다 앞선 날은 위 useEffect가 그 자리에서 당겨 옵니다 —
                말이 안 되는 상태를 만들어 두고 빨간 글씨로 알리는 것보다,
                그 상태가 없는 편이 낫습니다. */}
            <DateField value={to} format="full" onChange={setTo} style={FIELD} />
          </Row>
        </>
      ) : (
        <>
          <Row label="날짜">
            <DateField value={from} format="full" onChange={v => { setFrom(v); setTo(v) }} style={FIELD} />
          </Row>
          <Row label="시간">
            <NightRange
              startMin={startMin}
              minutes={minutes}
              onChange={(st, mi) => { setStartMin(st); setMinutes(mi) }}
            />
          </Row>
        </>
      )}

      {stop && <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 8, lineHeight: 1.6 }}>{stop}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 14 }}>
        <button onClick={onClose} style={BTN}>취소</button>
        <button
          onClick={() => void save()}
          disabled={busy || !!stop || !reason.trim()}
          style={{
            ...BTN, background: 'var(--ac)', color: '#fff', borderColor: 'transparent',
            opacity: busy || stop || !reason.trim() ? .5 : 1,
          }}
        >장비 예약 신청</button>
      </div>
    </Sheet>
  )
}

/**
 * 시작 → 끝. 회의실의 것과 같은 목록인데 **자정을 넘깁니다.**
 *
 * 야간 촬영은 16시에 나가 새벽 1시에 돌아옵니다. 끝 목록이 24:00에서 끊기면
 * 그 예약을 아예 못 적고, 사람은 '장기 대여'로 이틀을 통째로 잡아 버립니다 —
 * 그러면 다음 날 낮에 아무도 그 카메라를 못 씁니다.
 */
function NightRange({ startMin, minutes, onChange }: {
  startMin: number
  minutes: number
  onChange: (startMin: number, minutes: number) => void
}) {
  const starts = useMemo(() => {
    const out: { at: number; label: string }[] = []
    for (let m = 0; m < DAY; m += 15) out.push({ at: m, label: hhmm(m) })
    return out
  }, [])
  const ends = useMemo(() => {
    const out: { at: number; label: string; sub?: string }[] = []
    // 최대 24시간. 그보다 길면 장기 대여로 잡는 것이 맞습니다.
    for (let m = startMin + 15; m <= startMin + DAY; m += 15) {
      out.push(m > DAY
        ? { at: m, label: hhmm(m - DAY), sub: '익일' }
        : { at: m, label: m === DAY ? '24:00' : hhmm(m) })
    }
    return out
  }, [startMin])

  const end = startMin + minutes
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <TimeMenu
        value={startMin}
        options={starts}
        onPick={at => onChange(at, Math.max(15, Math.min(end - at, DAY)))}
      />
      <span style={{ color: 'var(--t3)', fontSize: 12 }}>→</span>
      <TimeMenu value={end} options={ends} onPick={at => onChange(startMin, at - startMin)} />
      <span style={{ fontSize: 11, color: 'var(--t3)', whiteSpace: 'nowrap' }}>
        {minutes % 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` : `${minutes / 60}시간`}
      </span>
    </div>
  )
}

/**
 * 카드 한 장.
 *
 * **층(z-index)이 낮습니다.** 안에서 날짜와 시각을 고르는데, 그 둘은
 * 포털로 화면 맨 위(9100·9201)에 뜹니다 — 카드를 그 위에 두면 고르는 목록이
 * 카드 뒤로 숨습니다. 업무 카드도 같은 이유로 100입니다.
 */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(15,15,15,.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r3)',
          boxShadow: 'var(--sh-lg)', width: '100%', maxWidth: 380, maxHeight: '86vh',
          overflowY: 'auto', padding: '16px 18px 18px', boxSizing: 'border-box',
        }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--t1)', marginBottom: 12 }}>{title}</div>
        {children}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <div style={{ width: 62, flexShrink: 0, fontSize: 11.5, color: 'var(--t3)' }}>{label}</div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12.5, color: 'var(--t1)', lineHeight: 1.6, wordBreak: 'break-word' }}>{children}</div>
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...BTN, padding: '3px 10px',
        background: on ? 'var(--ac)' : 'var(--bg)',
        color: on ? '#fff' : 'var(--t2)',
        borderColor: on ? 'transparent' : 'var(--bd)',
      }}
    >{children}</button>
  )
}

const BTN: React.CSSProperties = {
  padding: '4px 9px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
  background: 'var(--bg)', color: 'var(--t2)', fontSize: 11.5, cursor: 'pointer',
  fontFamily: 'var(--font)', lineHeight: 1.6,
}

const FIELD: React.CSSProperties = {
  width: '100%', padding: '5px 8px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
  background: 'var(--bg)', color: 'var(--t1)', fontSize: 12, fontFamily: 'var(--font)',
  boxSizing: 'border-box',
}
