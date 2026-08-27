import type React from 'react'

/**
 * ── 노트 줄의 공통 치수 ──────────────────────────────────────────────────────
 *
 * 노트에는 세 종류의 줄이 섞여 삽니다 — 업무 참조(TaskRef), 파일 참조(FileRef),
 * 그리고 손으로 친 체크박스 줄(taskItem). **끝에서부터 같은 자리에 같은 것이
 * 놓여야** 목록이 한 덩어리로 읽힙니다.
 *
 * 실제로는 어긋나 있었습니다. 업무 줄에는 맨 끝에 ×가 있고(손이 오면 뜹니다,
 * 자리는 늘 차지합니다), 체크박스 줄에는 없습니다. 그래서 시간을 붙였더니
 * 같은 `14:00–14:30`이 줄 종류에 따라 ×의 폭만큼 어긋나 섰습니다.
 *
 * 그 폭을 여기서 한 번만 정합니다. ×가 있는 줄은 그걸 ×에 쓰고, 없는 줄은
 * 오른쪽 여백으로 비워 둡니다(index.css) — **끝나는 자리는 같습니다.**
 *
 * 이 두 상수는 TaskRef와 FileRef에 똑같이 복사돼 있었습니다. 복사본이 둘이면
 * 하나는 언젠가 뒤처집니다.
 */
export const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 'var(--note-gap)',
  padding: '3px 6px', margin: '1px -6px', borderRadius: 'var(--r2)',
}

export const REMOVE: React.CSSProperties = {
  marginLeft: 'auto', flexShrink: 0,
  // 폭을 못 박습니다. 글꼴이 정하게 두면 체크박스 줄에 비워 둔 자리와
  // 몇 픽셀씩 어긋나고, 그 어긋남이 곧 이 주석이 생긴 이유입니다.
  width: 'var(--note-x)', padding: 0, textAlign: 'center',
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--t3)', fontSize: 14, lineHeight: 1,
  fontFamily: 'var(--font)',
}
