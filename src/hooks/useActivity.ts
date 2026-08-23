import { useEffect, useState } from 'react'
import { limitToLast, onValue, query, ref } from 'firebase/database'
import { db } from '../lib/firebase'
import { P } from '../lib/paths'
import type { Activity } from '../lib/activity'

/**
 * A task's history, while somebody is looking at it.
 *
 * Subscribed on demand rather than with the rest of the project: a list of
 * two hundred tasks would otherwise carry two hundred logs nobody asked for.
 * The last fifty entries — beyond that it is an archive, and nothing here is
 * the only copy of anything.
 */
export function useActivity(taskId: string | null, projectId: string | undefined): Activity[] {
  const [entries, setEntries] = useState<Activity[]>([])

  useEffect(() => {
    if (!taskId || !projectId) { setEntries([]); return }
    const q = query(ref(db, P.activity(projectId, taskId)), limitToLast(50))
    return onValue(q, snap => {
      const raw = (snap.val() ?? {}) as Record<string, Omit<Activity, 'id'>>
      setEntries(Object.entries(raw).map(([id, a]) => ({ ...a, id })).sort((a, b) => b.at - a.at))
    }, () => setEntries([]))
  }, [taskId, projectId])

  return entries
}
