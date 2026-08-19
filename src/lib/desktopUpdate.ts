import { isDesktopShell, invokeDesktop } from './desktopAuth'

/**
 * ── Telling the desktop app it is out of date ────────────────────────────────
 *
 * The shell loads the deployed web app, so everything anybody actually uses is
 * already current the moment the web deploys. What goes stale is the binary
 * around it — rarely, but silently, and nobody re-downloads a .dmg on a hunch.
 *
 * So the deployed web bundle carries the version it was built from, and the
 * shell compares that against its own. The comparison costs one small file and
 * needs no update server: the app is already loading from the place that knows.
 *
 * It reports rather than installs. The build is unsigned and the repository is
 * private, so an in-place download would be a login prompt inside a webview —
 * the same wall the sign-in flow already has to route around. Opening the
 * release page in the real browser is the honest version of that.
 */

export interface DesktopRelease {
  /** The version the web app was built from, e.g. "1.2.0". */
  version: string
  /** Where to get the build. */
  url: string
}

const MANIFEST = '/desktop-version.json'

/** Higher, lower or the same — numeric part by numeric part. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

/** The shell's own version, from the bundle it was built as. */
export async function runningVersion(): Promise<string | null> {
  if (!isDesktopShell()) return null
  try {
    return await invokeDesktop<string>('app_version')
  } catch {
    return null
  }
}

/** What the deployment says the current build is. */
export async function latestRelease(): Promise<DesktopRelease | null> {
  try {
    // Cache-busted: a stale manifest is worse than none, since it would keep
    // announcing a version that has already been installed.
    const res = await fetch(`${MANIFEST}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as Partial<DesktopRelease>
    return body.version && body.url ? { version: body.version, url: body.url } : null
  } catch {
    return null
  }
}

/**
 * The update to offer, or null when there is nothing to say.
 */
export async function pendingUpdate(): Promise<DesktopRelease | null> {
  const [mine, latest] = await Promise.all([runningVersion(), latestRelease()])
  if (!mine || !latest) return null
  return compareVersions(latest.version, mine) > 0 ? latest : null
}

/** Hands the URL to the real browser; a webview cannot log in to GitHub. */
export async function openInBrowser(url: string): Promise<void> {
  try {
    await invokeDesktop('open_external', { url })
  } catch {
    window.open(url, '_blank', 'noopener')
  }
}
