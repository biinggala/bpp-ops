/**
 * ── 라이트 · 다크 ────────────────────────────────────────────────────────────
 *
 * Three choices, two outcomes: light, dark, or whatever the machine is set to.
 *
 * The resolution happens here rather than in CSS. A `prefers-color-scheme`
 * media query cannot express "the person chose light on a machine set to dark",
 * so a stylesheet that leans on it needs every rule written twice and guarded.
 * One attribute on `<html>` instead, stamped from here, and the stylesheet has
 * exactly two blocks.
 *
 * **It is a per-device preference.** Fifty people share the projects; nobody
 * shares a screen or the room it is in. This lives in localStorage and never
 * goes near the database — the same line the sidebar's ordering follows.
 */

export type ThemeChoice = 'light' | 'dark' | 'system'

const KEY = 'bpp_theme'

export function themeChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  } catch { /* private mode */ }
  return 'system'
}

function systemIsDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

/** What is actually on screen, after 'system' has been asked. */
export function resolvedTheme(): 'light' | 'dark' {
  const choice = themeChoice()
  return choice === 'system' ? (systemIsDark() ? 'dark' : 'light') : choice
}

function stamp() {
  document.documentElement.dataset.theme = resolvedTheme()
}

export function setTheme(choice: ThemeChoice) {
  try { localStorage.setItem(KEY, choice) } catch { /* private mode */ }
  stamp()
}

/**
 * Applied before React renders, and kept in step afterwards.
 *
 * The listener matters for the 'system' choice: macOS switches at sunset, and
 * an app that only read the setting at launch would sit in the wrong theme
 * until it was reloaded.
 */
export function installTheme(): void {
  stamp()
  window.matchMedia?.('(prefers-color-scheme: dark)')
    .addEventListener?.('change', () => { if (themeChoice() === 'system') stamp() })
}
