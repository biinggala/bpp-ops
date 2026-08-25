/**
 * ── 노트의 체크박스를 밖에서 누르기 ─────────────────────────────────────────
 *
 * 시간 축의 블록에 붙은 네모를 누르면 노트의 그 줄이 눌려야 합니다. 그런데
 * 시간 축은 노트 편집기가 아니라 **저장된 HTML 한 덩어리**를 봅니다(캘린더
 * 화면에서는 편집기가 아예 없습니다). 그래서 여기서는 글자를 고칩니다.
 *
 * **줄은 id로 찾습니다.** 글자로 찾으면 같은 말이 두 줄일 때 엉뚱한 줄이
 * 눌리고, 사람이 줄을 고치는 순간 아무 일도 안 일어나면서 아무 말도 안
 * 해 줍니다. id는 시간을 붙일 때 그 줄에 새겨 둡니다(BlockTools).
 *
 * DOMParser를 씁니다 — 정규식으로 `data-checked`를 갈아 끼우면 줄 안에 그
 * 글자가 들어 있는 노트(체크박스 얘기를 적어 둔 노트)에서 엉뚱한 데를
 * 건드립니다.
 */

/** `날짜|줄id`. 구글 일정에는 칸이 하나뿐이라 한 덩어리로 싣습니다. */
export function noteRefOf(date: string, bid: string): string {
  return `${date}|${bid}`
}

export function parseNoteRef(ref: string | undefined): { date: string; bid: string } | null {
  if (!ref) return null
  const at = ref.indexOf('|')
  if (at <= 0 || at === ref.length - 1) return null
  return { date: ref.slice(0, at), bid: ref.slice(at + 1) }
}

/** 이 줄 하나를 위한 id. 짧고, 한 노트 안에서 겹치지 않을 만큼입니다. */
export function newBlockId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
}

/** 이 노트에 있는 줄 id들의 지금 상태. 없는 id는 지도에 아예 안 들어옵니다. */
export function checksIn(html: string | null): Record<string, boolean> {
  if (!html) return {}
  const out: Record<string, boolean> = {}
  for (const li of parse(html).querySelectorAll('li[data-bid]')) {
    const bid = li.getAttribute('data-bid')
    if (bid) out[bid] = li.getAttribute('data-checked') === 'true'
  }
  return out
}

/**
 * 그 줄을 눌렀다 폈다 합니다.
 *
 * 줄이 없으면 **null**입니다 — 지운 줄일 수도 있고, 오늘 노트가 아직 안 온
 * 것일 수도 있습니다. 둘 다 '아무 일도 안 일어남'이지만, 부르는 쪽이 그걸
 * 알아야 사람에게 말해 줄 수 있습니다. 없는 것을 조용히 성공으로 치지
 * 않습니다.
 */
export function setCheck(html: string | null, bid: string, checked: boolean): string | null {
  if (!html) return null
  const doc = parse(html)
  const li = doc.querySelector(`li[data-bid="${CSS.escape(bid)}"]`)
  if (!li) return null
  li.setAttribute('data-checked', checked ? 'true' : 'false')
  // 화면의 진짜 체크박스도 같이 맞춥니다. tiptap은 다시 읽을 때 data-checked를
  // 보지만, 이 HTML은 검색과 '어제 못 끝낸 것'도 읽습니다.
  const box = li.querySelector('input[type="checkbox"]')
  if (box) {
    if (checked) box.setAttribute('checked', 'checked')
    else box.removeAttribute('checked')
  }
  return doc.body.innerHTML
}
