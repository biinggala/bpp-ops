/**
 * 정원을 셋이 나눠 앉는 법 — 이름, 폴더, 내용. 값만 받고 값만 돌려줍니다.
 *
 * 이름 일치가 먼저 다 들어가면 나머지 둘은 한 줄도 못 섭니다. 그런데 흔한
 * 낱말일수록 답은 그 나머지 쪽에 있습니다 — 이름만으로 찾을 수 있었으면
 * 애초에 검색이 필요 없습니다.
 *
 * 자리를 떼어 두되 **비워 두지는 않습니다.** 폴더가 하나뿐이면 한 자리만
 * 떼고, 나머지는 이름 일치가 씁니다.
 */
export function shareSeats(
  { limit, taken, named, folders, term }: { limit: number; taken: number; named: number; folders: number; term: boolean },
): { named: number; folders: number } {
  const left = Math.max(0, limit - taken)
  if (!term) return { named: left, folders: 0 }
  const forFolders = Math.min(folders, Math.max(1, Math.floor(limit / 6)))
  const forText = Math.min(6, Math.floor(limit / 3))
  return {
    folders: forFolders,
    named: Math.max(0, left - forFolders - forText),
  }
}