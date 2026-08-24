import { get, ref, set as fbSet, update as fbUpdate } from 'firebase/database'
import { db } from './firebase'
import { P } from './paths'
import { getStartPageToken, listChanges, TOKEN_EXPIRED, type DriveChange } from './googleDrive'
import { useDriveStore } from '../store/driveStore'
import { useAuthStore } from '../store/authStore'
import { useTaskStore } from '../store/taskStore'
import { isAssignedTo } from './utils'
import type { Notice } from './notify'
import type { Task } from '../types'

/**
 * ── 밖에서 온 알림 ───────────────────────────────────────────────────────────
 *
 * 받은 알림에 외부 앱을 들일 때 가장 쉬운 길은 전부 그대로 흘려보내는
 * 것입니다. 슬랙 멘션, 메일, 드라이브 댓글 — 그렇게 하면 일주일 안에 아무도
 * 이 목록을 안 엽니다. 슬랙 알림은 슬랙이 더 잘 보여 주고, 메일은 메일함이
 * 더 잘 보여 줍니다. 여기서 굳이 다시 볼 이유가 없습니다.
 *
 * **여기서만 할 수 있는 말이 하나 있습니다.** "지금 바뀐 그 파일이, 당신이
 * 들고 있는 어느 업무에 붙어 있는가." 드라이브는 파일이 바뀌었다는 것까지만
 * 압니다 — 그게 '3화 대본 검수'에 붙어 있다는 건 이 앱만 압니다. 그래서
 * 드라이브부터 넣고, 그것도 **내가 담당인, 안 끝난 업무에 붙은 파일**만
 * 봅니다.
 *
 * 그리고 줄을 누르면 파일이 아니라 **업무**가 열립니다. 파일만 열면 드라이브
 * 알림과 똑같아지고, 이 줄이 여기 있을 이유가 없어집니다.
 *
 * ── 값 ──
 *
 * 파일마다 물어보면 마흔 개에 마흔 번입니다. 대신 드라이브 변경 목록을
 * 씁니다 — 파일이 몇 개든 한 번, 지난번 이후 것만. 처음 켜는 날에는 표식만
 * 찍어 두고 아무것도 안 알립니다. 안 그러면 첫 실행에 마흔 개가 쏟아집니다.
 */

/** 같은 파일로 다시 알리기까지. 하루 종일 고치는 문서 하나가 목록을 먹습니다. */
const QUIET_MS = 6 * 60 * 60 * 1000

/** 몇 분마다 물어보는가. 파일 수정은 초 단위로 급한 일이 아닙니다. */
export const POLL_MS = 5 * 60 * 1000

/** 한 번에 남길 알림 수. 폴더 하나를 통째로 옮기면 백 개가 한꺼번에 옵니다. */
const MAX_PER_POLL = 8

interface WatchState {
  token?: string
  seen?: Record<string, number>
}

/**
 * 이 기기에서 파일 변경을 확인할지.
 *
 * 알림 자체는 사람에게 남으므로, 폰에서 끄고 노트북에서 켜 두면 여전히
 * 옵니다 — 끄는 것은 '이 기기가 확인하는 일'이지 '알림을 안 받는 것'이
 * 아닙니다. 설정 창의 문구가 그렇게 말합니다.
 */
const OFF_KEY = 'drive_watch_off'

export function fileWatchEnabled(): boolean {
  try { return localStorage.getItem(OFF_KEY) !== '1' } catch { return true }
}

export function setFileWatchEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(OFF_KEY)
    else localStorage.setItem(OFF_KEY, '1')
  } catch { /* private mode */ }
}

/** 지켜볼 파일: 내가 담당인 안 끝난 업무에 붙은 드라이브 파일. */
function watched(): Map<string, Task> {
  const { email } = useAuthStore.getState()
  const out = new Map<string, Task>()
  for (const task of useTaskStore.getState().tasks) {
    if (task.status === '완료') continue
    if (!task.links?.length) continue
    if (!isAssignedTo(task.assignee ?? '', email)) continue
    for (const link of task.links) {
      // 같은 파일이 두 업무에 붙어 있으면 먼저 만난 쪽으로 갑니다. 줄을
      // 두 개 남기는 것보다 낫습니다 — 바뀐 건 한 번이니까요.
      if (link.driveId && !out.has(link.driveId)) out.set(link.driveId, task)
    }
  }
  return out
}

