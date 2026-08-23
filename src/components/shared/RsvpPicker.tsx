import React, { useState } from 'react'
import type { Rsvp } from '../../lib/googleCalendar'

/**
 * ── 초대에 답하는 컨트롤 ─────────────────────────────────────────────────────
 *
 * 두 군데서 씁니다: 캘린더의 일정 카드와, 받은 알림의 초대 줄. 같은 값을 고르는
 * 일이므로 정의는 한 곳에 있어야 합니다 — 두 벌로 두면 한쪽만 고쳐지고, 같은
 * 질문이 화면마다 다르게 생기게 됩니다.
 *
 * **하나의 세그먼트입니다.** 각자 테두리를 가진 버튼 셋으로 두면 세 개의 별개
 * 동작처럼 보이는데, 실제로는 하나의 값에서 하나를 고르는 일입니다.
 *
 * 칸 사이 선은 따로 그립니다. 버튼에 `inset` 그림자로 넣으면 그림자가 버튼의
 * 둥근 모서리를 따라가서 선 끝이 꺾여 보입니다 — 그림자는 상자의 모양을
 * 따르고, 우리가 원하는 건 상자와 무관한 직선 하나입니다.
 *
 * 안 고른 칸들 **사이만** 선을 둡니다. 고른 칸은 자기 배경이 경계를 이미
 * 말하고 있어서 선을 겹치면 지저분해집니다.
 */

/** `soft`가 따로 있는 이유: `--danger`는 화면 밝기에 따라 값이 달라서 hex로
    계산할 수 없습니다. tint()에 넣으면 거절만 색을 잃습니다. */
const OPTIONS: { value: Rsvp; label: string; tone: string; soft: string }[] = [
  { value: 'accepted',  label: '수락', tone: '#448361',       soft: 'rgba(68,131,97,.16)' },
  { value: 'tentative', label: '미정', tone: '#D9730D',       soft: 'rgba(217,115,13,.16)' },
  { value: 'declined',  label: '거절', tone: 'var(--danger)', soft: 'var(--danger-l)' },
]

export function RsvpPicker({ current, onRespond, compact = false }: {
  current: string
  onRespond: (r: Rsvp) => void
  /** 사이드바처럼 좁은 곳. 글자와 높이만 줄고 구조는 같습니다. */
  compact?: boolean
}) {
  return (
    <div style={{
      display: 'flex', borderRadius: 'var(--r2)', overflow: 'hidden',
      background: 'var(--bg3)', padding: 2,
    }}>
      {OPTIONS.map((o, i) => {
        const on = current === o.value
        const rule = i > 0 && !on && current !== OPTIONS[i - 1].value
        return (
          <React.Fragment key={o.value}>
            {i > 0 && (
              <span aria-hidden style={{
                width: 1, flexShrink: 0, margin: compact ? '4px 0' : '5px 0',
                background: rule ? 'var(--bd)' : 'transparent',
              }} />
            )}
            <Cell option={o} on={on} compact={compact} onClick={() => onRespond(o.value)} />
          </React.Fragment>
        )
      })}
    </div>
  )
}

function Cell({ option, on, compact, onClick }: {
  option: { label: string; tone: string; soft: string }
  on: boolean
  compact: boolean
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1, padding: compact ? '3px 0' : '5px 0', border: 'none', cursor: 'pointer',
        fontFamily: 'var(--font)', fontSize: compact ? 11 : 12,
        fontWeight: on ? 600 : 400,
        borderRadius: 'var(--r1)',
        background: on ? option.soft : hovered ? 'var(--bg2)' : 'transparent',
        color: on ? option.tone : 'var(--t2)',
        transition: 'background .1s, color .1s',
      }}
    >{option.label}</button>
  )
}
