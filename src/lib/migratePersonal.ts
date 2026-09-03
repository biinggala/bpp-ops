// 개인 데이터를 **주소 열쇠에서 계정 열쇠로** 옮깁니다. 한 사람에게 한 번.
//
// 데일리 노트·개인 설정·드라이브 감시는 이메일(`heegun@bpp,co,kr`)을 열쇠로
// 저장돼 있었습니다. 주소는 사람이 아닙니다 — 퇴사자 주소를 신입에게 다시
// 내주면 신입이 전임자의 노트와 설정을 그대로 물려받고, 주소를 바꾼 사람은
// 자기 노트를 잃습니다. 계정(uid)은 구글이 사람마다 하나 주고 다시 안 씁니다.
//
// 그래서 로그인할 때 옛 자리에 있는 것을 새 자리로 옮기고 옛 자리는 지웁니다.
// 새 자리에 이미 무엇이 있으면 옛 것은 건드리지 않습니다 — 옮기다 실패해 둘이
// 반쯤 있는 상태에서 다시 로그인했을 때 새 것을 옛 것으로 덮으면 안 됩니다.
//
// 규칙은 두 열쇠를 다 허락합니다(자기 uid 또는 자기 주소). 옛 자리를 읽고
// 지울 수 있어야 옮길 수 있으니까요. 모두가 한 번씩 로그인하고 나면 주소
// 갈래는 닫아도 됩니다.

import { get as fbGet, ref, remove, set as fbSet } from 'firebase/database'
import { db } from './firebase'
import { emailKey } from './paths'

/** 주소 열쇠로 저장되던 개인 노드들. */
export const PERSONAL_NODES = ['dailyNotes', 'userPrefs', 'driveWatch'] as const

export async function migratePersonal(uid: string, email: string): Promise<void> {
  const old = emailKey(email)
  if (!old || old === uid) return
  await Promise.all(PERSONAL_NODES.map(async node => {
    try {
      const mine = await fbGet(ref(db, `${node}/${uid}`))
      if (mine.exists()) return
      const legacy = await fbGet(ref(db, `${node}/${old}`))
      if (!legacy.exists()) return
      await fbSet(ref(db, `${node}/${uid}`), legacy.val())
      await remove(ref(db, `${node}/${old}`))
    } catch (e) {
      // 옮기지 못하면 다음 로그인에 다시 시도합니다. 옛 자리는 그대로 있습니다.
      console.warn('[migrate]', node, e)
    }
  }))
}
