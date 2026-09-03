import { haptic } from './haptics'

/**
 * ── 누르고 끄는 것, 마우스와 손가락 모두 ────────────────────────────────────
 *
 * 시간표와 간트의 끌기는 `mousedown → mousemove → mouseup`으로 짜여 있었습니다.
 * 손가락은 그 셋을 안 냅니다 — 손가락으로 끌면 브라우저는 그걸 **스크롤**로
 * 씁니다. 그래서 아이패드에서는 일정을 옮길 수도, 끌어서 만들 수도 없었습니다.
 * 화면이 넓으니 폰용 화면도 안 나오고, 마우스용 화면이 손가락에 그냥 안 답하는
 * 채로 서 있었습니다.
 *
 * 여기서 둘을 한 문으로 받습니다(pointer 이벤트).
 *
 *   마우스   누른 즉시 끌기. 지금까지와 같습니다.
 *   손가락   **길게 누른 뒤** 끌기. 그 전에 움직이면 스크롤로 넘기고 조용히
 *            빠집니다. 길게 눌렸으면 그 순간부터 스크롤을 막고 손을 따라갑니다.
 *
 * 왜 길게 누르는가 — 손가락에는 '누르기'와 '스크롤 시작'이 같은 동작입니다.
 * 즉시 끌면 아무 데도 스크롤할 수 없고, 아예 안 끌면 지금처럼 아무것도 못
 * 합니다. 잠깐 멈춘 손가락은 스크롤하려는 손가락이 아니라는 것이 유일한
 * 갈림길이고, 구글 캘린더의 아이패드 앱도 같은 자리를 씁니다.
 *
 * 스크롤을 막는 방법 — `touch-action`은 손이 닿는 순간 정해져서 나중에 바꿀 수
 * 없습니다. 대신 길게 눌린 뒤에 `touchmove`를 **막습니다**(passive가 아닌
 * 리스너로 preventDefault). 손이 그때까지 안 움직였으니 브라우저도 아직
 * 스크롤을 시작하지 않았고, 그 뒤의 움직임은 우리 것입니다.
 *
 * 탭은 건드리지 않습니다. 길게 누르기 전에 떼면 아무 일도 안 하고 빠지므로,
 * 그 뒤의 click은 원래대로 옵니다 — 일정을 톡 치면 카드가 열립니다.
 */

export interface PressPoint { x: number; y: number }

export interface Press {
  /** 끌기가 정말 시작될 때. 마우스는 누른 즉시, 손가락은 길게 누른 뒤. */
  onStart?: (p: PressPoint) => void
  onMove: (p: PressPoint) => void
  onEnd: (p: PressPoint) => void
  /** 스크롤이 되어 버렸거나, 창이 포커스를 잃었거나, 길게 누르기 전에 뗐을 때. */
  onCancel?: () => void
}

export interface PressOptions {
  /** 손가락이 이만큼 멈춰 있어야 끌기입니다(ms). */
  hold?: number
  /** 그 전에 이만큼 움직이면 스크롤입니다(px). */
  slop?: number
}

const HOLD = 280
const SLOP = 8

type Down = { pointerId: number; pointerType: string; clientX: number; clientY: number; button: number }

/** 누르기를 시작합니다. 시작할 수 없는 누름(오른쪽 버튼)이면 false. */
export function beginPress(e: Down, press: Press, opts: PressOptions = {}): boolean {
  if (e.button !== 0) return false
  const id = e.pointerId
  const touch = e.pointerType === 'touch' || e.pointerType === 'pen'
  const at = (ev: PointerEvent): PressPoint => ({ x: ev.clientX, y: ev.clientY })
  const origin = { x: e.clientX, y: e.clientY }

  let armed = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const block = (ev: TouchEvent) => { if (armed && ev.cancelable) ev.preventDefault() }

  const teardown = () => {
    if (timer) { clearTimeout(timer); timer = null }
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('blur', cancel)
    window.removeEventListener('contextmenu', cancel)
    window.removeEventListener('touchmove', block)
  }
  const cancel = () => { teardown(); press.onCancel?.() }

  const arm = (p: PressPoint) => {
    armed = true
    if (touch) haptic('longPress')
    press.onStart?.(p)
  }

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    if (!armed) {
      // 길게 누르기 전의 움직임은 스크롤입니다. 우리 것이 아니니 손을 뗍니다.
      if (Math.abs(ev.clientX - origin.x) > (opts.slop ?? SLOP) || Math.abs(ev.clientY - origin.y) > (opts.slop ?? SLOP)) cancel()
      return
    }
    press.onMove(at(ev))
  }
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    const was = armed
    const p = at(ev)
    teardown()
    // 길게 누르기 전에 뗀 것은 탭입니다. 아무 일도 안 하고, click이 그대로 옵니다.
    if (was) press.onEnd(p); else press.onCancel?.()
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  // 창이 포커스를 잃거나(다른 앱으로 감) 메뉴가 뜨면 up이 안 옵니다. 그때는
  // 옮기던 것을 되돌립니다 — 붙잡힌 채로 남는 것보다 낫습니다.
  window.addEventListener('blur', cancel)
  window.addEventListener('contextmenu', cancel)

  if (touch) {
    // passive: false 여야 preventDefault가 듭니다. 길게 눌리기 전에는 아무것도
    // 안 하므로(armed가 거짓) 스크롤을 방해하지 않습니다.
    window.addEventListener('touchmove', block, { passive: false })
    timer = setTimeout(() => { timer = null; arm(origin) }, opts.hold ?? HOLD)
  } else {
    arm(origin)
  }
  return true
}

/**
 * 길게 누르기만. 끌지는 않습니다 — 우클릭 메뉴를 손가락으로 여는 데 씁니다.
 * 마우스에는 아무 일도 안 합니다(마우스는 우클릭이 있습니다).
 */
export function beginLongPress(e: Down, onFire: (p: PressPoint) => void, opts: PressOptions = {}): void {
  if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
  beginPress(e, {
    onStart: p => { onFire(p) },
    onMove: () => {},
    onEnd: () => {},
  }, { hold: opts.hold ?? 450, slop: opts.slop })
}
