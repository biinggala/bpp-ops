// 찾은 것들을 **어떤 순서로 세우나**. 값만 받고 값만 돌려줍니다.
//
// 정원(driveSeats)과 순서(여기)는 다른 일입니다. 정원은 '무엇을 가져오나',
// 순서는 '무엇을 먼저 보여 주나' — 갈라 두면 하나를 고칠 때 다른 하나가
// 안 흔들립니다.
//
// ── 왜 필요한가 ─────────────────────────────────────────────────────────────
//
// 구글이 준 순서를 그대로 썼습니다. 그런데 그 순서에는 **내가 요즘 무엇을
// 하고 있는지**가 거의 안 실립니다. '버킷리스트'를 치면 반년 전에 끝난
// 시즌의 체크리스트가 위에 서고, 이번 주 내내 열어 본 이번 화 문서는
// 스크롤을 내려야 나왔습니다.
//
// 사람이 검색창에 이름 몇 자를 치는 상황은 대개 **지금 하는 일**의 한가운데
// 입니다. 그래서 세 가지를 같이 셉니다: 내가 최근에 연 것, 최근에 바뀐 것,
// 그리고 지금 서 있는 프로젝트의 폴더 안에 있는 것.
//
// 옛 파일이 사라지지는 않습니다. 순서만 뒤로 갑니다 — 옛일을 다시 찾는 것도
// 찾기의 절반이니까요.

export interface Rankable {
  id: string
  name: string
  modifiedTime?: string
  /** 내가 이 파일을 마지막으로 연 때. 한 번도 안 열었으면 없습니다. */
  viewedByMeTime?: string
  parents?: string[]
  /** 이름이 아니라 내용에 걸린 것. */
  contentMatch?: boolean
}

/**
 * 얼마나 최근인가 — 1(방금)에서 0(아득함) 사이.
 *
 * 반감기입니다. '30일 전 것은 절반쯤 쳐준다'는 식이라, 하루 지날 때마다
 * 순위가 덜컥거리지 않고 서서히 내려갑니다. 날짜를 잘라 '한 달 안/밖'으로
 * 가르면 31일째 되는 날 파일이 목록에서 사라진 것처럼 보입니다.
 */
export function freshness(iso: string | undefined, now: number, halfLifeDays: number): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 0
  const days = (now - t) / 86_400_000
  if (days <= 0) return 1
  return Math.pow(0.5, days / halfLifeDays)
}

/** 이름에 그대로 든 낱말인가 — 처음이면 더. '포포 3화'는 '포포'로 찾는 이름입니다. */
function nameScore(name: string, term: string): number {
  if (!term) return 0
  const n = name.toLowerCase()
  const t = term.toLowerCase().trim()
  const at = n.indexOf(t)
  if (at < 0) return 0
  return at === 0 ? 1 : 0.6
}

export interface RankContext {
  now: number
  /** 지금 서 있는 프로젝트의 드라이브 폴더들. 없으면 빈 배열. */
  folderIds?: string[]
  term: string
}

/**
 * 한 줄의 점수. 크면 위입니다.
 *
 * 무게는 이렇게 읽으면 됩니다 — 찾는 낱말이 **이름에 그대로 든 파일**이 가장
 * 세고(그게 검색어의 뜻이니까요), 그다음이 내가 요즘 연 것, 지금 프로젝트
 * 폴더 안에 있는 것, 최근에 바뀐 것 순입니다.
 *
 * 이름에 걸린 것과 내용에 걸린 것 사이에도 한 칸을 둡니다. 내용 일치는
 * 이름만으로는 못 찾는 것을 건져 주지만, 이름이 그 이름인 파일보다 앞에
 * 서면 사람이 방금 친 낱말이 무시당한 것처럼 보입니다.
 */
export function scoreOf(file: Rankable, ctx: RankContext): number {
  const inFolder = (ctx.folderIds ?? []).some(id => file.parents?.includes(id))
  return (
    (file.contentMatch ? 0 : 1.2) +
    1.6 * freshness(file.viewedByMeTime, ctx.now, 30) +
    0.9 * freshness(file.modifiedTime, ctx.now, 60) +
    (inFolder ? 1.1 : 0) +
    1.5 * nameScore(file.name, ctx.term)
  )
}

/**
 * 점수순으로 다시 세웁니다. 점수가 같으면 **원래 순서**입니다 — 구글의 판단을
 * 버리는 게 아니라, 우리가 아는 것을 얹는 것입니다.
 */
export function rankFiles<T extends Rankable>(files: T[], ctx: RankContext): T[] {
  return files
    .map((f, i) => ({ f, i, s: scoreOf(f, ctx) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(x => x.f)
}
