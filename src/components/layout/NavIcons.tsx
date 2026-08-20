import type { ViewType } from '../../types'

/**
 * ── The bottom bar's icons ───────────────────────────────────────────────────
 *
 * They used to be typographic characters — ≡ ⊞ ◪ ▤ ◑ and one full-colour 🗂 —
 * borrowed from whatever the font happened to have. Every one arrived at a
 * different weight and a different optical size, one of them was a picture
 * rather than a glyph, and none of them said what its screen was: ◪ is a
 * half-filled square, not a calendar.
 *
 * One family instead: drawn on the same 24 grid, 1.7 of stroke, round caps, and
 * each one a picture of its own screen — rows for the list, columns for the
 * board, a month for the calendar, staggered bars for the gantt, a chart for the
 * stats, a folder for the files. `currentColor` throughout, so the bar decides
 * what is lit and the icon does not have to know.
 */

/**
 * The one-path icons. The three that need more than a path — rows with bullets,
 * the kanban frame, the month grid — are drawn in the component below.
 */
const SIMPLE: Partial<Record<ViewType, { d: string; width?: number }>> = {
  // Bars that step down the page, which is what a gantt looks like from afar.
  g: { d: 'M4.6 7.2h7.6M9.4 12h9M6.8 16.8h6.4', width: 2.4 },
  s: { d: 'M5.2 19.2v-4.6M12 19.2v-10.4M18.8 19.2v-7', width: 2.4 },
  f: { d: 'M3.6 8.4a2.2 2.2 0 0 1 2.2-2.2h3.1l2 2.3h7.3a2.2 2.2 0 0 1 2.2 2.2v6.9a2.2 2.2 0 0 1-2.2 2.2H5.8a2.2 2.2 0 0 1-2.2-2.2z' },
}

export function NavIcon({ view, size = 22, active = false }: {
  view: ViewType
  size?: number
  active?: boolean
}) {
  const spec = SIMPLE[view]
  const common = {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor',
    // A shade heavier when lit, so the icon carries some of the selection
    // rather than leaving all of it to the colour.
    strokeWidth: (spec?.width ?? 1.7) + (active ? 0.3 : 0),
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    style: { display: 'block' },
  }

  if (view === 't') {
    return (
      <svg {...common} aria-hidden>
        {[7, 12, 17].map(y => <circle key={y} cx="5" cy={y} r="1.1" fill="currentColor" stroke="none" />)}
        <path d="M9.5 7h9.5M9.5 12h9.5M9.5 17h6" />
      </svg>
    )
  }
  if (view === 'b') {
    return (
      <svg {...common} aria-hidden>
        <rect x="3.3" y="4.8" width="17.4" height="14.4" rx="2.4" />
        <path d="M9.1 4.8v14.4M14.9 4.8v14.4" />
      </svg>
    )
  }
  if (view === 'c') {
    return (
      <svg {...common} aria-hidden>
        <rect x="3.4" y="5.2" width="17.2" height="15.2" rx="2.6" />
        <path d="M3.4 9.6h17.2M8.2 3.4v3.4M15.8 3.4v3.4" />
        <circle cx="8.6" cy="14.4" r="1.15" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  return (
    <svg {...common} aria-hidden>
      <path d={spec?.d ?? ''} />
    </svg>
  )
}
