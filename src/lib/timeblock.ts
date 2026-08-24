/**
 * ── 시간을 붙이는 일 ─────────────────────────────────────────────────────────
 *
 * 노트에 적힌 업무 한 줄을 오른쪽 시간 축으로 끌어다 놓으면, 그 자리에 일정이
 * 생깁니다. 타임블로킹입니다.
 *
 * **왜 옮기지 않고 붙이는가.** 노트가 오늘의 할 일이 사는 곳이고 그건 그대로
 * 둡니다 — 끌어다 놓는다고 노트에서 사라지면, 시간을 정한 일과 아직 안 정한
 * 일이 두 목록으로 갈라집니다. 여기서 만드는 건 '언제 할지'뿐입니다.
 *
 * **그래서 둘을 이어 둡니다.** 일정에는 업무 id가 실려 갑니다(구글 일정의
 * extendedProperties.private — 사람 눈에는 안 보이는 칸이라 초대받은 사람의
 * 화면을 어지럽히지 않습니다). 이어져 있으니 노트의 그 줄이 '몇 시'인지 알고,
 * 두 번 놓으려는 사람에게 이미 잡혀 있다고 말해 줄 수 있습니다.
 *
 * ── 드래그 중에는 내용을 못 읽습니다 ─────────────────────────────────────────
 *
 * dragover에서 `getData`는 빈 문자열을 돌려줍니다(브라우저의 보호 모드). 무엇이
 * 끌려오는지 알 수 있는 건 `types`뿐이라, "받을 수 있는 것인가"는 has로 보고
 * "무엇인가"는 drop에서 read로 봅니다. 이 둘을 한 함수로 만들면 미리보기가
 * 조용히 안 뜹니다.
 */

export const TIMEBLOCK_MIME = 'application/x-bpp-timeblock'

export interface TimeblockDrag {
  /** 진짜 업무를 끌었을 때만. 체크박스 한 줄에는 가리킬 id가 없습니다. */
  taskId?: string
  name: string
}

/** 이 드래그를 시간 축이 받을 수 있는가. dragover에서 쓸 수 있는 유일한 판정. */
export function hasTimeblock(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes(TIMEBLOCK_MIME)
}

export function writeTimeblock(dt: DataTransfer, payload: TimeblockDrag): void {
  try {
    dt.setData(TIMEBLOCK_MIME, JSON.stringify(payload))
    // 노트 안에서의 줄 옮기기는 프로즈미러가 자기 형식으로 따로 챙깁니다.
    // 여기서 더하는 건 밖으로 나가는 몫이라 effect는 복사입니다.
    dt.effectAllowed = 'copyMove'
  } catch { /* 어떤 브라우저는 dragstart 밖에서 거부합니다. 그러면 못 끕니다. */ }
}

export function readTimeblock(dt: DataTransfer | null): TimeblockDrag | null {
  if (!dt) return null
  try {
    const raw = dt.getData(TIMEBLOCK_MIME)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TimeblockDrag>
    if (!parsed.name?.trim()) return null
    return { name: parsed.name.trim(), ...(parsed.taskId ? { taskId: parsed.taskId } : {}) }
  } catch {
    return null
  }
}

/** 기본 길이. 한 시간은 '이 일을 한다'고 말하기에 가장 흔한 크기입니다. */
export const BLOCK_MINUTES = 60

/**
 * ── 어디서 싣는가 ────────────────────────────────────────────────────────────
 *
 * 노트의 줄 자체가 아니라 **왼쪽 손잡이**에서 싣습니다(BlockTools.beginDrag).
 * 줄에 실으려던 시도가 두 번 실패했고, 이유가 둘 다 같은 자리에 있습니다 —
 * 그 줄들은 애초에 끌리지 않습니다. 프로즈미러는 내용이 있는 노드에
 * draggable을 안 붙이고, 커스텀 노드뷰에는 tiptap도 붙이지 않습니다.
 *
 * 손잡이는 편집기 DOM 밖의 진짜 draggable 버튼이라 프로즈미러의 dragstart
 * 처리기가 돌지 않고, 따라서 dataTransfer를 지우지도 않습니다.
 */
