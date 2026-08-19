import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * Renders into document.body.
 *
 * position: fixed does not escape a stacking context — it only changes what the
 * coordinates are relative to. These menus sit inside the sticky name cell,
 * which has a z-index of its own, so their z-index of 9000 was compared against
 * that cell's siblings and lost to the milestone header above it. Leaving the
 * tree entirely is the only thing that actually puts them on top.
 */
export function FloatingMenu({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body)
}

/**
 * ── Menu primitives ──────────────────────────────────────────────────────────
 *
 * One shell, one row, one way of drawing "this is selected", for every dropdown
 * in the list. These grew as nine hand-rolled menus: five widths, four row
 * paddings, two z-indexes, and four different selection marks — and the two
 * most-clicked cells (상태, 우선순위) were a native <select>, so they rendered
 * as the operating system's menu rather than the app's.
 *
 * The rule the primitives encode: a leading checkbox means you may pick several,
 * a trailing ✓ means exactly one.
 */
export const MENU_W = 200
export const MENU_GAP = 4

/**
 * Open/close, placement, and outside-click for a dropdown.
 *
 * Two refs, not one: the panel is portalled to document.body, so a click inside
 * it is outside the cell that owns it. Checking only the cell would close a
 * multi-select on the first tick — you could never select two people.
 */
export function useMenu() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 320 })
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return
      // A target that has left the document cannot say anything about where the
      // click landed: it is gone because handling the click re-rendered the menu
      // out from under it. Treating that as "outside" closes the menu on its own
      // first tick — which is exactly what a multi-select must not do.
      if (!t.isConnected) return
      // A date picker is always opened *from* something rather than beside it,
      // so picking a day is not a click outside the menu that opened it — even
      // though the calendar renders into a portal of its own.
      if (t instanceof Element && t.closest('[data-datepicker-popup]')) return
      setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  /**
   * Places the panel next to `el`, kept inside the window.
   *
   * Horizontally it is clamped; vertically it flips above the trigger when
   * there is more room there. Without the flip a tall panel opened from a row
   * near the bottom of the list would just run off the screen, which is exactly
   * where the long ones — the file picker — tend to be opened from.
   */
  const openAt = (el: HTMLElement | null, width = MENU_W, height = 320) => {
    if (!el) return
    const r = el.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - MENU_GAP - 8
    const above = r.top - MENU_GAP - 8
    const flip = below < Math.min(height, 220) && above > below
    setPos({
      top: flip
        ? Math.max(8, r.top - MENU_GAP - Math.min(height, above))
        : r.bottom + MENU_GAP,
      left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8)),
      maxHeight: Math.max(180, flip ? above : below),
    })
    setOpen(true)
  }
  const toggleAt = (el: HTMLElement | null, width = MENU_W, height = 320) =>
    open ? setOpen(false) : openAt(el, width, height)

  return { open, setOpen, pos, rootRef, panelRef, openAt, toggleAt }
}

export function Menu({ pos, panelRef, width = MENU_W, maxHeight, children }: {
  pos: { top: number; left: number; maxHeight?: number }
  panelRef: React.RefObject<HTMLDivElement | null>
  width?: number
  /** Ceiling for this menu; the space actually available still wins. */
  maxHeight?: number
  children: React.ReactNode
}) {
  return (
    <FloatingMenu>
      <div
        ref={panelRef}
        data-addrow-popup
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed', top: pos.top, left: pos.left, width, zIndex: 9000,
          background: 'var(--bg)', border: '1px solid var(--bd)',
          borderRadius: 'var(--r3)', boxShadow: 'var(--sh-md)',
          padding: 4, boxSizing: 'border-box',
          maxHeight: Math.min(maxHeight ?? 320, pos.maxHeight ?? 320),
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </FloatingMenu>
  )
}

/** The scrolling middle of a menu, so headers and footers stay put. */
export function MenuList({ children }: { children: React.ReactNode }) {
  return <div style={{ overflowY: 'auto', minHeight: 0, margin: '0 -4px', padding: '0 4px' }}>{children}</div>
}

