import { create } from 'zustand'
import { ref, get as fbGet, set as fbSet, update as fbUpdate, remove as fbRemove } from 'firebase/database'
import { db } from '../lib/firebase'
import { gid, inviteCode as newInviteCode } from '../lib/utils'
import { P } from '../lib/paths'
import { PROJECT_PALETTE } from '../types'
import { useAuthStore } from './authStore'
import { useOrgStore } from './orgStore'
import { claimGuestSeats, roleForDomain } from '../lib/roster'
import { useUserProfileStore } from './userProfileStore'
import type { Project } from '../types'
import { reportProblem } from '../lib/notify'

/**
 * A project is now a subtree: meta holds what the UI draws, members/$uid is what
 * the rules check. Both list the same people, so joining and removing have to
 * write both — members alone would leave someone invisible in the member list,
 * meta alone would leave them unable to open the project at all.
 */

export interface InviteEntry {
  code: string
  name: string
  /**
   * 이 프로젝트가 어느 회사 것인가.
   *
   * 받는 사람은 아직 프로젝트를 못 읽습니다 — 초대장이 그 사람이 볼 수 있는
   * 유일한 것이고, 그래서 이름 사본이 여기 있는 것과 같은 이유로 조직도 여기
   * 실립니다. 외부 협업자가 자기 회사를 알아내는 유일한 길입니다.
   */
  orgId?: string
}

interface ProjectState {
  projects: Project[]
  /** Invitations addressed to me, from invitesByEmail. Keyed by project id. */
  invites: Record<string, InviteEntry>
  addProject: (name: string, color?: string, dueDate?: string, clientName?: string, creatorEmail?: string) => Project
  updateProject: (id: string, patch: Partial<Omit<Project, 'id'>>) => void
  deleteProject: (id: string) => void
  addMember: (projectId: string, email: string) => void
  removeMember: (projectId: string, email: string) => void
  joinProject: (projectId: string, inviteCode: string, orgId?: string) => Promise<boolean>
  applyRemote: (projects: Project[]) => void
  applyInvites: (invites: Record<string, InviteEntry>) => void
}

const lower = (e: string) => e.toLowerCase().trim()

/** 우리 도메인 사람인가. 게스트로 올릴지 말지를 여기서 가릅니다. */
function isOrgDomain(email: string, domain: string): boolean {
  return roleForDomain(email, domain) === 'member'
}

