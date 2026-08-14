import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  accessibleProjectIds,
  canAccessProject,
  isAssignedTo,
  isTaskVisible,
} from './access.js'
import { mutateTasks, newId, readMilestones, readProjects, readTasks } from './store.js'
import { PRIORITIES, STATUSES, type Priority, type Status, type Task } from './types.js'

/** Identity the tools act as. Every read and write is scoped to this email. */
export interface Ctx {
  email: string
}

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
})

/** Trimmed shape for listings, so large result sets stay readable. */
function summarise(t: Task) {
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    assignee: t.assignee || null,
    due: t.due || null,
    projectId: t.projectId ?? null,
    milestoneId: t.milestoneId ?? null,
    parentId: t.parentId ?? null,
    progress: t.progress,
  }
}

export function registerTools(server: McpServer, ctx: Ctx) {
  // ── Read ──────────────────────────────────────────────────────────────────

  server.registerTool(
    'list_projects',
    {
      title: '프로젝트 목록',
      description: 'Projects the caller is a member of. Archived ones are excluded unless include_archived is set.',
      inputSchema: { include_archived: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ include_archived }) => {
      const projects = (await readProjects()).filter(p => canAccessProject(p, ctx.email))
      const visible = include_archived ? projects : projects.filter(p => !p.archived)
      return text(visible.map(p => ({
        id: p.id,
        name: p.name,
        dueDate: p.dueDate ?? null,
        archived: !!p.archived,
        memberEmails: p.memberEmails ?? [],
      })))
    }
  )

  server.registerTool(
    'list_milestones',
    {
      title: '마일스톤 목록',
      description: 'Milestones belonging to projects the caller can access.',
      inputSchema: { project_id: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ project_id }) => {
      const ids = accessibleProjectIds(await readProjects(), ctx.email)
      const milestones = (await readMilestones())
        .filter(m => ids.has(m.projectId))
        .filter(m => !project_id || m.projectId === project_id)
      return text(milestones)
    }
  )

  server.registerTool(
    'list_tasks',
    {
      title: '업무 목록',
      description:
        'Tasks visible to the caller, with optional filters. Project tasks follow project membership; tasks with no project are only visible to their creator or assignee.',
      inputSchema: {
        project_id: z.string().optional(),
        milestone_id: z.string().optional(),
        status: z.enum(STATUSES as [Status, ...Status[]]).optional(),
        assigned_to_me: z.boolean().optional(),
        due_before: z.string().optional().describe('YYYY-MM-DD, inclusive'),
        due_after: z.string().optional().describe('YYYY-MM-DD, inclusive'),
        overdue: z.boolean().optional().describe('only incomplete tasks past their due date'),
        search: z.string().optional().describe('case-insensitive match on name or memo'),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const ids = accessibleProjectIds(await readProjects(), ctx.email)
      let tasks = (await readTasks()).filter(t => isTaskVisible(t, ctx.email, ids))

      if (args.project_id) tasks = tasks.filter(t => t.projectId === args.project_id)
      if (args.milestone_id) tasks = tasks.filter(t => t.milestoneId === args.milestone_id)
      if (args.status) tasks = tasks.filter(t => t.status === args.status)
      if (args.assigned_to_me) tasks = tasks.filter(t => isAssignedTo(t, ctx.email))
      if (args.due_before) tasks = tasks.filter(t => t.due && t.due <= args.due_before!)
      if (args.due_after) tasks = tasks.filter(t => t.due && t.due >= args.due_after!)
      if (args.overdue) {
        const today = new Date().toISOString().slice(0, 10)
        tasks = tasks.filter(t => t.due && t.status !== '완료' && t.due < today)
      }
      if (args.search) {
        const q = args.search.toLowerCase()
        tasks = tasks.filter(t =>
          t.name.toLowerCase().includes(q) || (t.memo ?? '').toLowerCase().includes(q))
      }

      const total = tasks.length
      const limited = tasks.slice(0, args.limit ?? 100)
      return text({ total, returned: limited.length, tasks: limited.map(summarise) })
    }
  )

  server.registerTool(
    'get_task',
    {
      title: '업무 상세',
      description: 'Full record for one task, including memo, tags, links and subtasks.',
      inputSchema: { task_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ task_id }) => {
      const ids = accessibleProjectIds(await readProjects(), ctx.email)
      const tasks = await readTasks()
      const task = tasks.find(t => t.id === task_id)
      if (!task || !isTaskVisible(task, ctx.email, ids)) {
        throw new Error('task not found or not accessible')
      }
      const subtasks = tasks.filter(t => t.parentId === task.id).map(summarise)
      return text({ ...task, subtasks })
    }
  )

  // ── Write ─────────────────────────────────────────────────────────────────

  server.registerTool(
    'create_task',
    {
      title: '업무 추가',
      description: 'Creates a task. The target project must be one the caller belongs to.',
      inputSchema: {
        name: z.string().min(1),
        project_id: z.string().optional(),
        milestone_id: z.string().optional(),
        parent_id: z.string().optional().describe('create as a subtask of this task'),
        assignee: z.string().optional().describe('comma-separated emails'),
        status: z.enum(STATUSES as [Status, ...Status[]]).optional(),
        priority: z.enum(PRIORITIES as [Priority, ...Priority[]]).optional(),
        due: z.string().optional().describe('YYYY-MM-DD'),
        start: z.string().optional().describe('YYYY-MM-DD'),
        memo: z.string().optional(),
        tags: z.array(z.string()).optional(),
        cat: z.string().optional().describe('space/category name'),
      },
    },
    async (args) => {
      const projects = await readProjects()
      const ids = accessibleProjectIds(projects, ctx.email)
      if (args.project_id && !ids.has(args.project_id)) {
        throw new Error('project not found or not accessible')
      }

      const created = await mutateTasks(tasks => {
        if (args.parent_id) {
          const parent = tasks.find(t => t.id === args.parent_id)
          if (!parent || !isTaskVisible(parent, ctx.email, ids)) {
            throw new Error('parent task not found or not accessible')
          }
        }
        // Undefined values are rejected by Firebase, so optional keys are omitted.
        const task: Task = {
          id: newId(),
          type: args.parent_id ? '세부' : '상위',
          name: args.name.trim(),
          cat: args.cat ?? '',
          assignee: args.assignee ?? '',
          start: args.start ?? '',
          due: args.due ?? '',
          priority: args.priority ?? '중간',
          status: args.status ?? '대기',
          progress: 0,
          memo: args.memo ?? '',
          createdBy: ctx.email,
          ...(args.parent_id ? { parentId: args.parent_id } : {}),
          ...(args.project_id ? { projectId: args.project_id } : {}),
          ...(args.milestone_id ? { milestoneId: args.milestone_id } : {}),
          ...(args.tags?.length ? { tags: args.tags } : {}),
        }
        return { tasks: [...tasks, task], result: task }
      })

      return text({ created: summarise(created) })
    }
  )

  server.registerTool(
    'update_task',
    {
      title: '업무 수정',
      description: 'Updates fields on an existing task. Only the fields provided are changed.',
      inputSchema: {
        task_id: z.string(),
        name: z.string().optional(),
        status: z.enum(STATUSES as [Status, ...Status[]]).optional(),
        priority: z.enum(PRIORITIES as [Priority, ...Priority[]]).optional(),
        assignee: z.string().optional(),
        due: z.string().optional(),
        start: z.string().optional(),
        progress: z.number().int().min(0).max(100).optional(),
        memo: z.string().optional(),
        tags: z.array(z.string()).optional(),
        milestone_id: z.string().optional(),
        project_id: z.string().optional(),
      },
    },
    async (args) => {
      const ids = accessibleProjectIds(await readProjects(), ctx.email)
      if (args.project_id && !ids.has(args.project_id)) {
        throw new Error('target project not found or not accessible')
      }

      const updated = await mutateTasks(tasks => {
        const i = tasks.findIndex(t => t.id === args.task_id)
        if (i < 0 || !isTaskVisible(tasks[i], ctx.email, ids)) {
          throw new Error('task not found or not accessible')
        }
        const patch: Partial<Task> = {}
        if (args.name !== undefined) patch.name = args.name
        if (args.status !== undefined) patch.status = args.status
        if (args.priority !== undefined) patch.priority = args.priority
        if (args.assignee !== undefined) patch.assignee = args.assignee
        if (args.due !== undefined) patch.due = args.due
        if (args.start !== undefined) patch.start = args.start
        if (args.progress !== undefined) patch.progress = args.progress
        if (args.memo !== undefined) patch.memo = args.memo
        if (args.tags !== undefined) patch.tags = args.tags
        if (args.milestone_id !== undefined) patch.milestoneId = args.milestone_id
        if (args.project_id !== undefined) patch.projectId = args.project_id

        const next = [...tasks]
        next[i] = { ...tasks[i], ...patch }
        return { tasks: next, result: next[i] }
      })

      return text({ updated: summarise(updated) })
    }
  )

  server.registerTool(
    'delete_task',
    {
      title: '업무 삭제',
      description:
        'Deletes a task. Subtasks are deleted with it; the tool reports how many were removed.',
      inputSchema: { task_id: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ task_id }) => {
      const ids = accessibleProjectIds(await readProjects(), ctx.email)

      const removed = await mutateTasks(tasks => {
        const target = tasks.find(t => t.id === task_id)
        if (!target || !isTaskVisible(target, ctx.email, ids)) {
          throw new Error('task not found or not accessible')
        }
        const doomed = new Set<string>([target.id])
        tasks.forEach(t => { if (t.parentId === target.id) doomed.add(t.id) })
        return {
          tasks: tasks.filter(t => !doomed.has(t.id)),
          result: { name: target.name, count: doomed.size },
        }
      })

      return text({ deleted: removed.name, tasksRemoved: removed.count })
    }
  )
}
