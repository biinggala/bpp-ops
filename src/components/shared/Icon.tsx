/**
 * ── 메뉴 아이콘 ──────────────────────────────────────────────────────────────
 *
 * The menus used to be drawn with whatever the font had lying around: ✎ next to
 * 👥 next to ▤ next to 📦. Three of those are line glyphs at three different
 * weights, one is a full-colour picture, and none of them share a baseline or an
 * optical size — so a five-item menu read as five unrelated things stacked up.
 *
 * One family instead, on the same terms as the bottom bar's icons (NavIcons):
 * a 24 grid, 1.7 of stroke, round caps and joins, `currentColor` throughout so
 * the row decides what colour it is — including the red one, which needs the
 * icon to go red with the label.
 */

export type IconName =
  | 'pencil' | 'users' | 'layers' | 'archive' | 'unarchive' | 'trash'
  | 'exit' | 'settings' | 'plus' | 'external' | 'unlink' | 'sun' | 'moon' | 'monitor'
  | 'inbox' | 'home' | 'today' | 'calendar' | 'file' | 'panel' | 'mail' | 'search'

/** The ones a single path can say. */
const PATHS: Partial<Record<IconName, string>> = {
  pencil: 'M4.8 19.2h3.1L18.4 8.6a2.2 2.2 0 0 0-3.1-3.1L4.8 16.1z',
  layers: 'M12 3.6 3.6 8.1 12 12.6l8.4-4.5zM3.6 12.8 12 17.3l8.4-4.5M3.6 16.9 12 21.4l8.4-4.5',
  plus: 'M12 5.4v13.2M5.4 12h13.2',
  external: 'M14.2 4.8h5v5M19.2 4.8 11 13M16.6 13.6v4.4a1.6 1.6 0 0 1-1.6 1.6H6a1.6 1.6 0 0 1-1.6-1.6V9a1.6 1.6 0 0 1 1.6-1.6h4.4',
  unlink: 'm9.2 14.8-2.4 2.4a3.4 3.4 0 0 1-4.8-4.8l2.4-2.4M14.8 9.2l2.4-2.4a3.4 3.4 0 0 1 4.8 4.8l-2.4 2.4M4.4 4.4l15.2 15.2',
  exit: 'M9.6 19.2H6a1.8 1.8 0 0 1-1.8-1.8V6.6A1.8 1.8 0 0 1 6 4.8h3.6M14.6 15.8 18.4 12l-3.8-3.8M18.4 12H9.2',
  moon: 'M20 13.4A8 8 0 0 1 10.6 4a8.2 8.2 0 1 0 9.4 9.4z',
  // 밖에서 온 줄이라는 표시. 안에서 일어난 일과 한눈에 갈라져야 합니다.
  file: 'M13.4 3.6H7.2a1.8 1.8 0 0 0-1.8 1.8v13.2a1.8 1.8 0 0 0 1.8 1.8h9.6a1.8 1.8 0 0 0 1.8-1.8V8.4zM13.4 3.6v4.8h5.2',
}

