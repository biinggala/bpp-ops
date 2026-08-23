import { useMemo } from 'react'
import { useUiStore } from '../store/uiStore'
import { useAuthStore } from '../store/authStore'
import { useAccessibleTasks } from './useAccessibleTasks'
import { isAssignedTo } from '../lib/utils'
import { useShallow } from 'zustand/react/shallow'

/**
 * Tasks in the current scope — space, project, 내 할 일 — but with none of the
 * selectable filters applied.
 *
 * This is what the filter dropdowns should offer. useAccessibleTasks ignores the
 * scope entirely, so inside one project the 태그 menu listed every tag in the
 * workspace; picking one of the foreign tags returned an empty list and looked
 * like a bug. Scoping to the sidebar's selection fixes that.
 *
 * The selectable filters are deliberately NOT applied: if they were, choosing
 * 담당자 = 희건 would delete every other name from the menu, and there would be
 * no way back to a two-person selection.
 */
export function useScopedTasks() {
  const accessible = useAccessibleTasks()
  const { space, projectId, myTasksOnly } = useUiStore(useShallow(s => ({ space: s.space, projectId: s.projectId, myTasksOnly: s.myTasksOnly })))
  const memberKey = useAuthStore(s => s.memberKey)
  const email = useAuthStore(s => s.email)

  return useMemo(() => {
    let result = accessible
    if (space) result = result.filter(t => t.cat === space)
    if (projectId) result = result.filter(t => t.projectId === projectId)
    if (myTasksOnly) result = result.filter(t => isAssignedTo(t.assignee, memberKey, email))
    return result
  }, [accessible, space, projectId, myTasksOnly, memberKey, email])
}