function uidForEmail(email: string): string | null {
  const target = lower(email)
  const profiles = useUserProfileStore.getState().profiles
  for (const [uid, profile] of Object.entries(profiles)) {
    if (profile.email?.toLowerCase() === target) return uid
  }
  return null
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  invites: {},

  addProject: (name, color, dueDate, clientName, creatorEmail) => {
    const uid = useAuthStore.getState().uid
    const existing = get().projects
    const inviteCode = newInviteCode()
    const project: Project = {
      id: gid(),
      name: name.trim(),
      color: color ?? PROJECT_PALETTE[existing.length % PROJECT_PALETTE.length],
      inviteCode,
      memberEmails: creatorEmail ? [lower(creatorEmail)] : [],
      ...(creatorEmail ? { creatorEmail: lower(creatorEmail) } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(clientName ? { clientName } : {}),
    }
    set({ projects: [...existing, project] })

    if (uid) {
      // The rules only accept a brand new project if the creator is already in
      // its members list, so the whole subtree goes in one write.
      const { id, ...meta } = project
      // 소속을 만들 때 같이 적습니다. 나중에 배경에서 채우는 길도 있지만
      // (roster.stampProjects), 만드는 순간이 소속이 확실한 유일한 순간입니다.
      // 게스트로 서 있는 곳의 소속은 안 찍습니다 — 남의 회사 것이 됩니다.
      const { orgId: standing, isGuest } = useOrgStore.getState()
      const orgId = isGuest ? null : standing
      fbUpdate(ref(db), {
        [P.project(id)]: {
          meta: { id, ...meta, ...(orgId ? { orgId } : {}) },
          members: { [uid]: inviteCode },
        },
        [P.userProject(uid, id)]: true,
      })
        .then(() => {
          // 조직 쪽 목록은 **프로젝트가 만들어진 뒤에** 씁니다. 규칙이 '이
          // 프로젝트의 멤버인가'를 보는데, 같은 쓰기 안에서는 그 멤버가 아직
          // 없습니다. 실패해도 배경에서 다시 채워집니다(roster.stampProjects).
          if (!orgId) return
          return fbUpdate(ref(db, P.orgOwns(orgId)), { [id]: true })
        })
        .then(() => {
          // 워크스페이스 안의 프로젝트는 목록에 있습니다 — 따로 올리는
          // 동작이 없습니다. 오르는 것은 이름뿐이고, 업무는 그대로
          // 프로젝트 멤버만 봅니다.
          if (!orgId) return
          return useOrgStore.getState().listProject(project).then(() => undefined)
        })
        .catch(e => console.warn('[project create]', e))
    }
    return project
  },

  updateProject: (id, patch) => {
    // 조직 목록에 이름 사본이 있으면 같이 고칩니다. 사본은 늙습니다.
    if (patch.name) useOrgStore.getState().syncProjectName(id, patch.name)
    set({ projects: get().projects.map(p => p.id === id ? { ...p, ...patch } : p) })
    const payload: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) payload[k] = v === undefined ? null : v
    fbUpdate(ref(db, P.projectMeta(id)), payload).catch(e => console.warn('[project update]', e))
  },

  /**
   * ── 프로젝트를 지웁니다 ────────────────────────────────────────────────────
   *
   * **휴지통이 없습니다.** 업무 하나를 지우면 휴지통으로 가지만 프로젝트는
   * 통째로 사라집니다 — 그래서 만든 사람과 워크스페이스 관리자만 할 수 있고,
   * 규칙이 그걸 지킵니다.
   *
   * 순서가 있습니다. 워크스페이스 목록에서 **먼저** 내립니다 — 그 목록을
   * 고치려면 내가 이 프로젝트의 멤버여야 하는데, 프로젝트를 먼저 지우면
   * 확인할 명단이 없어져서 이름만 목록에 남습니다. 없는 프로젝트에 참여를
   * 요청하는 화면이 그렇게 생깁니다.
   */
  deleteProject: (id) => {
    const uid = useAuthStore.getState().uid
    const before = get().projects
    const project = before.find(p => p.id === id)
    set({ projects: before.filter(p => p.id !== id) })

    void (async () => {
      if (project?.orgId) {
        // 참여 요청도 같이 치웁니다. 목록에 없는 프로젝트에 대한 요청은
        // 아무도 볼 데가 없는 채로 남습니다 — 승인할 사람이 그 프로젝트
        // 멤버인데, 그 프로젝트가 없어졌으니까요.
        await fbRemove(ref(db, `${P.orgJoinRequests(project.orgId)}/${id}`)).catch(() => {})
        await fbRemove(ref(db, P.orgProject(project.orgId, id)))
          .catch(e => console.warn('[project delete] 워크스페이스 목록', e))
      }
      try {
        await fbRemove(ref(db, P.project(id)))
      } catch (e) {
        // 규칙이 거절했습니다. 화면에서만 사라지고 데이터는 그대로면,
        // 다음에 켤 때 되살아나서 지운 적이 없는 것처럼 보입니다.
        set({ projects: before })
        console.warn('[project delete]', e)
        reportProblem('프로젝트를 지우지 못했습니다 — 만든 사람과 워크스페이스 관리자만 지울 수 있습니다.')
        return
      }
      // Other members keep a dangling index entry; their client drops it when the
      // project reads back empty.
      if (uid) await fbRemove(ref(db, P.userProject(uid, id))).catch(() => {})
      // 남는 찌꺼기들 — 대기 중 초대장(없는 프로젝트의 수락 창이 뜹니다),
      // 휴지통, 워크스페이스 장부. 하나가 거절돼도 나머지는 치웁니다.
      const leftovers: Record<string, null> = {}
      for (const waiting of project?.pendingEmails ?? []) leftovers[P.inviteEntry(waiting, id)] = null
      leftovers[`trash/${id}`] = null
      if (project?.orgId) leftovers[`${P.orgOwns(project.orgId)}/${id}`] = null
      await Promise.all(Object.entries(leftovers).map(([path]) => fbRemove(ref(db, path)).catch(() => {})))
    })()
  },

  addMember: (projectId, email) => {
    const normalized = lower(email)
    const project = get().projects.find(p => p.id === projectId)
    if (!project) return
    const active = project.memberEmails ?? []
    const pending = project.pendingEmails ?? []
    if ([...active, ...pending].some(e => lower(e) === normalized)) return

    const pendingEmails = [...pending, normalized]
    set({ projects: get().projects.map(p => p.id === projectId ? { ...p, pendingEmails } : p) })

    // The invitation is filed under the invitee's address because they cannot
    // read the project yet — this is the only thing they can see before joining.
    fbUpdate(ref(db), {
      [`${P.projectMeta(projectId)}/pendingEmails`]: pendingEmails,
      [P.inviteEntry(normalized, projectId)]: {
        code: project.inviteCode ?? '',
        name: project.name,
        ...(project.orgId ? { orgId: project.orgId } : {}),
      },
    }).catch(e => console.warn('[invite]', e))

    // 도메인 밖 사람을 부르는 것이면 조직 명단에 게스트로 같이 올립니다.
    // 초대할 수 있는 사람과 게스트를 들일 수 있는 사람은 같은 사람이어야
    // 하고, 규칙도 그렇게 되어 있습니다. 이걸 안 하면 초대받은 사람이
    // 들어와서 프로젝트를 못 읽습니다 — 명단에 없으니까요.
    const orgId = project.orgId
    /**
     * 게스트로 올릴지 말지는 **그 프로젝트가 속한 회사의 도메인**으로 정합니다.
     *
     * 예전에는 지금 서 있는 워크스페이스의 도메인만 믿었습니다. 그래서 개인
     * 워크스페이스에 서서 회사 프로젝트에 동료를 부르면 '모르겟으니 게스트'로
     * 적었고, 그 동료는 자기 회사에서 **강등**됐습니다 — 아직 로그인도 안 한
     * 사람이라 스스로 되돌릴 수도 없었습니다. 모르면 게스트가 아니라, 모르면
     * 물어봐야 합니다. 도메인은 멤버라면 읽을 수 있습니다.
     *
     * 프로젝트 초대는 언제나 **게스트 자리**까지만 만듭니다. 워크스페이스
     * 멤버로 부르는 것은 설정 > 멤버에 따로 있습니다. 우리 도메인 사람은
     * 아무것도 안 씁니다 — 도메인으로 이미 멤버입니다(규칙도 거절합니다).
     */
    if (orgId) {
      void fbGet(ref(db, P.orgDomain(orgId))).then(snap => {
        const domain = typeof snap.val() === 'string' ? snap.val() as string : ''
        if (domain && isOrgDomain(normalized, domain)) return
        return fbUpdate(ref(db, P.orgMember(orgId, normalized)), {
          role: 'guest',
          at: Date.now(),
          by: lower(useAuthStore.getState().email ?? ''),
        })
      }).catch(() => {})  // 이미 명단에 있으면 규칙이 거절합니다. 맞는 동작입니다.
    }
  },

  removeMember: (projectId, email) => {
    const normalized = lower(email)
    const project = get().projects.find(p => p.id === projectId)
    if (!project) return
    const memberEmails = (project.memberEmails ?? []).filter(e => lower(e) !== normalized)
    const pendingEmails = (project.pendingEmails ?? []).filter(e => lower(e) !== normalized)
    set({ projects: get().projects.map(p => p.id === projectId ? { ...p, memberEmails, pendingEmails } : p) })

    /**
     * ── 내보내면 초대 링크도 바뀝니다 ──────────────────────────────────────
     *
     * 규칙은 '코드가 맞고 아직 멤버가 아니면' 들어오게 합니다. 코드를 그대로
     * 두면 내보낸 사람이 카톡에 남은 옛 링크로 그냥 다시 들어옵니다. 그래서
     * 코드를 새로 뽑고, 아직 답 안 한 초대장에는 새 코드를 다시 실어 줍니다.
     */
    const code = newInviteCode()
    const payload: Record<string, unknown> = {
      [`${P.projectMeta(projectId)}/memberEmails`]: memberEmails,
      [`${P.projectMeta(projectId)}/pendingEmails`]: pendingEmails,
      [`${P.projectMeta(projectId)}/inviteCode`]: code,
      [P.inviteEntry(normalized, projectId)]: null,
    }
    for (const waiting of pendingEmails) {
      payload[P.inviteEntry(waiting, projectId)] = {
        code, name: project.name, ...(project.orgId ? { orgId: project.orgId } : {}),
      }
    }
    // Revoking access means removing the members entry; dropping the address
    // from meta alone would leave them able to open the project.
    const uid = uidForEmail(normalized)
    if (uid) payload[P.projectMember(projectId, uid)] = null
    else if (lower(useAuthStore.getState().email ?? '') !== normalized) {
      // 프로필을 못 찾으면 자리가 남습니다. 조용히 넘기면 '내보냈다'고 믿는
      // 사람과 여전히 읽는 사람이 생깁니다.
      reportProblem('이 사람의 계정을 찾지 못해 접근을 완전히 끊지 못했습니다. 초대 링크는 바꿨습니다.')
    }
    set({ projects: get().projects.map(p => p.id === projectId ? { ...p, inviteCode: code } : p) })
    fbUpdate(ref(db), payload).catch(e => console.warn('[member remove]', e))
  },

  joinProject: async (projectId, inviteCode, orgId) => {
    const { uid, email } = useAuthStore.getState()
    if (!uid) return false
    try {
      // Membership first: until this lands the caller cannot touch anything else
      // under the project, so it cannot be folded into one atomic update.
      await fbSet(ref(db, P.projectMember(projectId, uid)), inviteCode)
      // 링크가 회사를 말해 줬으면 그걸 적습니다 — 예비 열쇠(syncStore 참고).
      // 안 말해 줬으면 예전처럼 true고, 프로젝트를 읽는 순간 채워집니다.
      await fbSet(ref(db, P.userProject(uid, projectId)), orgId ?? true)
    } catch {
      return false   // wrong code, or the project is gone
    }

    // 조직 명단에 내 자리를 앉힙니다. **프로젝트를 읽기 전에** 해야 합니다 —
    // 명단에 없으면 그 프로젝트가 안 열리고, 안 열리면 소속도 못 읽습니다.
    // 이미 명단에 있으면 규칙이 거절하고, 그게 맞는 동작입니다.
    if (orgId && email) await claimGuestSeats(uid, lower(email), [orgId])

    if (email) {
      const normalized = lower(email)
      try {
        const snap = await fbGet(ref(db, P.projectMeta(projectId)))
        const meta = snap.val() ?? {}
        const memberEmails: string[] = meta.memberEmails ?? []
        const pendingEmails: string[] = meta.pendingEmails ?? []
        await fbUpdate(ref(db), {
          [`${P.projectMeta(projectId)}/memberEmails`]:
            memberEmails.some(e => lower(e) === normalized) ? memberEmails : [...memberEmails, normalized],
          [`${P.projectMeta(projectId)}/pendingEmails`]: pendingEmails.filter(e => lower(e) !== normalized),
          [P.inviteEntry(normalized, projectId)]: null,
        })
      } catch (e) {
        // Access is already granted; the display list just did not catch up.
        console.warn('[join tidy-up]', e)
      }
    }
    return true
  },

  applyRemote: (projects) => set({ projects }),
  applyInvites: (invites) => set({ invites }),
}))