function noticeFor(change: DriveChange, task: Task, at: number): Notice {
  return {
    id: '',   // 쓰는 곳에서 키가 정해집니다
    kind: change.removed ? 'file_removed' : 'file_changed',
    by: change.by?.displayName || '드라이브',
    taskId: task.id,
    taskName: task.name,
    projectId: task.projectId,
    detail: change.name || '파일',
    at,
  }
}

/** 여러 기기가 같은 변경을 봐도 줄은 하나여야 합니다 — 키를 값에서 만듭니다. */
function noticeKey(change: DriveChange): string {
  const stamp = change.modifiedTime ? Date.parse(change.modifiedTime) : 0
  return `dr_${change.fileId}_${Number.isFinite(stamp) ? stamp : 0}`
}

let running = false

/**
 * 한 바퀴. 드라이브가 연결돼 있지 않으면 조용히 아무것도 안 합니다 — 이건
 * 켜 놓은 사람에게 얹히는 기능이지, 연결하라고 조르는 기능이 아닙니다.
 */
export async function pollDriveChanges(): Promise<void> {
  if (running) return
  if (!fileWatchEnabled()) return
  const email = useAuthStore.getState().email
  if (!email) return

  const files = watched()
  // 붙여 둔 파일이 없으면 물어볼 것도 없습니다. 표식도 안 만듭니다 —
  // 파일을 처음 붙이는 날 표식이 생기고, 그날부터 셉니다.
  if (files.size === 0) return

  const token = await useDriveStore.getState().ensureToken()
  if (!token) return

  running = true
  try {
    const path = P.driveWatch(email)
    const state: WatchState = (await get(ref(db, path))).val() ?? {}

    // 처음입니다. 지금을 기준으로 삼고 끝냅니다 — 오늘 이전의 모든 수정을
    // '방금 일어난 일'로 알리면 첫 인상이 스팸입니다.
    if (!state.token) {
      await fbSet(ref(db, `${path}/token`), await getStartPageToken(token))
      return
    }

    const { changes, nextToken, caughtUp } = await listChanges(token, state.token)
    // 못 따라잡았으면 나머지는 버리고 지금으로 옮깁니다. 장부가 아닙니다.
    const advance = caughtUp ? nextToken : await getStartPageToken(token)

    const now = Date.now()
    const seen = state.seen ?? {}
    const me = email.toLowerCase()
    const patch: Record<string, unknown> = { token: advance }
    let left = MAX_PER_POLL

    // 같은 파일이 열 번 바뀌었으면 마지막 것만. 앞의 아홉 개는 이미 지난 일입니다.
    const latest = new Map<string, DriveChange>()
    for (const change of changes) {
      if (files.has(change.fileId)) latest.set(change.fileId, change)
    }

    for (const [fileId, change] of latest) {
      if (left <= 0) break
      // 내가 고친 파일은 내가 압니다.
      if (change.by?.emailAddress?.toLowerCase() === me) continue
      if (now - (seen[fileId] ?? 0) < QUIET_MS) continue
      const task = files.get(fileId)!
      const notice = noticeFor(change, task, now)
      const { id: _drop, ...payload } = notice
      for (const key of Object.keys(payload)) {
        if ((payload as Record<string, unknown>)[key] === undefined) {
          delete (payload as Record<string, unknown>)[key]
        }
      }
      await fbSet(ref(db, `${P.notices(email)}/${noticeKey(change)}`), payload)
      patch[`seen/${fileId}`] = now
      left--
    }

    // 이제 안 보는 파일의 기록은 지웁니다. 안 그러면 이 칸만 영원히 자랍니다.
    for (const fileId of Object.keys(seen)) {
      if (!files.has(fileId)) patch[`seen/${fileId}`] = null
    }

    await fbUpdate(ref(db, path), patch)
  } catch (e) {
    // 알림이 하나 안 온 것이지, 앱이 잘못된 게 아닙니다. 화면에 띄우지 않습니다.
    if (e instanceof Error && e.message === TOKEN_EXPIRED) {
      useDriveStore.setState({ token: null, expiry: null })
    }
    console.warn('[driveWatch]', e)
  } finally {
    running = false
  }
}
