// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatSession } from '@/stores/session-store'
import type { SessionDiscussionCapture } from './replay/replay-context'
import { openResearchDiscussion, stageSessionDiscussion } from './workspace-discussion-navigation'

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  openSession: vi.fn(),
  openProject: vi.fn(),
  clearSelection: vi.fn(),
  ask: vi.fn(),
  preview: vi.fn(),
  expand: vi.fn(),
  navigation: {
    activeProjectId: 'source-project' as string | undefined,
    explicitNavigationRevision: 1
  },
  selectedSessionId: 'source' as string | undefined,
  sessions: [] as ChatSession[],
  projects: [] as Array<{ id: string; archivedAt?: number }>,
  draft: undefined as { projectId: string; sourceSessionId: string; draftKey: string } | undefined
}))
vi.mock('@/stores/navigation-store', () => ({
  useNavigationStore: {
    getState: () => ({
      ...mocks.navigation,
      openSession: mocks.openSession,
      openProject: mocks.openProject
    })
  }
}))
vi.mock('@/stores/project-store', () => ({
  useProjectStore: { getState: () => ({ projects: mocks.projects }) }
}))
vi.mock('@/stores/session-store', () => ({
  useSessionStore: {
    getState: () => ({
      selectedSessionId: mocks.selectedSessionId,
      sessions: mocks.sessions,
      clearSelection: mocks.clearSelection
    })
  }
}))
vi.mock('@/stores/session-replay-store', () => ({
  useSessionReplayStore: {
    getState: () => ({ ask: mocks.ask, draftDiscussion: mocks.draft })
  }
}))
vi.mock('@/stores/preview-workbench-store', () => ({
  usePreviewWorkbenchStore: {
    getState: () => ({ upsertAndActivateItem: mocks.preview, setToolItemExpanded: mocks.expand })
  }
}))
vi.mock('./workspace-session-actions', () => ({
  createSessionReplayItem: (
    projectId: string,
    sourceSessionId: string,
    sourceTitle: string,
    workspaceProjectId: string
  ) => ({ projectId, sourceSessionId, sourceTitle, workspaceProjectId })
}))

const capture: SessionDiscussionCapture = {
  projectId: 'source-project',
  sourceSessionId: 'source',
  sourceTitle: 'Original research',
  scope: 'step',
  fingerprint: 'source-version',
  branchId: 'source-branch',
  stepId: 'step-28',
  stepOffsetMs: 40,
  evidence: [],
  excerpt: 'Selected observation'
}
const receiver = (id = 'discussion', projectId = 'source-project'): ChatSession => ({
  id,
  projectId,
  title: 'Research questions',
  status: 'idle',
  cwd: '/project',
  messages: [],
  createdAt: 1,
  updatedAt: 1,
  runtimeContext: {
    version: 1,
    revision: 2,
    sessionContext: {
      version: 1,
      bindings: [
        {
          projectId: capture.projectId,
          sessionId: capture.sourceSessionId,
          title: capture.sourceTitle,
          contextId: 'previous-question',
          branchId: capture.branchId,
          promptMessageId: 'previous-prompt'
        }
      ]
    }
  }
})
const navigate = (
  projectId: string,
  sessionId: string | undefined,
  callback?: () => void
): boolean => {
  mocks.navigation = {
    activeProjectId: projectId,
    explicitNavigationRevision: mocks.navigation.explicitNavigationRevision + 1
  }
  mocks.selectedSessionId = sessionId
  callback?.()
  return true
}
const deferredLookup = (): ((result: { sessionId: string } | null) => void) => {
  let finish!: (result: { sessionId: string } | null) => void
  mocks.find.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    })
  )
  return (result) => finish(result)
}
const expectNoHandoff = (): void => {
  expect(mocks.ask).not.toHaveBeenCalled()
  expect(mocks.preview).not.toHaveBeenCalled()
  expect(mocks.clearSelection).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.navigation = { activeProjectId: 'source-project', explicitNavigationRevision: 1 }
  mocks.selectedSessionId = 'source'
  mocks.sessions = [receiver()]
  mocks.projects = [{ id: 'source-project' }, { id: 'other-project' }]
  mocks.draft = undefined
  mocks.find.mockResolvedValue(null)
  mocks.openSession.mockImplementation((projectId, sessionId, _origin, callback) =>
    navigate(projectId, sessionId, callback)
  )
  mocks.openProject.mockImplementation((projectId, _origin, callback) =>
    // openProject normally selects a recent Session; staging a new draft must clear it afterward.
    navigate(projectId, 'most-recent-unrelated', callback)
  )
  mocks.clearSelection.mockImplementation(() => {
    mocks.selectedSessionId = undefined
  })
  vi.stubGlobal('api', { sessionReplay: { findDiscussion: mocks.find } })
})
afterEach(() => vi.unstubAllGlobals())

