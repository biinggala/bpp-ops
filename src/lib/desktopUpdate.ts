import { isDesktopShell, invokeDesktop } from './desktopAuth'
import { openExternal } from './desktopLinks'

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
 * Installing is the shell's own job. The .dmg on GitHub sits behind a login the
 * webview cannot pass — the repository is private — so the bundle the updater
 * fetches is published to this same deployment, which is public, and verified
 * by a signature rather than by where it came from. Opening the release page in
 * a browser remains the fallback for a shell too old to have an updater in it.
 */

export { openExternal as openInBrowser }

export interface DesktopRelease {
  /** The version the web app was built from, e.g. "1.2.0". */
  version: string
  /** Where to get the build. */
  url: string
  /** Installers published beside this deployment. Absent before the next release. */
  downloads?: { mac?: string; windows?: string }
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
    return body.version && body.url
      ? { version: body.version, url: body.url, downloads: body.downloads }
      : null
  } catch {
    return null
  }
}

/**
 * ── 이 컴퓨터에 맞는 설치 파일 ───────────────────────────────────────────────
 *
 * 웹으로 들어온 사람에게 앱을 권할 때, 어느 파일을 줄지는 물어볼 일이
 * 아닙니다. 맥에 .exe를 내미는 순간 그 버튼은 안 눌러 본 것만 못합니다.
 *
 * 브라우저가 말하는 것으로만 정합니다 — 애플 실리콘 맥도 사파리·크롬 모두
 * userAgent에 'Mac'이 들어 있고, 우리가 내는 건 유니버설 빌드 하나라
 * 칩까지 알 필요가 없습니다. 아이패드·아이폰은 맥이 아니므로 뺍니다:
 * 거기서는 설치할 수 있는 것이 없고, 이 앱은 이미 브라우저에서 돕니다.
 */
export type DesktopPlatform = 'mac' | 'windows' | null

export function thisPlatform(): DesktopPlatform {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod|Android/.test(ua)) return null
  if (/Mac/.test(ua)) return 'mac'
  if (/Win/.test(ua)) return 'windows'
  return null
}

/**
 * The update to offer, or null when there is nothing to say.
 */
export async function pendingUpdate(): Promise<DesktopRelease | null> {
  const [mine, latest] = await Promise.all([runningVersion(), latestRelease()])
  if (!mine || !latest) return null
  return compareVersions(latest.version, mine) > 0 ? latest : null
}

/** How far along an in-place update is; null while there is no percentage yet. */
export type UpdateProgress = (percent: number | null) => void

/**
 * Downloads and installs the update, then restarts into it.
 *
 * The plugin verifies the bundle's signature before replacing anything, so a
 * tampered file at the endpoint is refused rather than run. Loaded on demand:
 * a browser never fetches this code, and neither does the shell until somebody
 * asks for the update.
 */
export async function installUpdate(onProgress: UpdateProgress): Promise<void> {
  const [{ check }, { relaunch }] = await Promise.all([
    import('@tauri-apps/plugin-updater'),
    import('@tauri-apps/plugin-process'),
  ])

  const update = await check()
  if (!update) throw new Error('설치할 업데이트가 없습니다')

  let total = 0
  let received = 0
  onProgress(null)
  await update.downloadAndInstall(event => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? 0
      received = 0
      onProgress(total ? 0 : null)
    } else if (event.event === 'Progress') {
      received += event.data.chunkLength
      // Held below 100 until the install itself is done, so the bar does not
      // sit full while the bundle is still being swapped in.
      if (total) onProgress(Math.min(99, Math.round((received / total) * 100)))
    } else if (event.event === 'Finished') {
      onProgress(100)
    }
  })

  await relaunch()
}
