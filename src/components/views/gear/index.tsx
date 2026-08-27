import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from '../../../store/authStore'
import { useOrgStore } from '../../../store/orgStore'
import { useGearStore, teamOfEmail } from '../../../store/gearStore'
import { useUserProfileStore } from '../../../store/userProfileStore'
import { addDays, fmtYMD, isComposing } from '../../../lib/utils'
import { dayNo, gearClash, gearRangeError, gearWhen, hhmm, type GearBooking, type GearRange } from '../../../lib/gear'
import { TimeRange } from '../../shared/TimePick'
import { DateField } from '../../shared/DatePicker'
import { askConfirm } from '../../shared/Confirm'
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

export function GearView() {
  const isMobile = useMobile()
  const email = useAuthStore(s => s.email)
  const orgId = useOrgStore(s => s.orgId)
  const admins = useOrgStore(s => s.admins)
  const { ready, gear, teams, teamOf, bookings, error, clearError, release } = useGearStore(useShallow(s => ({
    ready: s.ready, gear: s.gear, teams: s.teams, teamOf: s.teamOf, bookings: s.bookings,
    error: s.error, clearError: s.clearError, release: s.release,
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

  if (!orgId) {
    return <Blank>워크스페이스에 들어가면 장비를 함께 씁니다. 설정 → 개요에서 만들 수 있습니다.</Blank>
  }
  if (!ready) return <Blank>불러오는 중…</Blank>
  const isAdmin = !!email && admins.includes(email.toLowerCase())
  if (gear.length === 0) {
    return (
      <Blank>
        아직 등록된 장비가 없습니다.
        {isAdmin ? ' 설정 → 장비에서 더할 수 있습니다.' : ' 관리자가 목록을 만들면 여기 섭니다.'}
      </Blank>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* ── 머리 ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: isMobile ? '10px 12px' : '12px 18px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)' }}>장비</div>
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
          style={{ ...BTN, background: 'var(--accent)', color: '#fff', borderColor: 'transparent', padding: '4px 12px' }}
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
                  color: d === today ? 'var(--accent)' : wd === 0 ? 'var(--danger)' : 'var(--t3)',
                  fontWeight: d === today ? 600 : 400,
                }}>
                  <div>{WEEK[wd]}</div>
                  <div style={{ fontSize: 12 }}>{Number(d.slice(8))}</div>
                </div>
              )
            })}
          </div>

          {gear.map(item => {
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
      </div>

      {picked && (
        <BookingCard
          booking={picked}
          canRelease={!!email && (picked.by === email.toLowerCase() || isAdmin)}
          onClose={() => setPicked(null)}
          onRelease={async () => {
            const ok = await askConfirm({
              message: `'${picked.gearName || '장비'}' 예약을 풉니다`,
              detail: `${gearWhen(picked)} · ${picked.reason}`,
              confirmLabel: '풀기',
            })
            if (ok && await release(picked.id)) setPicked(null)
          }}
        />
      )}

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

function Step({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} onClick={onClick} style={{ ...BTN, width: 26, padding: 0 }}>{children}</button>
  )
}

/** 막대를 누르면 뜨는 한 장. 왜 빌렸는지가 여기 있습니다. */
function BookingCard({ booking, canRelease, onClose, onRelease }: {
  booking: GearBooking
  canRelease: boolean
  onClose: () => void
  onRelease: () => void
}) {
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  return (
    <Sheet onClose={onClose} title={booking.gearName || '장비'}>
      <Field label="언제">{gearWhen(booking)}{booking.long && ' · 장기'}</Field>
      <Field label="누가">
        {getNameByEmail(booking.by) || booking.byName || booking.by}
        {booking.teamName && <span style={{ color: 'var(--t3)' }}> · {booking.teamName}</span>}
      </Field>
      <Field label="사용 사유">{booking.reason}</Field>
      {booking.extra && <Field label="기타">{booking.extra}</Field>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 14 }}>
        {canRelease && (
          <button onClick={onRelease} style={{ ...BTN, color: 'var(--danger)' }}>예약 풀기</button>
        )}
        <button onClick={onClose} style={BTN}>닫기</button>
      </div>
    </Sheet>
  )
}

/**
 * ── 예약 ─────────────────────────────────────────────────────────────────────
 *
 * 두 가지를 한 폼에 둡니다. 시간을 정하는 예약과, 날짜만 정하는 장기 예약.
 * 화면을 둘로 가르지 않은 이유는 고르는 것이 **같은 장비, 같은 사유**이고
 * 다른 것은 '언제'뿐이기 때문입니다.
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

  const [item, setItem] = useState(gearId)
  const [long, setLong] = useState(false)
  const [from, setFrom] = useState(date)
  const [to, setTo] = useState(date)
  const [startMin, setStartMin] = useState(600)
  const [minutes, setMinutes] = useState(120)
  const [team, setTeam] = useState(myTeam)
  const [reason, setReason] = useState('')
  const [extra, setExtra] = useState('')
  const [busy, setBusy] = useState(false)

  // 반납일이 대여일보다 빠른 상태를 **만들 수 없게** 합니다. 고른 뒤에
  // 빨간 글씨로 알려 주는 것보다, 애초에 그 상태가 없는 편이 낫습니다.
  useEffect(() => { if (to < from) setTo(from) }, [from, to])

  const range: GearRange = long
    ? { from, to, fromMin: 0, toMin: 1440, long: true }
    : { from, to: from, fromMin: startMin, toMin: startMin + minutes }

  const bad = gearRangeError(range)
  const held = bad ? null : gearClash(bookings, item, range)
  const stop = bad ?? (held ? `이미 ${held.teamName ? held.teamName + ' ' : ''}${held.byName || held.by} 님이 잡아 두었습니다 — ${gearWhen(held)}` : null)

  const save = async () => {
    if (!email || busy || stop || !reason.trim()) return
    setBusy(true)
    const ok = await book({
      gearId: item, ...range,
      by: email, ...(myName ? { byName: myName } : {}),
      ...(team ? { team } : {}),
      reason, ...(extra.trim() ? { extra } : {}),
    })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Sheet onClose={onClose} title="장비 예약">
      <Row label="장비">
        <select value={item} onChange={e => setItem(e.target.value)} style={FIELD}>
          {gear.filter(g => g.active !== false).map(g => (
            <option key={g.id} value={g.id}>{g.name}{g.note ? ` (${g.note})` : ''}</option>
          ))}
        </select>
      </Row>

      <Row label="종류">
        <div style={{ display: 'flex', gap: 4 }}>
          {/* '장기 예약'은 촬영 프로젝트에 따라 며칠씩 빌려 가는 것입니다.
              시각을 안 묻습니다 — 물어도 아무도 그 시각에 안 맞춥니다. */}
          <Chip on={!long} onClick={() => setLong(false)}>시간 예약</Chip>
          <Chip on={long} onClick={() => { setLong(true); if (to < from) setTo(from) }}>장기 예약</Chip>
        </div>
      </Row>

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
            <TimeRange
              startMin={startMin}
              minutes={minutes}
              onChange={(s, m) => { setStartMin(s); setMinutes(m) }}
            />
          </Row>
        </>
      )}

      <Row label="소속팀">
        <select value={team} onChange={e => setTeam(e.target.value)} style={FIELD}>
          <option value="">없음</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Row>

      <Row label="사용 사유">
        <input
          value={reason}
          onChange={e => setReason(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) void save() }}
          placeholder="예: 브랜드필름 본 촬영"
          style={FIELD}
          autoFocus
        />
      </Row>

      <Row label="기타">
        <input
          value={extra}
          onChange={e => setExtra(e.target.value)}
          placeholder="배터리 2개, 외부 반출 등"
          style={FIELD}
        />
      </Row>

      {stop && <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 8, lineHeight: 1.6 }}>{stop}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 14 }}>
        <button onClick={onClose} style={BTN}>취소</button>
        <button
          onClick={() => void save()}
          disabled={busy || !!stop || !reason.trim()}
          style={{
            ...BTN, background: 'var(--accent)', color: '#fff', borderColor: 'transparent',
            opacity: busy || stop || !reason.trim() ? .5 : 1,
          }}
        >잡기</button>
      </div>
    </Sheet>
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
        background: on ? 'var(--accent)' : 'var(--bg)',
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