describe('direct research discussion navigation', () => {
  it('reuses the durable discussion and opens the original replay beside its composer', async () => {
    mocks.find.mockResolvedValue({ sessionId: 'discussion' })
    expect(await openResearchDiscussion(capture)).toBe(true)
    expect(mocks.find).toHaveBeenCalledWith({
      projectId: 'source-project',
      sourceSessionId: 'source'
    })
    expect(mocks.openSession).toHaveBeenCalledWith(
      'source-project',
      'discussion',
      'user',
      expect.any(Function)
    )
    expect(mocks.ask).toHaveBeenCalledWith(capture, {
      projectId: 'source-project',
      sessionId: 'discussion',
      navigationRevision: 2,
      frameId: undefined,
      branchId: undefined
    })
    expect(mocks.preview).toHaveBeenCalledWith({
      projectId: 'source-project',
      sourceSessionId: 'source',
      sourceTitle: 'Original research',
      workspaceProjectId: 'source-project'
    })
    expect(mocks.clearSelection).not.toHaveBeenCalled()
    expect(mocks.expand).toHaveBeenCalledWith(null)
  })

  it('stages a new draft in the source project when no durable discussion exists', async () => {
    mocks.navigation.activeProjectId = 'other-project'
    mocks.selectedSessionId = undefined
    expect(await openResearchDiscussion(capture)).toBe(true)
    expect(mocks.openProject).toHaveBeenCalledWith('source-project', 'user', expect.any(Function))
    expect(mocks.openSession).not.toHaveBeenCalled()
    expect(mocks.clearSelection).toHaveBeenCalledOnce()
    expect(mocks.ask).toHaveBeenCalledWith(
      capture,
      expect.objectContaining({
        projectId: 'source-project',
        sessionId: undefined,
        navigationRevision: 2
      })
    )
  })

  it.each(['source-project', 'other-project'])(
    'keeps the current linked receiver in %s instead of selecting another discussion',
    async (projectId) => {
      mocks.sessions = [receiver('current', projectId)]
      mocks.selectedSessionId = 'current'
      mocks.navigation.activeProjectId = projectId
      expect(await openResearchDiscussion(capture)).toBe(true)
      expect(mocks.find).not.toHaveBeenCalled()
      expect(mocks.openSession).toHaveBeenCalledWith(
        projectId,
        'current',
        'user',
        expect.any(Function)
      )
      expect(mocks.preview).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'source-project',
          workspaceProjectId: projectId
        })
      )
    }
  )

  it.each([undefined, 'current'])(
    'keeps a staged source on the current %s draft ahead of its old persisted association',
    async (sessionId) => {
      mocks.sessions = sessionId ? [receiver(sessionId, 'other-project')] : []
      if (mocks.sessions[0]) {
        const previous = mocks.sessions[0].runtimeContext!
        mocks.sessions[0].runtimeContext = {
          ...previous,
          sessionContext: {
            version: 1,
            bindings: [{ ...previous.sessionContext!.bindings[0], sessionId: 'previous-source' }]
          }
        }
      }
      mocks.selectedSessionId = sessionId
      mocks.navigation.activeProjectId = 'other-project'
      mocks.draft = {
        projectId: 'source-project',
        sourceSessionId: 'source',
        draftKey: sessionId ?? 'new:other-project'
      }
      expect(await openResearchDiscussion(capture)).toBe(true)
      expect(mocks.find).not.toHaveBeenCalled()
      expect(mocks.ask).toHaveBeenCalledWith(
        capture,
        expect.objectContaining({ projectId: 'other-project', sessionId })
      )
    }
  )

  it('ignores another draft’s source rather than redirecting an unrelated current conversation', async () => {
    mocks.selectedSessionId = 'unrelated'
    mocks.sessions = [{ ...receiver('unrelated'), runtimeContext: undefined }]
    mocks.draft = {
      projectId: 'source-project',
      sourceSessionId: 'source',
      draftKey: 'another-draft'
    }
    await openResearchDiscussion(capture)
    expect(mocks.find).toHaveBeenCalledOnce()
    expect(mocks.openProject).toHaveBeenCalledOnce()
  })

  it.each(['navigation', 'selection', 'unselected', 'abort'])(
    'does not take over after %s changes while lookup is pending',
    async (change) => {
      const finish = deferredLookup()
      const controller = new AbortController()
      const opening = openResearchDiscussion(capture, controller.signal)
      if (change === 'navigation') mocks.navigation.explicitNavigationRevision += 1
      if (change === 'selection') mocks.selectedSessionId = 'other'
      if (change === 'unselected') mocks.selectedSessionId = undefined
      if (change === 'abort') controller.abort()
      finish({ sessionId: 'discussion' })
      expect(await opening).toBe(true)
      expect(mocks.openSession).not.toHaveBeenCalled()
      expect(mocks.openProject).not.toHaveBeenCalled()
      expectNoHandoff()
    }
  )

  it('does not create a replacement draft when durable lookup fails', async () => {
    mocks.find.mockRejectedValue(new Error('Local Session catalog unavailable'))
    await expect(openResearchDiscussion(capture)).rejects.toThrow(
      'Local Session catalog unavailable'
    )
    expect(mocks.openSession).not.toHaveBeenCalled()
    expect(mocks.openProject).not.toHaveBeenCalled()
    expectNoHandoff()
  })

  it('honors an already aborted request even for the immediate current-discussion path', async () => {
    mocks.selectedSessionId = 'discussion'
    const controller = new AbortController()
    controller.abort()
    expect(await openResearchDiscussion(capture, controller.signal)).toBe(true)
    expect(mocks.find).not.toHaveBeenCalled()
    expect(mocks.openSession).not.toHaveBeenCalled()
    expectNoHandoff()
  })
})

