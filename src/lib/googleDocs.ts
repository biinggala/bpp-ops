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
export async function fetchDocTabs(token: string, documentId: string): Promise<DocTab[]> {
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}?includeTabsContent=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  // 403 here means the API is off or the token predates the scope; 401 means a
  // stale token. Neither is worth an error in front of somebody attaching a
  // file — the caller falls back to a document-level link.
  if (!res.ok) throw new Error(DOCS_UNAVAILABLE)
  const body = await res.json() as { tabs?: RawTab[] }
  return flatten(body.tabs)
}

/** A document URL that opens on one tab. */
export function docTabUrl(documentId: string, tabId: string): string {
  return `https://docs.google.com/document/d/${documentId}/edit?tab=${encodeURIComponent(tabId)}`
}
