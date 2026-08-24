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
 * ── 프로즈미러가 지운 뒤에 싣습니다 ──────────────────────────────────────────
 *
 * 처음엔 줄의 React `onDragStart`에서 실었습니다. 안 됐습니다 — 프로즈미러의
 * dragstart 처리기가 편집기 뿌리에 붙어 있어서 **내 것보다 나중에** 돌고,
 * 거기서 `dataTransfer.clearData()`를 부릅니다. 자기 형식(text/html + 슬라이스)
 * 만 남기려는 것인데, 그 한 줄이 내가 실어 둔 것도 같이 지웠습니다.
 *
 * 그래서 document에 답니다. 버블 단계의 마지막이라 프로즈미러 다음이고,
 * 지워진 뒤에 싣는 것이라 남습니다. 프로즈미러 것도 그대로 있어서 노트 안에서
 * 줄 순서를 바꾸는 일은 계속 됩니다 — 같은 드래그 하나로 둘 다입니다.
 *
 * 끌 수 있는 줄인지는 DOM이 말합니다(`data-timeblock`). 어느 줄이 끌렸는지를
 * 리액트 상태로 알아내려 하면, 정작 필요한 순간에 그 상태가 어느 줄의 것인지
 * 알 수 없습니다.
 */
export const TIMEBLOCK_ATTR = 'data-timeblock'

export function installTimeblockDrag(): () => void {
  const onDragStart = (event: DragEvent) => {
    const dt = event.dataTransfer
    if (!dt) return
    const target = event.target as Element | null
    const row = target?.closest?.(`[${TIMEBLOCK_ATTR}]`) as HTMLElement | null
    if (!row) return

    const taskId = row.getAttribute('data-timeblock-task') ?? undefined
    // 이름은 적혀 있으면 그것, 아니면 그 줄에 보이는 글자. 체크박스 줄은
    // 사람이 방금 친 글자가 곧 이름입니다.
    const name = (row.getAttribute('data-timeblock-name') ?? row.textContent ?? '').trim()
    if (!name) return
    writeTimeblock(dt, { name, ...(taskId ? { taskId } : {}) })
  }

  document.addEventListener('dragstart', onDragStart)
  return () => document.removeEventListener('dragstart', onDragStart)
}
