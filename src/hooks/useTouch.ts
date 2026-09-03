import { useSyncExternalStore } from 'react'

/**
 * 손가락이 닿은 기기인가. `lib/pointerKind`가 첫 접촉에 문서에 표를 다는데,
 * 그 표를 화면이 읽어야 할 때 씁니다 — hover 뒤에 숨겨 둔 단추를 꺼내 놓는
 * 자리들입니다. 손가락으로는 닿을 수 없는 단추는 없는 단추니까요.
 *
 * 폭으로 재지 않습니다. 아이패드는 넓고, 손가락입니다.
 */
function read(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.touch === '1'
}

function subscribe(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  const mo = new MutationObserver(onChange)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-touch'] })
  return () => mo.disconnect()
}

export function useTouch(): boolean {
  return useSyncExternalStore(subscribe, read, () => false)
}
