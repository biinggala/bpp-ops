import { useMemo } from 'react'
import { useTaskStore } from '../store/taskStore'
import { useAuthStore } from '../store/authStore'
import { useProjectStore } from '../store/projectStore'
import { canAccessProject } from '../lib/utils'
import type { Task } from '../types'

// Returns tasks the current user is allowed to see, without applying any UI filters
// (status, assignee, tag, search). Use this to populate filter option dropdowns.
export function useAccessibleTasks(): Task[] {
  const tasks = useTaskStore(s => s.tasks)
  const email = useAuthStore(s => s.email)
  const projects = useProjectStore(s => s.projects)

  return useMemo(() => {
    const accessibleIds = new Set(projects.filter(p => canAccessProject(p, email)).map(p => p.id))
    const hasAccess = accessibleIds.size > 0
    return tasks.filter(t => t.projectId ? accessibleIds.has(t.projectId) : hasAccess)
  }, [tasks, email, projects])
}