describe('guarded discussion handoff', () => {
  it.each([
    'missing',
    'imported',
    'archived',
    'pending',
    'wrong-project',
    'source',
    'missing-project',
    'archived-project'
  ])('rejects a %s destination before navigating', (state) => {
    const target = { projectId: 'source-project', sessionId: 'discussion' }
    if (state === 'missing') mocks.sessions = []
    if (state === 'imported')
      mocks.sessions[0].packageOrigin = {
        importId: 'import',
        sourceProjectId: 'foreign',
        sourceSessionId: 'foreign-source',
        importedAt: 1,
        manifestChecksum: 'a'.repeat(64)
      }
    if (state === 'archived') mocks.sessions[0].archivedAt = 1
    if (state === 'pending') mocks.sessions[0].isPending = true
    if (state === 'wrong-project') mocks.sessions[0].projectId = 'other-project'
    if (state === 'source') target.sessionId = 'source'
    if (state === 'missing-project') mocks.projects = []
    if (state === 'archived-project') mocks.projects[0].archivedAt = 1
    expect(stageSessionDiscussion(capture, target)).toBe(false)
    expect(mocks.openSession).not.toHaveBeenCalled()
    expectNoHandoff()
  })

  it.each(['receiver-archived', 'receiver-deleted', 'project-archived'])(
    'revalidates %s after a dirty-preview navigation confirmation was deferred',
    (change) => {
      let confirm!: () => void
      mocks.openSession.mockImplementation((_projectId, _sessionId, _origin, callback) => {
        confirm = callback
        return true
      })
      const staged = vi.fn()
      expect(
        stageSessionDiscussion(
          capture,
          { projectId: 'source-project', sessionId: 'discussion' },
          staged
        )
      ).toBe(true)
      expectNoHandoff()
      if (change === 'receiver-archived') mocks.sessions[0].archivedAt = 1
      if (change === 'receiver-deleted') mocks.sessions = []
      if (change === 'project-archived') mocks.projects[0].archivedAt = 1
      confirm()
      expectNoHandoff()
      expect(staged).not.toHaveBeenCalled()
    }
  )

  it('captures the admitted receiver’s active frame after deferred navigation, rather than the stale frame at the click', () => {
    let confirm!: () => void
    mocks.openSession.mockImplementation((projectId, sessionId, _origin, callback) => {
      confirm = () => {
        navigate(projectId, sessionId, callback)
      }
      return true
    })
    const staged = vi.fn()
    stageSessionDiscussion(
      capture,
      { projectId: 'source-project', sessionId: 'discussion' },
      staged
    )
    mocks.sessions[0].conversationGraph = {
      activeFrameId: 'current-frame',
      frames: [{ id: 'current-frame', activeBranchId: 'current-branch' }]
    } as ChatSession['conversationGraph']
    confirm()
    expect(mocks.ask).toHaveBeenCalledWith(
      capture,
      expect.objectContaining({
        frameId: 'current-frame',
        branchId: 'current-branch',
        navigationRevision: 2
      })
    )
    expect(staged).toHaveBeenCalledOnce()
  })

  it('leaves the current draft and replay alone when the navigation guard declines the handoff', () => {
    mocks.openSession.mockReturnValue(false)
    expect(
      stageSessionDiscussion(capture, { projectId: 'source-project', sessionId: 'discussion' })
    ).toBe(false)
    expectNoHandoff()
  })
})
