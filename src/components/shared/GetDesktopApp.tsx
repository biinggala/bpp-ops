import { useEffect, useState } from 'react'
import { isDesktopShell } from '../../lib/desktopAuth'
import { latestRelease, thisPlatform, type DesktopPlatform } from '../../lib/desktopUpdate'
import { Icon } from './Icon'

/**
 * ── 데스크톱 앱 받기 ─────────────────────────────────────────────────────────
 *
 * 브라우저로 들어온 사람에게만 보입니다. 앱 안에서 "앱을 받으세요"는 아무
 * 말도 아니고, 폰에서도 뺍니다 — 거기서 설치할 수 있는 것이 없습니다.
 *
 * **파일은 이 배포에서 받습니다.** 깃허브 릴리즈의 .dmg는 저장소 로그인
 * 뒤에 있고 팀의 대부분은 깃허브 계정이 없습니다. 그래서 릴리즈 워크플로가
 * 설치 파일을 웹 배포로 같이 올립니다(release.yml). 이름은 고정입니다 —
 * 그래서 여기 상수로 적어 둘 수 있고, 다음 릴리즈가 같은 자리를 덮습니다.
 *
 * ── 처음엔 매니페스트를 보고 있었습니다 ──────────────────────────────────────
 *
 * `desktop-version.json`에 주소가 적혀 있을 때만 그렸습니다. 아직 파일이 없는
 * 동안 404를 주지 않으려고요. 그런데 그러면 **안 보이는 이유가 화면에 없습니다**
 * — 아직 안 나간 것인지, 내 브라우저가 못 읽은 것인지, 애초에 그런 기능이
 * 없는 것인지 구별이 안 됩니다. 실제로 그렇게 됐고요.
 *
 * 이제 조건 없이 그립니다. 파일은 고정된 자리에 있고, 만에 하나 없으면 눌렀을
 * 때 브라우저가 그렇다고 말해 줍니다. **안 되는 것이 보이는 편**이 안 보이는
 * 것보다 낫습니다 — 뒤엣것은 신고조차 할 수 없습니다.
 *
 * 매니페스트는 버전 숫자를 얻는 데만 씁니다. 못 읽어도 버튼은 그대로 섭니다.
 */

const DOWNLOADS: Record<Exclude<DesktopPlatform, null>, string> = {
  mac: '/downloads/bpp-ops.dmg',
  windows: '/downloads/bpp-ops-setup.exe',
}

const WHY: Record<Exclude<DesktopPlatform, null>, string> = {
  mac: '독에 두고 바로 열 수 있고, 알림이 맥 알림으로 옵니다',
  windows: '작업 표시줄에 두고 바로 열 수 있고, 알림이 윈도우 알림으로 옵니다',
}

const LABEL: Record<Exclude<DesktopPlatform, null>, string> = {
  mac: 'macOS용 내려받기',
  windows: 'Windows용 내려받기',
}

/** 버전 숫자 하나. 없으면 없는 대로 둡니다 — 버튼을 막지 않습니다. */
function useReleaseVersion(enabled: boolean): string | null {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    void latestRelease().then(r => { if (alive && r) setVersion(r.version) })
    return () => { alive = false }
  }, [enabled])
  return version
}

export function GetDesktopApp({ variant = 'card', onPick }: {
  /** 'card' 설정의 한 줄 · 'menu' 계정 팝오버 · 'rail' 사이드바 맨 아래. */
  variant?: 'card' | 'menu' | 'rail'
  /** 메뉴에서 눌렀을 때 그 메뉴를 닫는 것은 부르는 쪽 일입니다. */
  onPick?: () => void
} = {}) {
  const platform = thisPlatform()
  const show = !isDesktopShell() && !!platform
  const version = useReleaseVersion(show)

  if (!show || !platform) return null
  const url = DOWNLOADS[platform]

  // 같은 출처의 파일이라 브라우저가 그대로 내려받습니다. 데스크톱 셸에서는
  // 이 컴포넌트 자체가 없으므로 웹뷰의 그 함정과는 무관합니다.
  if (variant === 'menu') {
    return (
      <a
        href={url}
        download
        onClick={onPick}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 8px', borderRadius: 'var(--r2)', boxSizing: 'border-box',
          fontSize: 12, color: 'var(--t2)', textDecoration: 'none', fontFamily: 'var(--font)',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg2)'; e.currentTarget.style.color = 'var(--t1)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t2)' }}
      >
        <Icon name="monitor" size={14} /> 데스크톱 앱 받기
      </a>
    )
  }

  /**
   * 사이드바 맨 아래 한 줄.
   *
   * 설정 안에만 두었더니 아무도 못 찾았습니다. 앱을 아직 안 받은 사람에게
   * 설정은 들어가 볼 이유가 없는 곳입니다. 여기는 늘 보이되, 프로젝트 목록
   * 아래에 조용히 — 매일 누르는 줄이 아니니까 굵게 서지는 않습니다.
   */
  if (variant === 'rail') {
    return (
      <a
        href={url}
        download
        onClick={onPick}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          // 위쪽 auto — 목록이 짧은 날에도 맨 아래에 섭니다. '홈' 열은 flex:1로
          // 이미 채우지만 '받은 알림' 열은 안 채워서, 그 줄이 목록에 붙었습니다.
          margin: 'auto 6px 6px', padding: '0 8px', minHeight: 28,
          borderRadius: 'var(--r2)', boxSizing: 'border-box',
          fontSize: 13, fontWeight: 500, color: 'var(--sb-t3)',
          textDecoration: 'none', fontFamily: 'var(--font)', flexShrink: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--sb-hover)'; e.currentTarget.style.color = 'var(--sb-t1)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--sb-t3)' }}
      >
        <Icon name="monitor" size={14} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          데스크톱 앱 받기
        </span>
      </a>
    )
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 12px', borderRadius: 'var(--r2)',
      border: '1px solid var(--bd)', background: 'var(--bg2)',
    }}>
      <span style={{ flexShrink: 0, color: 'var(--t3)', display: 'flex' }}>
        <Icon name="monitor" size={18} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, color: 'var(--t1)' }}>데스크톱 앱</span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
          {WHY[platform]}{version ? ` · v${version}` : ''}
        </span>
      </span>
      <a
        href={url}
        download
        style={{
          flexShrink: 0, height: 26, padding: '0 10px', borderRadius: 'var(--r1)',
          border: '1px solid var(--bd)', background: 'transparent',
          fontSize: 12, color: 'var(--t2)', textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center', fontFamily: 'var(--font)',
        }}
      >
        {LABEL[platform]}
      </a>
    </div>
  )
}
