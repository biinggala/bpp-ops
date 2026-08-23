/**
 * ── 아직 안 왔습니다 ─────────────────────────────────────────────────────────
 *
 * 앱을 켜면 프로젝트 목록이 먼저 오고, 그 안의 업무는 프로젝트마다 따로
 * 읽어 옵니다. 그 몇 초 동안 화면에는 아무것도 없는데, 예전에는 그걸
 * "업무가 없어요"라고 아주 자신 있게 말했습니다. 없는 것과 아직 안 온 것은
 * 다른 말이고, 사람은 그 둘을 화면에서 구별할 방법이 없었습니다.
 *
 * 그래서 회색 막대를 놓습니다. 빙글빙글 도는 동그라미가 아니라 **들어올
 * 것의 모양**입니다 — 목록이 올 자리에는 목록처럼 생긴 것이 기다립니다.
 * 뭐가 오는지 이미 알고 있으면 기다리는 몇 초가 덜 깁니다.
 */

/** 한 칸. 폭은 줄마다 조금씩 달라야 목록처럼 보입니다. */
function Bar({ w, h = 11 }: { w: number | string; h?: number }) {
  return <div className="bpp-skel" style={{ width: w, height: h, flexShrink: 0 }} />
}

/** 본문 자리를 채우는 업무 목록 모양. */
export function LoadingRows({ rows = 7 }: { rows?: number }) {
  // 같은 폭이 반복되면 무늬로 보여서 목록처럼 안 읽힙니다.
  const widths = ['46%', '62%', '38%', '55%', '70%', '43%', '58%', '50%', '66%']
  return (
    <div
      role="status"
      aria-label="불러오는 중"
      style={{ flex: 1, padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0' }}>
          <Bar w={12} h={12} />
          <Bar w={widths[i % widths.length]} />
          <div style={{ flex: 1 }} />
          <Bar w={44} h={9} />
        </div>
      ))}
    </div>
  )
}

/** 사이드바처럼 좁은 곳. 한 줄에 칩 하나 폭입니다. */
export function LoadingChips({ rows = 5 }: { rows?: number }) {
  const widths = ['78%', '55%', '68%', '48%', '72%', '60%']
  return (
    <div role="status" aria-label="불러오는 중" style={{ padding: '6px 2px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: rows }, (_, i) => (
        <Bar key={i} w={widths[i % widths.length]} h={13} />
      ))}
    </div>
  )
}
