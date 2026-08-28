import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from '../../../store/authStore'
import { NO_BOOKINGS, useOrgStore, type Booking } from '../../../store/orgStore'
import { useGearStore, teamOfEmail } from '../../../store/gearStore'
import { useUserProfileStore } from '../../../store/userProfileStore'
import { addDays, fmtYMD, isComposing } from '../../../lib/utils'
import {
  DAY, busyCount, dayNo, dayYMD, gearClash, gearRangeError, gearWhen, groupGear, hhmm,
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

/**
 * ── 폰에서는 숫자가 달라집니다 ──────────────────────────────────────────────
 *
 * 이름 열이 176px이면 375px 화면의 **절반**입니다. 남는 절반에 격자를 그리면
 * 그건 격자가 아니라 목록이고, 이 화면이 격자인 이유가 사라집니다. 이름을
 * 좁히고, 격자는 옆으로 굴려서 봅니다 — 굴리는 동안 이름 열은 왼쪽에 붙어
 * 있어야 지금 보는 줄이 무엇인지 압니다.
 *
 * 줄 높이도 손가락에 맞춥니다. 빈 칸을 눌러서 예약하는 화면인데 30px는
 * 마우스 포인터의 크기지 손가락의 크기가 아닙니다.
 */
function metrics(isMobile: boolean) {
  return {
    col: 46,
    rowH: isMobile ? 36 : 30,
    nameW: isMobile ? 116 : 176,
    /** 종류 줄. 접혀 있을 때는 이게 곧 그 묶음의 요약입니다. */
    kindH: isMobile ? 32 : 26,
    /**
     * 회의실 띠에서 한 시간의 너비. **폰에서만 씁니다.**
     *
     * 넓은 화면에서는 하루가 창에 다 들어가서 띠를 늘려 두면 되는데, 폰에서
     * 같은 짓을 하면 열두 시간이 200px에 눌립니다 — 한 시간짜리 회의가
     * 16px짜리 조각이 되고, 그 안에 글자가 들어갈 자리는 없습니다.
     * 폰에서는 시간마다 폭을 못 박고 옆으로 굴립니다.
     */
    hourW: 52,
    /** 손이 닿아야 하는 단추. 26px는 마우스 크기입니다. */
    tap: isMobile ? 32 : 26,
  }
}

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
  const M = metrics(isMobile)
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

  /**
   * 폰에서는 띠에 폭을 못 박고 옆으로 굴립니다(metrics.hourW 참고). 안쪽의
   * 자리 계산은 그대로 퍼센트입니다 — 폭이 정해진 상자 안의 퍼센트라 값이
   * 그대로 맞습니다.
   */
  const beltW = isMobile ? ((win.to - win.from) / 60) * M.hourW : undefined
  const belt = { flex: isMobile ? undefined : 1, width: beltW, flexShrink: 0 }
  /** 굴리는 동안 이름은 왼쪽에 붙어 있어야 어느 방인지 압니다. */
  const stick: React.CSSProperties = isMobile
    ? { position: 'sticky', left: 0, zIndex: 1 }
    : {}

  const step = (n: number) => setDate(fmtYMD(addDays(new Date(date.replace(/-/g, '/')), n)))

  /**
   * ── 폰에서는 '지금'이 보이는 자리에서 시작합니다 ──────────────────────────
   *
   * 띠가 창보다 넓어졌으니 어딘가에서 시작해야 하는데, 왼쪽 끝(오전 8시)은
   * 오후에 이 화면을 여는 사람에게 아무 말도 안 합니다. 굴려야 뭐가 있는지
   * 알게 되고, 그 전까지는 '오늘은 아무것도 없네'로 읽힙니다.
   */
  const beltRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)

  /**
   * 이름 열 밑으로 들어간 숫자는 **지웁니다.**
   *
   * 이름 열이 왼쪽에 붙어 있으니 눈금이 그 밑을 지나갑니다. 반쯤 가려진
   * '13'은 '3'으로 읽힙니다 — 안 보이는 것보다 나쁩니다. 틀리게 보이느니
   * 없는 편이 낫습니다.
   *
   * 리렌더로 하지 않습니다. 굴릴 때마다 방 목록을 다시 그리면 그게 곧
   * 끊김입니다 — 글자 몇 개의 투명도만 직접 바꿉니다.
   */
  const syncRuler = (x: number) => {
    const r = rulerRef.current
    if (!r) return
    for (const el of Array.from(r.children) as HTMLElement[]) {
      el.style.opacity = Number(el.dataset.x) - x < 8 ? '0' : '1'
    }
  }

  useEffect(() => {
    const el = beltRef.current
    if (!el || !isMobile) return
    const now = new Date()
    const at2 = date === today ? now.getHours() * 60 + now.getMinutes() : win.from
    // 지금이 왼쪽에서 한 뼘 들어온 자리에 오게. 0으로 두면 지금이 화면
    // 가장자리에 붙어서 방금 끝난 회의가 안 보입니다.
    el.scrollLeft = Math.max(0, ((at2 - win.from) / 60) * M.hourW - M.hourW)
    syncRuler(el.scrollLeft)
  }, [date, today, isMobile, win.from, M.hourW])

  if (!orgId) return <BlankPage tabs={tabs}>워크스페이스에 들어가면 회의실을 함께 씁니다. 설정 → 개요에서 만들 수 있습니다.</BlankPage>

  const isAdmin = !!email && admins.includes(email.toLowerCase())
  const wd = new Date(date.replace(/-/g, '/')).getDay()
  const dateChip = (
    <div style={{
      fontSize: 13, fontWeight: 500,
      color: date === today ? 'var(--ac)' : wd === 0 ? 'var(--danger)' : 'var(--t1)',
    }}>
      {Number(date.slice(5, 7))}월 {Number(date.slice(8))}일 ({WEEK[wd]})
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: isMobile ? '8px 12px' : '10px 18px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
      }}>
        {tabs}
        {/*
          ── 폰에서는 두 줄 ──────────────────────────────────────────────────
          한 줄에 다 세우면 탭·이동·날짜가 375px에서 서로를 밀어냅니다. 줄을
          쪼개는 것은 빈 칸 하나로 합니다(flexBasis 100%) — 같은 JSX를 두 번
          쓰면 한쪽만 고치는 날이 옵니다.
        */}
        {isMobile && <div style={{ flex: 1 }} />}
        {isMobile && dateChip}
        {isMobile && <div style={{ flexBasis: '100%', height: 0 }} />}
        {!isMobile && <div style={{ width: 1, height: 16, background: 'var(--bd)', margin: '0 2px' }} />}
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Step label="어제" onClick={() => step(-1)} size={M.tap}>‹</Step>
          <button onClick={() => setDate(today)} style={{ ...BTN, padding: isMobile ? '5px 12px' : '3px 10px' }}>오늘</button>
          <Step label="내일" onClick={() => step(1)} size={M.tap}>›</Step>
        </div>
        {!isMobile && dateChip}

        <div style={{ flex: 1 }} />
        {/* 여기서는 못 잡습니다. 예약은 일정에 붙어 있어서(eventId), 일정
            없이 잡으면 아무도 치울 수 없는 예약이 남습니다. 그래서 어디서
            잡는지 적어 둡니다 — 못 하는 것을 말없이 안 되게 두지 않습니다. */}
        <div style={{ fontSize: 11, color: 'var(--t3)' }}>
          예약은 캘린더에서 {isMobile ? '함께 잡습니다.' : '일정을 만들 때 함께 잡습니다.'}
        </div>
      </div>

      {error && <div style={{ padding: '7px 18px', fontSize: 12, color: 'var(--danger)', flexShrink: 0 }}>{error}</div>}

      {rooms.length === 0 ? (
        <Blank>
          아직 등록된 회의실이 없습니다.
          {isAdmin ? ' 설정 → 회의실에서 더할 수 있습니다.' : ' 관리자가 목록을 만들면 여기 섭니다.'}
        </Blank>
      ) : (
      <div
        ref={beltRef}
        onScroll={isMobile ? e => syncRuler(e.currentTarget.scrollLeft) : undefined}
        style={{ flex: 1, minHeight: 0, overflow: 'auto' }}
      >
        <div style={{ minWidth: beltW ? M.nameW + beltW + 10 : undefined }}>
        {/* 시각 눈금. 굴려도 붙어 있어야 어느 칸인지 압니다. */}
        <div style={{
          display: 'flex', position: 'sticky', top: 0, zIndex: 3,
          background: 'var(--bg)', borderBottom: '1px solid var(--bd)',
        }}>
          <div style={{ width: M.nameW, flexShrink: 0, ...stick, background: 'var(--bg)' }} />
          <div ref={rulerRef} style={{ ...belt, position: 'relative', height: 22 }}>
            {hours.map((h, i) => (
              <div key={h} data-x={((h - win.from) / 60) * M.hourW} style={{
                position: 'absolute', left: `${at(h)}%`, top: 4,
                fontSize: 10.5, color: 'var(--t3)',
                // 가운데 맞추면 첫 글자의 왼쪽 절반이 이름 열 밑으로 들어가고,
                // 마지막 글자는 오른쪽으로 삐져나갑니다. 양 끝만 안쪽으로.
                transform: i === 0 ? 'none' : i === hours.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
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
                width: M.nameW, flexShrink: 0, padding: '0 10px', height: h,
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
                borderRight: '1px solid var(--bd)',
                ...stick, background: 'var(--bg)',
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

              <div style={{ ...belt, position: 'relative', height: h, minWidth: 0 }}>
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
  const M = metrics(isMobile)
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
  const [q, setQ] = useState('')
  const found = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return gear
    return gear.filter(g =>
      g.name.toLowerCase().includes(needle) ||
      (g.note ?? '').toLowerCase().includes(needle) ||
      (g.kind ?? '').toLowerCase().includes(needle))
  }, [gear, q])
  const rows = useMemo(() => groupGear(found), [found])

  /**
   * ── 접힙니다 ──────────────────────────────────────────────────────────────
   *
   * 장비가 서른 개면 한 대에 한 줄씩 주는 순간 화면이 벽이 됩니다. 게다가
   * 대부분의 칸은 늘 비어 있고, 그 빈 칸들이 화면을 다 차지합니다.
   *
   * 그리고 묻는 것이 대개 그게 아닙니다. 송수신기가 넉 대 있으면 궁금한 건
   * 'UWP_D21 4번기가 비었나'가 아니라 **'송수신기 두 대 빌릴 수 있나'**
   * 입니다. 접힌 줄이 그 답을 바로 줍니다 — 날짜마다 몇 대가 나가 있는지.
   *
   * 한 화면에 들어가는 만큼이면(열 대 이하) 펴 둡니다. 접는 것은 넘칠 때
   * 필요한 것이지, 적은 목록까지 한 번 더 누르게 할 이유가 없습니다.
   */
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [primed, setPrimed] = useState(false)
  useEffect(() => {
    if (primed || gear.length === 0) return
    setPrimed(true)
    if (gear.length <= 10) setOpen(new Set(groupGear(gear).map(g => g.kind)))
  }, [gear, primed])
  // 찾는 동안에는 다 펴 둡니다 — 찾은 것이 접힌 줄 뒤에 숨어 있으면 못 찾은
  // 것과 같습니다.
  const searching = q.trim().length > 0
  const isOpen = (kind: string) => searching || open.has(kind)
  const toggle = (kind: string) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(kind)) next.delete(kind); else next.add(kind)
    return next
  })
  const allOpen = rows.length > 0 && rows.every(g => isOpen(g.kind))

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

  const teamPick = teams.length > 0 ? (
    <select
      value={teamFilter}
      onChange={e => setTeamFilter(e.target.value)}
      style={{ ...BTN, padding: '4px 8px', maxWidth: isMobile ? 104 : undefined }}
    >
      <option value="">모든 팀</option>
      {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  ) : null

  const bookBtn = (
    <button
      onClick={() => setAdding({ gearId: live[0]?.id ?? gear[0].id, date: today })}
      style={{
        ...BTN, background: 'var(--ac)', color: '#fff', borderColor: 'transparent',
        padding: isMobile ? '6px 14px' : '4px 12px',
      }}
    >예약하기</button>
  )

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
        {/* 폰에서는 두 줄. 첫 줄은 '어디를 보고 있나'와 '예약하기',
            둘째 줄은 옮기고 찾는 것들입니다 — 회의실 머리와 같은 방식. */}
        {isMobile && <div style={{ flex: 1 }} />}
        {isMobile && bookBtn}
        {isMobile && <div style={{ flexBasis: '100%', height: 0 }} />}
        {!isMobile && <div style={{ width: 1, height: 16, background: 'var(--bd)', margin: '0 2px' }} />}
        <div style={{ display: 'flex', gap: 2 }}>
          <Step label="이전 주" onClick={() => setAnchor(fmtYMD(addDays(new Date(anchor.replace(/-/g, '/')), -7)))} size={M.tap}>‹</Step>
          <button
            onClick={() => setAnchor(today)}
            style={{ ...BTN, padding: isMobile ? '5px 12px' : '3px 10px' }}
          >오늘</button>
          <Step label="다음 주" onClick={() => setAnchor(fmtYMD(addDays(new Date(anchor.replace(/-/g, '/')), 7)))} size={M.tap}>›</Step>
        </div>

        {/* 서른 개짜리 목록에서 'FX3'을 눈으로 찾게 하지 않습니다. 이름·메모·
            종류를 같이 봅니다 — 사람은 '송수신기'로도 찾고 'UWP'로도 찾습니다. */}
        {/* 폰에서는 팀 고르기가 먼저 서고 찾기가 남는 자리를 다 씁니다.
            반대로 두면 찾기 칸이 눌려서 '장비 찾…'이 됩니다 — 안내문이
            잘리면 그건 안내가 아닙니다. */}
        {isMobile && teamPick}
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={isMobile ? '찾기' : '장비 찾기'}
          style={{
            ...BTN, width: isMobile ? undefined : 108, flex: isMobile ? 1 : undefined,
            minWidth: 0, padding: '4px 8px', cursor: 'text',
            color: 'var(--t1)', background: 'var(--bg2)',
          }}
        />
        {/* 폰에서는 뺍니다. 종류 줄을 그냥 누르면 되는 일이고, 좁은 머리에
            자리를 차지할 만큼 자주 쓰는 단추가 아닙니다. */}
        {!isMobile && (
          <button
            onClick={() => setOpen(allOpen ? new Set() : new Set(rows.map(g => g.kind)))}
            disabled={searching}
            style={{ ...BTN, opacity: searching ? .5 : 1 }}
          >{allOpen ? '모두 접기' : '모두 펼치기'}</button>
        )}

        <div style={{ flex: 1 }} />

        {!isMobile && teamPick}
        {!isMobile && bookBtn}
      </div>

      {error && (
        <div
          onClick={clearError}
          style={{ padding: '7px 18px', fontSize: 12, color: 'var(--danger)', cursor: 'pointer', flexShrink: 0 }}
        >{error} · 눌러서 닫기</div>
      )}

      {/* ── 격자 ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div style={{ minWidth: M.nameW + SPAN * M.col, position: 'relative' }}>
          {/* 날짜 머리. 스크롤해도 붙어 있어야 어느 칸인지 압니다. */}
          <div style={{
            display: 'flex', position: 'sticky', top: 0, zIndex: 2,
            background: 'var(--bg)', borderBottom: '1px solid var(--bd)',
          }}>
            {/* 이 빈 칸도 왼쪽에 붙어 있어야 합니다. 안 붙이면 옆으로
                굴렸을 때 날짜 숫자가 장비 이름 열 위로 올라탑니다 —
                머리줄이 이름 열보다 위층(z)이라서요. */}
            <div style={{ width: M.nameW, flexShrink: 0, position: 'sticky', left: 0, background: 'var(--bg)', zIndex: 1 }} />
            {days.map(d => {
              const wd = new Date(d.replace(/-/g, '/')).getDay()
              return (
                <div key={d} style={{
                  width: M.col, flexShrink: 0, textAlign: 'center', padding: '6px 0 5px',
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
          {rows.length === 0 && (
            <div style={{ padding: '20px 12px', fontSize: 12, color: 'var(--t3)' }}>
              '{q}'와 맞는 장비가 없습니다.
            </div>
          )}
          {rows.map(group => {
          const openHere = isOpen(group.kind)
          const ids = group.items.map(g => g.id)
          const total = group.items.length
          return (
          <div key={group.kind}>
            {/*
              접힌 줄이 곧 요약입니다. 날짜마다 '몇 대가 나가 있나'를 칠하고,
              펴면 그 아래에 대별 줄이 섭니다.
            */}
            <div style={{ display: 'flex', height: M.kindH, background: 'var(--bg2)', borderBottom: '1px solid var(--bd2)' }}>
              <button
                onClick={() => toggle(group.kind)}
                disabled={searching}
                style={{
                  width: M.nameW, flexShrink: 0, padding: '0 10px', height: M.kindH,
                  position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1,
                  display: 'flex', alignItems: 'center', gap: 5,
                  border: 'none', borderRight: '1px solid var(--bd)',
                  fontSize: 11, fontWeight: 600, color: 'var(--t2)',
                  fontFamily: 'var(--font)', cursor: searching ? 'default' : 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{
                  display: 'inline-block', width: 8, flexShrink: 0, color: 'var(--t3)',
                  transform: openHere ? 'rotate(90deg)' : 'none', transition: 'transform .12s',
                }}>▸</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.kind}</span>
                <span style={{ fontWeight: 400, color: 'var(--t3)', flexShrink: 0 }}>{total}</span>
              </button>
              <div style={{ position: 'relative', height: M.kindH, width: SPAN * M.col, flexShrink: 0 }}>
                {days.map((d, i) => {
                  const busy = busyCount(shown, ids, d)
                  const ratio = total ? busy / total : 0
                  return (
                    <div
                      key={d}
                      title={busy ? `${d} · ${total}대 중 ${busy}대 나감` : `${d} · 다 있습니다`}
                      style={{
                        position: 'absolute', left: i * M.col, top: 0, width: M.col, height: M.kindH,
                        borderRight: '1px solid var(--bd2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontVariantNumeric: 'tabular-nums',
                        // 나간 만큼 진해집니다. 다 나간 날은 한눈에 검붉고, 여유
                        // 있는 날은 거의 안 보입니다 — 눈이 멈춰야 하는 곳에만
                        // 멈추게 합니다.
                        background: busy === 0 ? 'transparent' : `hsl(212 72% ${92 - ratio * 26}%)`,
                        color: ratio > .7 ? '#fff' : 'hsl(212 55% 30%)',
                        fontWeight: ratio === 1 ? 600 : 400,
                      }}
                    >{busy || ''}</div>
                  )
                })}
              </div>
            </div>
          {openHere && group.items.map(item => {
            const mine = shown.filter(b => b.gearId === item.id)
            return (
              <div key={item.id} style={{
                display: 'flex', borderBottom: '1px solid var(--bd2)',
                opacity: item.active === false ? .45 : 1,
              }}>
                <div style={{
                  width: M.nameW, flexShrink: 0, padding: '0 10px',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center',
                  height: M.rowH, borderRight: '1px solid var(--bd)',
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

                <div style={{ position: 'relative', height: M.rowH, width: SPAN * M.col, flexShrink: 0 }}>
                  {/* 빈 칸도 눌립니다 — 비어 있는 것을 봤을 때 하고 싶은 일은
                      그 자리에 잡는 것입니다. */}
                  {days.map((d, i) => (
                    <button
                      key={d}
                      onClick={() => setAdding({ gearId: item.id, date: d })}
                      title={`${item.name} · ${d}`}
                      disabled={item.active === false}
                      style={{
                        position: 'absolute', left: i * M.col, top: 0, width: M.col, height: M.rowH,
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
                          position: 'absolute', left: from * M.col + (openL ? 0 : 2), top: 4,
                          width: (to - from + 1) * M.col - (openL ? 0 : 2) - (openR ? 0 : 2),
                          height: M.rowH - 8,
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
          )})}
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

function Step({ label, onClick, children, size = 26 }: {
  label: string; onClick: () => void; children: React.ReactNode
  /** 손이 닿아야 하는 크기. 폰에서는 넓힙니다 — metrics.tap. */
  size?: number
}) {
  return (
    <button aria-label={label} onClick={onClick} style={{ ...BTN, width: size, height: size, padding: 0 }}>{children}</button>
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
  const profileOf = useUserProfileStore(s => s.getProfileByEmail)
  const gear = useGearStore(s => s.gear)
  const kindOf = (b: GearBooking) => gear.find(g => g.id === b.gearId)?.kind
  /**
   * 이름을 찾는 순서.
   *
   * getNameByEmail은 프로필이 없으면 **주소의 앞부분을 돌려줍니다.** 그래서
   * `getNameByEmail(...) || booking.byName`으로 두면 뒤 칸이 영영 안 쓰입니다 —
   * 아직 프로필이 안 온 사람도, 회사를 떠나 프로필이 지워진 사람도 'sumin'으로
   * 뜹니다. 잡을 때 적어 둔 이름이 바로 그럴 때 쓰라고 있는 것입니다.
   */
  const who = (b: GearBooking) => profileOf(b.by)?.name || b.byName || b.by.split('@')[0]

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
        {who(booking)}
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
/**
 * ── 폰에서는 아래에서 올라옵니다 ────────────────────────────────────────────
 *
 * 가운데 뜨는 창은 마우스의 자리입니다. 손은 화면 아래쪽에 있고, 한 손으로
 * 들고 있을 때 닿는 곳도 거기입니다 — 창이 위에 뜨면 닫는 단추까지 손을
 * 옮겨야 합니다. 그리고 아래에 붙으면 폭을 다 쓸 수 있어서, 380px에 맞춰
 * 접혀 있던 줄들이 그냥 펴집니다.
 */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const isMobile = useMobile()
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
        display: 'flex', justifyContent: 'center',
        alignItems: isMobile ? 'flex-end' : 'center',
        padding: isMobile ? 0 : 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg)', border: '1px solid var(--bd)',
          borderRadius: isMobile ? 'var(--r3) var(--r3) 0 0' : 'var(--r3)',
          boxShadow: 'var(--sh-lg)', width: '100%',
          maxWidth: isMobile ? undefined : 380,
          maxHeight: isMobile ? '88vh' : '86vh',
          overflowY: 'auto', boxSizing: 'border-box',
          // 아래 끝은 홈 바가 가려 갑니다. 그만큼 더 띄웁니다.
          padding: isMobile ? '14px 16px calc(18px + var(--safe-b))' : '16px 18px 18px',
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