export function MenuItem({ selected = false, multi = false, highlighted = false, onSelect, children, trailing }: {
  selected?: boolean
  /** Where the arrow keys currently are — distinct from what is chosen. */
  highlighted?: boolean
  /** Draws the leading checkbox — the signal that more than one may be chosen. */
  multi?: boolean
  onSelect: () => void
  children: React.ReactNode
  trailing?: React.ReactNode
}) {
  return (
    <div
      onMouseDown={e => { e.preventDefault(); onSelect() }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 8px', borderRadius: 'var(--r1)',
        fontSize: 13, cursor: 'pointer', color: 'var(--t1)',
        fontWeight: selected ? 500 : 400,
        background: highlighted ? 'var(--bg3)' : 'transparent',
        transition: 'background .07s', flexShrink: 0,
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
      onMouseLeave={e => (e.currentTarget.style.background = highlighted ? 'var(--bg3)' : 'transparent')}
    >
      {multi && <MenuCheck on={selected} />}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {children}
      </span>
      {trailing}
      {!multi && selected && <span style={{ fontSize: 10, color: 'var(--ac)', flexShrink: 0 }}>✓</span>}
    </div>
  )
}

export function MenuCheck({ on }: { on: boolean }) {
  return (
    <span style={{
      width: 14, height: 14, flexShrink: 0, borderRadius: 3,
      border: `1.5px solid ${on ? 'var(--ac)' : 'var(--bd2)'}`,
      background: on ? 'var(--ac)' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all .1s',
    }}>
      {/* Kept mounted and faded rather than added and removed: the tick is
          small enough that it is often what the pointer is actually over, and a
          node that disappears mid-click takes the click's target with it. */}
      <span style={{ color: '#fff', fontSize: 9, lineHeight: 1, fontWeight: 700, opacity: on ? 1 : 0, transition: 'opacity .1s' }}>✓</span>
    </span>
  )
}

/** A coloured dot — how status, priority and project identity read everywhere else. */
export function Dot({ color, size = 7 }: { color: string; size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', background: color, flexShrink: 0 }} />
}

export function MenuNote({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '8px 8px', fontSize: 12, color: 'var(--t3)' }}>{children}</div>
}

export function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--bd)', margin: '4px -4px' }} />
}

/** The one way to say "clear this field", worded the same as the filter bar. */
export function MenuFooter({ label, onSelect }: { label: string; onSelect: () => void }) {
  return (
    <>
      <MenuDivider />
      <div
        onMouseDown={e => { e.preventDefault(); onSelect() }}
        style={{ padding: '6px 8px', borderRadius: 'var(--r1)', fontSize: 12, color: 'var(--t3)', cursor: 'pointer', flexShrink: 0, transition: 'background .07s' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t2)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
      >
        {label}
      </div>
    </>
  )
}

export const MENU_INPUT: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  border: '1px solid var(--bd)', borderRadius: 'var(--r1)',
  padding: '5px 8px', fontSize: 12,
  background: 'var(--bg2)', color: 'var(--t1)',
  outline: 'none', fontFamily: 'var(--font)',
}

/**
 * Value plus a caret that only appears on hover.
 *
 * Nine columns each showing a permanent ▾ made every row read as a form. The
 * value is the affordance; the caret confirms it when the pointer is there.
 */
export function CellTrigger({ open, onOpen, children, style, tabbable = false }: {
  open: boolean
  onOpen: (el: HTMLElement) => void
  children: React.ReactNode
  style?: React.CSSProperties
  /**
   * Reachable by Tab. Off in the table proper — nobody wants to tab through
   * nine cells times two hundred rows — and on in the add row, where tabbing
   * from field to field is the whole point.
   */
  tabbable?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      tabIndex={tabbable ? 0 : undefined}
      onClick={e => { e.stopPropagation(); onOpen(e.currentTarget) }}
      onKeyDown={tabbable ? e => {
        // Space and ArrowDown open the menu; Enter is left alone while it is
        // closed so it reaches the row and saves. A trigger that answered Enter
        // in both states could be opened and closed forever without the row
        // this sits in ever hearing one.
        if (e.key === ' ' || e.key === 'ArrowDown') {
          if (!open) { e.preventDefault(); e.stopPropagation(); onOpen(e.currentTarget) }
        } else if (e.key === 'Enter' && open) {
          e.preventDefault(); e.stopPropagation()
          onOpen(e.currentTarget)
        }
      } : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', flex: 1, minWidth: 0, ...style }}
    >
      {children}
      <span style={{
        fontSize: 9, color: 'var(--t3)', flexShrink: 0, marginLeft: 'auto',
        opacity: hovered || open ? .6 : 0, transition: 'opacity .1s',
      }}>▾</span>
    </div>
  )
}