export function Icon({ name, size = 15, strokeWidth = 1.7 }: {
  name: IconName
  size?: number
  strokeWidth?: number
}) {
  const common = {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', strokeWidth,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    style: { display: 'block', flexShrink: 0 },
    'aria-hidden': true,
  }

  const d = PATHS[name]
  if (d) return <svg {...common}><path d={d} /></svg>

  if (name === 'users') {
    return (
      <svg {...common}>
        <circle cx="9.4" cy="8.2" r="3.2" />
        <path d="M3.8 19.4a5.6 5.6 0 0 1 11.2 0M16.2 5.4a3.2 3.2 0 0 1 0 5.8M17.6 14.6a5.6 5.6 0 0 1 2.6 4.8" />
      </svg>
    )
  }
  // A box with a lid — the lid is what makes it an archive rather than a crate.
  if (name === 'archive' || name === 'unarchive') {
    return (
      <svg {...common}>
        <rect x="3.4" y="4.4" width="17.2" height="4" rx="1.2" />
        <path d="M5 8.4v9.4a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8V8.4" />
        {name === 'archive'
          ? <path d="M12 11.6v4.6M9.6 13.8 12 16.2l2.4-2.4" />
          : <path d="M12 16.2v-4.6M9.6 14l2.4-2.4 2.4 2.4" />}
      </svg>
    )
  }
  // A tray with its mouth open — what arrives lands here.
  if (name === 'inbox') {
    return (
      <svg {...common}>
        <path d="M3.6 13.2h4l1.2 2.4h6.4l1.2-2.4h4" />
        <path d="M6.1 5.2h11.8a1.8 1.8 0 0 1 1.7 1.2l2 6.1v4.3a1.8 1.8 0 0 1-1.8 1.8H4.2a1.8 1.8 0 0 1-1.8-1.8v-4.3l2-6.1a1.8 1.8 0 0 1 1.7-1.2z" />
      </svg>
    )
  }
  // 사이드바 — 창 하나에 왼쪽 기둥. 채워진 쪽이 접었다 폈다 하는 쪽입니다.
  // 봉투. 밖에서 온 줄이라는 표시는 색이 아니라 모양이어야 합니다.
  if (name === 'mail') {
    return (
      <svg {...common}>
        <rect x="3.2" y="5.4" width="17.6" height="13.2" rx="2.2" />
        <path d="m3.8 7.2 7.1 5.1a2 2 0 0 0 2.2 0l7.1-5.1" />
      </svg>
    )
  }
  if (name === 'panel') {
    return (
      <svg {...common}>
        <rect x="3.2" y="4.8" width="17.6" height="14.4" rx="2.4" />
        <path d="M9.4 4.8v14.4" />
      </svg>
    )
  }
  if (name === 'home') {
    return (
      <svg {...common}>
        <path d="M3.6 10.4 12 3.8l8.4 6.6v8.2a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8z" />
        <path d="M9.4 20.4v-7h5.2v7" />
      </svg>
    )
  }
  // 오늘 — 달력 한 장에 오늘 칸만 채워져 있습니다.
  /* 오늘과 나란히 서는 아이콘이라 일부러 다르게 그립니다 — 오늘은 '하루
     하나'라 칸 하나가 칠해져 있고, 캘린더는 '한 달 전부'라 칸들이 깔립니다. */
  if (name === 'search') {
    return (
      <svg {...common}>
        <circle cx="10.8" cy="10.8" r="6.4" />
        <path d="m15.5 15.5 4.1 4.1" />
      </svg>
    )
  }

  if (name === 'calendar') {
    return (
      <svg {...common}>
        <rect x="3.4" y="5.2" width="17.2" height="15.2" rx="2.6" />
        <path d="M3.4 9.6h17.2M8.2 3.4v3.4M15.8 3.4v3.4" />
        <path d="M7.4 13h.01M12 13h.01M16.6 13h.01M7.4 16.8h.01M12 16.8h.01M16.6 16.8h.01"
          strokeWidth={2.2} strokeLinecap="round" />
      </svg>
    )
  }

  if (name === 'today') {
    return (
      <svg {...common}>
        <rect x="3.4" y="5.2" width="17.2" height="15.2" rx="2.6" />
        <path d="M3.4 9.6h17.2M8.2 3.4v3.4M15.8 3.4v3.4" />
        <rect x="10.4" y="12.6" width="3.2" height="3.2" rx=".8" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  if (name === 'trash') {
    return (
      <svg {...common}>
        <path d="M4.6 6.8h14.8M9.4 6.8V5.4a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.4" />
        <path d="M6.6 6.8v11.6a1.8 1.8 0 0 0 1.8 1.8h7.2a1.8 1.8 0 0 0 1.8-1.8V6.8" />
        <path d="M10.4 10.6v5.6M13.6 10.6v5.6" />
      </svg>
    )
  }
  if (name === 'settings') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3.1" />
        <path d="M19.1 14.6a1.6 1.6 0 0 0 .32 1.76l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.06-.06a1.6 1.6 0 0 0-1.76-.32 1.6 1.6 0 0 0-.97 1.46v.17a1.9 1.9 0 1 1-3.8 0v-.09a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.76.32l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0 .32-1.76 1.6 1.6 0 0 0-1.46-.97h-.17a1.9 1.9 0 1 1 0-3.8h.09a1.6 1.6 0 0 0 1.46-1.05 1.6 1.6 0 0 0-.32-1.76l-.06-.06a1.9 1.9 0 1 1 2.7-2.7l.06.06a1.6 1.6 0 0 0 1.76.32h.08A1.6 1.6 0 0 0 10.5 3.4v-.17a1.9 1.9 0 1 1 3.8 0v.09a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.76-.32l.06-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0-.32 1.76v.08a1.6 1.6 0 0 0 1.46.97h.17a1.9 1.9 0 1 1 0 3.8h-.09a1.6 1.6 0 0 0-1.46.97z" />
      </svg>
    )
  }
  if (name === 'sun') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.8v2.4M12 18.8v2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M2.8 12h2.4M18.8 12h2.4M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
      </svg>
    )
  }
  // 'monitor' — the machine's own setting, so: a machine.
  return (
    <svg {...common}>
      <rect x="3.2" y="4.6" width="17.6" height="12" rx="2.2" />
      <path d="M8.6 20h6.8M12 16.6V20" />
    </svg>
  )
}
