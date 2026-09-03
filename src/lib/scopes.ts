/**
 * ── 구글 범위 글자 다루기 ────────────────────────────────────────────────────
 *
 * 범위는 띄어쓰기로 이어진 한 줄입니다. 순서는 뜻이 없고 중복도 뜻이 없어서,
 * 비교하려면 낱개로 풀어서 봐야 합니다 — 글자끼리 비교하면 같은 허락이 순서만
 * 다르다는 이유로 '다르다'가 됩니다.
 *
 * 서버에도 같은 함수가 있습니다(mcp/src/google.ts). 웹과 서버는 따로 배포되는
 * 두 덩어리라 각자 두되, 둘 다 여기와 같은 규칙이어야 합니다.
 */

/** 띄어쓰기로 이어진 범위 글자를 낱개로. 빈 칸과 중복은 버립니다. */
export function scopeList(scope: string | null | undefined): string[] {
  return [...new Set((scope ?? '').split(/\s+/).filter(Boolean))].sort()
}

/**
 * 들고 있는 허락이 원하는 범위를 다 덮는가.
 *
 * 빈 요청은 **거짓입니다.** '아무것도 안 원한다'를 '다 덮는다'로 읽으면,
 * 범위를 안 실어 보낸 실수가 연결된 것처럼 보입니다.
 */
export function coversScope(granted: string | null | undefined, wanted: string): boolean {
  const has = new Set(scopeList(granted))
  const need = scopeList(wanted)
  return need.length > 0 && need.every(s => has.has(s))
}

/* ── 이 앱이 구글에 청하는 범위 ─────────────────────────────────────────────
 *
 * 다섯 줄이 여기 한 곳에 있습니다. 예전에는 캘린더는 스토어에, 드라이브·문서는
 * googleDrive/googleDocs에, 메일은 gmail에 각각 적혀 있었고, '한 번에 청하는
 * 목록'은 그것들을 손으로 베낀 네 번째 사본이었습니다. 사본은 언젠가 어긋나고,
 * 어긋난 날 사람은 **동의를 두 번** 하게 됩니다 — 무엇이 잘못됐는지는 화면에
 * 안 나옵니다. 쓰는 글자와 청하는 글자가 같은 글자여야 어긋날 수가 없습니다.
 */

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
export const CALENDAR_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
export const DOCS_SCOPE = 'https://www.googleapis.com/auth/documents.readonly'
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

/**
 * 서버가 열쇠를 들 때는 **처음 한 번의 동의에서 이걸 다 청합니다.** 세 연동을
 * 각각 눌러 세 번 동의하게 두면, 사람은 같은 일을 세 번 한 것으로 느낍니다.
 * 한 번 허락된 범위는 서버에 합쳐 쌓이므로, 나머지 둘은 창 없이 붙습니다.
 */
export const ALL_GOOGLE_SCOPE = [
  CALENDAR_SCOPE,
  CALENDAR_WRITE_SCOPE,
  DRIVE_SCOPE,
  DOCS_SCOPE,
  GMAIL_SCOPE,
].join(' ')
