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
 * 설치 파일을 웹 배포로 같이 올리고(`/downloads/…`), 그 주소는
 * `desktop-version.json`이 들고 있습니다.
 *
 * **없으면 아무것도 안 보입니다.** 다음 릴리즈 전까지 그 파일은 아직
 * 없습니다. 눌리는 버튼을 두고 404를 주는 것보다, 준비된 다음에 나타나는
 * 편이 낫습니다.
 *
 * 이 앱은 껍데기만 다운로드입니다 — 화면은 배포된 웹을 그대로 불러옵니다.
 * 그래서 "받으면 뭐가 달라지나"에 답할 수 있어야 하고, 그 답을 한 줄로
 * 적어 둡니다. 답이 없으면 굳이 권할 이유도 없습니다.
 */

const WHY: Record<Exclude<DesktopPlatform, null>, string> = {
  mac: '독에 두고 바로 열 수 있고, 알림이 맥 알림으로 옵니다',
  windows: '작업 표시줄에 두고 바로 열 수 있고, 알림이 윈도우 알림으로 옵니다',
}

const LABEL: Record<Exclude<DesktopPlatform, null>, string> = {
  mac: 'macOS용 내려받기',
  windows: 'Windows용 내려받기',
}

export function GetDesktopApp({ variant = 'card', onPick }: {
  /** 'card' 는 설정의 한 줄, 'menu' 는 계정 팝오버의 한 줄. */
  variant?: 'card' | 'menu'
  /** 메뉴에서 눌렀을 때 그 메뉴를 닫는 것은 부르는 쪽 일입니다. */
  onPick?: () => void
} = {}) {
  const platform = thisPlatform()
  const [url, setUrl] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    if (isDesktopShell() || !platform) return
    let alive = true
    void latestRelease().then(release => {
      if (!alive || !release) return
      const href = release.downloads?.[platform]
      if (!href) return
      setUrl(href)
      setVersion(release.version)
    })
    return () => { alive = false }
  }, [platform])

  if (isDesktopShell() || !platform || !url) return null

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
          {WHY[platform]}{version ? ` · ${version}` : ''}
        </span>
      </span>
      {/* 같은 출처의 파일이라 브라우저가 그대로 내려받습니다. 데스크톱
          셸에서는 이 컴포넌트 자체가 없으므로 웹뷰의 그 함정과는 무관합니다. */}
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
