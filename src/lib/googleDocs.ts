// Google Docs, read-only — for tabs, and only for tabs.
//
// A Doc can hold several tabs, and Drive knows nothing about them: its search
// says the document mentions your term, its export hands back the text with no
// seam where one tab ends and the next begins, and its link opens whichever tab
// the reader last had open. For a 기획 / 대본 / 일정 document that is most of
// the way to not having found anything.
//
// The Docs API is the only thing that can name the tab a passage sits in. It is
// a separate API and a separate scope, so everything here degrades: if the call
// is refused, the attachment is still made — just to the document rather than
// to the tab.

export const DOCS_SCOPE = 'https://www.googleapis.com/auth/documents.readonly'

export interface DocTab {
  /** Already carries its `t.` prefix, so it drops straight into ?tab=. */
  tabId: string
  title: string
  text: string
}

interface RawTab {
  tabProperties?: { tabId?: string; title?: string }
  documentTab?: { body?: { content?: unknown[] } }
  childTabs?: RawTab[]
}

/** Pulls the runs of text out of a tab's body, ignoring structure. */
function textOf(node: unknown): string {
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    if (typeof o.content === 'string') return o.content
    return Object.values(o).map(textOf).join('')
  }
  return ''
}

function flatten(tabs: RawTab[] | undefined, out: DocTab[] = []): DocTab[] {
  for (const t of tabs ?? []) {
    const id = t.tabProperties?.tabId
    if (id) {
      out.push({
        tabId: id,
        title: t.tabProperties?.title?.trim() || '제목 없는 탭',
        text: textOf(t.documentTab?.body?.content),
      })
    }
    // Tabs nest; a passage in a sub-tab still needs its own link.
    flatten(t.childTabs, out)
  }
  return out
}

export const DOCS_UNAVAILABLE = 'DOCS_API_UNAVAILABLE'

/**
 * Every tab of a document, in order, with its text.
 *
 * `includeTabsContent` is required: without it the API answers with only the
 * first tab, in a legacy field, and everything below silently looks like a
 * one-tab document.
 */
/**
 * ── 필요한 것만 달라고 합니다 ────────────────────────────────────────────────
 *
 * 그냥 부르면 이 API는 문서를 **구조가 붙은 채로** 돌려줍니다 — 글자 한 줄마다
 * 글꼴·크기·색·자간·정렬이 객체로 딸려 옵니다. 우리가 쓰는 건 그중
 * `textRun.content` 하나뿐인데, 글자만 십만 자인 속기록이 수십 메가가 됩니다.
 * 그걸 회선으로 끌어오는 시간이 '내용 불러오는 중…'의 대부분이었습니다.
 *
 * 표 안의 글자도 같이 받습니다. 대본과 미팅록은 표로 적히는 일이 많고, 그걸
 * 빼면 **찾을 수 있던 문장을 못 찾게** 됩니다 — 빨라지자고 답을 잃는 셈입니다.
 *
 * 탭은 세 겹까지. 마스크는 재귀를 못 쓰므로 손으로 겹칩니다.
 */
const P_TEXT = 'paragraph(elements(textRun(content)))'
const TABLE = `table(tableRows(tableCells(content(${P_TEXT}))))`
const LEAF = `tabProperties(tabId,title),documentTab(body(content(${P_TEXT},${TABLE})))`
const TAB_FIELDS = `tabs(${LEAF},childTabs(${LEAF},childTabs(${LEAF})))`

export async function fetchDocTabs(token: string, documentId: string, signal?: AbortSignal): Promise<DocTab[]> {
  /**
   * `prettyPrint=false`는 공짜로 얻는 것입니다.
   *
   * 구글 API는 기본이 **들여쓴 JSON**입니다. 사람이 읽으라고 줄바꿈과 공백을
   * 넣어 주는데, 이걸 읽는 건 코드고 문서 하나에 글자 조각이 수천 개라 그
   * 여백만 수 메가가 됩니다.
   */
  const url = (fields?: string) =>
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}?includeTabsContent=true&prettyPrint=false`
    + (fields ? `&fields=${encodeURIComponent(fields)}` : '')

  const ask = async (fields?: string) => {
    const res = await fetch(url(fields), { headers: { Authorization: `Bearer ${token}` }, signal })
    if (!res.ok) return null
    return flatten((await res.json() as { tabs?: RawTab[] }).tabs)
  }

  const lean = await ask(TAB_FIELDS)
  // 마스크가 통했고 글자도 들어 있으면 그걸 씁니다.
  if (lean?.some(t => t.text)) return lean

  /**
   * 안 통했으면 **한 번 더, 원래대로** 묻습니다.
   *
   * 마스크는 우리가 쓴 것이고 구글이 언제든 형태를 바꿀 수 있습니다. 그때
   * 조용히 '탭 없음'으로 답하면, 탭 안에 있는 문장은 영영 안 찾아지는데
   * 화면에는 아무 말도 안 뜹니다. 느린 편이 못 찾는 것보다 낫습니다.
   */
  const full = await ask()
  // 403은 API가 꺼져 있거나 토큰이 그 범위를 받기 전이라는 뜻이고, 401은
  // 만료입니다. 자료를 붙이는 사람 앞에 세울 오류가 아니라, 부른 쪽이 문서
  // 단위 링크로 물러납니다.
  if (!full) throw new Error(DOCS_UNAVAILABLE)
  return full
}

/** A document URL that opens on one tab. */
export function docTabUrl(documentId: string, tabId: string): string {
  return `https://docs.google.com/document/d/${documentId}/edit?tab=${encodeURIComponent(tabId)}`
}
