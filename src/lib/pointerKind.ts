/**
 * ── 손가락인가 마우스인가 ────────────────────────────────────────────────────
 *
 * 지우는 ×는 손이 그 줄에 왔을 때만 보입니다. 그런데 hover가 없는 기기에서는
 * 늘 보여야 합니다 — 손가락으로는 닿을 수 없는 단추는 없는 단추니까요.
 *
 * 그걸 `@media (hover: hover)`로 물었다가 두 번 틀렸습니다. 처음엔 숨기는
 * 규칙을 그 안에 통째로 넣어서, 아니라고 답하는 환경에서는 **숨기는 규칙
 * 자체가 없어졌습니다**. 다음엔 뒤집어서 `(hover: none) and (pointer: coarse)`
 * 로 물었는데, 그것도 그렇다고 답했습니다. 마우스는 멀쩡히 움직이는데요.
 *
 * 그래서 묻기를 그만두고 **봅니다.** 진짜 손가락이 닿으면 pointerdown이
 * `pointerType: 'touch'`로 옵니다. 마우스는 그 값을 절대 안 냅니다 — 기기가
 * 자기를 뭐라고 소개하든, 실제로 닿은 것이 무엇인지는 못 속입니다.
 *
 * 첫 접촉 전까지는 숨어 있습니다. 폰에서도 그런데, 그 첫 탭이 곧 `:hover`를
 * 붙여 주므로(웹킷) ×는 그 자리에서 보이고 다음 탭에 눌립니다 — 구글 지도의
 * 첫 탭과 같습니다. 그리고 그 순간 표가 달려서 두 번 다시 안 숨습니다.
 */
export function watchPointerKind(): void {
  const mark = () => {
    document.documentElement.dataset.touch = '1'
    window.removeEventListener('pointerdown', onPointer, true)
    window.removeEventListener('touchstart', mark, true)
  }
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') mark()
  }
  window.addEventListener('pointerdown', onPointer, { capture: true, passive: true })
  // pointer 이벤트가 없는 옛 웹킷을 위한 두 번째 귀. 둘 중 먼저 오는 것이 답합니다.
  window.addEventListener('touchstart', mark, { capture: true, passive: true })
}
