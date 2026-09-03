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

/**
 * 이 앱이 구글에 청하는 범위 전부 — 캘린더(읽기·일정 쓰기), 드라이브, 문서, 메일.
 *
 * 서버가 열쇠를 들 때는 **처음 한 번의 동의에서 이걸 다 청합니다.** 세 연동을
 * 각각 눌러 세 번 동의하게 두면, 사람은 같은 일을 세 번 한 것으로 느낍니다.
 * 한 번 허락된 범위는 서버에 합쳐 쌓이므로, 나머지 둘은 창 없이 붙습니다.
 */
export const ALL_GOOGLE_SCOPE = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ')
