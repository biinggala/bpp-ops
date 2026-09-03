// 이 초대가 **내 것인가** — 참석자 목록만 보고 답합니다.
//
// 구글은 참석자 한 줄에 `self: true`를 붙여 주는데, 그 '자기'는 **읽고 있는
// 캘린더의 주인**입니다. 내 캘린더를 읽을 때는 나지만, 구독한 동료의
// 캘린더를 읽을 때는 그 동료입니다. 그걸 그대로 '내 참석'으로 읽었더니
// 동료가 초대받고 아직 답 안 한 회의가 전부 내 알림함에 섰습니다.
//
// 그래서 주소로 맞춥니다. 내 주소는 로그인이 알고, 참석자 줄에는 주소가
// 있으니 `self`가 누구 것이든 상관없습니다. 내 주소를 아직 모르면(로그인
// 전) 아무것도 내 것이 아닙니다 — 안 온 것을 '전부'로 읽으면 안 됩니다.

export interface AttendeeLike {
  email?: string
  self?: boolean
  organizer?: boolean
  responseStatus?: string
}

export function isMe(a: AttendeeLike, myEmail: string | null | undefined): boolean {
  if (!myEmail || !a.email) return false
  return a.email.toLowerCase() === myEmail.toLowerCase()
}

/**
 * 내가 **답해야 하는** 참석자 줄. 없으면 답할 일이 없습니다.
 *
 * 주최자는 뺍니다. 내가 만든 일정에도 구글은 내 줄을 넣고
 * `organizer: true, responseStatus: 'accepted'`로 두는데, 그걸 읽으면 내가
 * 부른 회의에 나에게 수락/거절을 묻게 됩니다. 안 가면 회의를 옮기거나
 * 없애는 것이고, 그건 다른 버튼입니다.
 */
export function attendanceOf<T extends AttendeeLike>(
  attendees: T[] | undefined,
  myEmail: string | null | undefined,
): T | null {
  const me = attendees?.find(a => isMe(a, myEmail))
  if (!me || me.organizer) return null
  return me
}

/** 아직 대답 안 한 내 초대인가. */
export function awaitingReply(attendees: AttendeeLike[] | undefined, myEmail: string | null | undefined): boolean {
  const me = attendanceOf(attendees, myEmail)
  return !!me && (me.responseStatus ?? 'needsAction') === 'needsAction'
}

/**
 * 같은 일정의 사본을 하나로.
 *
 * 나와 동료가 같은 회의에 초대받았으면 그 회의는 내 캘린더에도, 구독한
 * 동료 캘린더에도 있습니다 — 구글에서는 **같은 일정 id**입니다. 그대로 두면
 * 알림함에 같은 초대가 두 번 섭니다. 내 캘린더 사본을 남기고, 그게 없으면
 * 먼저 온 것을 남깁니다.
 */
export function onePerEvent<T extends { id: string; calendarId: string }>(
  events: T[],
  ownCalendarIds: Iterable<string>,
): T[] {
  const own = new Set([...ownCalendarIds])
  const byBare = new Map<string, T>()
  for (const ev of events) {
    const bare = ev.id.startsWith(ev.calendarId + ':') ? ev.id.slice(ev.calendarId.length + 1) : ev.id
    const have = byBare.get(bare)
    if (!have || (!own.has(have.calendarId) && own.has(ev.calendarId))) byBare.set(bare, ev)
  }
  return [...byBare.values()]
}
