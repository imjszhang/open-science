import { useNavigationStore } from '@/stores/navigation-store'
import { useProjectStore } from '@/stores/project-store'
import { useSessionStore, type ChatSession } from '@/stores/session-store'
import { usePreviewWorkbenchStore } from '@/stores/preview-workbench-store'
import { useSessionReplayStore } from '@/stores/session-replay-store'
import { createSessionReplayItem } from './workspace-session-actions'
import type { SessionDiscussionCapture } from './replay/replay-context'

const writable = (session: ChatSession | undefined): session is ChatSession =>
  Boolean(
    session && !session.packageOrigin && session.archivedAt === undefined && !session.isPending
  )

// Both the direct entry and the optional conversation chooser use the same guarded handoff.
// Opening a discussion stages a reference only; the ordinary Send action creates the conversation.
export const stageSessionDiscussion = (
  context: SessionDiscussionCapture,
  target: { projectId: string; sessionId?: string },
  onStaged?: () => void
): boolean => {
  const { projectId, sessionId } = target
  const available = (): boolean => {
    const project = useProjectStore.getState().projects.find((row) => row.id === projectId)
    const session = useSessionStore.getState().sessions.find((row) => row.id === sessionId)
    return Boolean(
      project &&
      project.archivedAt === undefined &&
      sessionId !== context.sourceSessionId &&
      (!sessionId || (writable(session) && session.projectId === projectId))
    )
  }
  if (!available()) return false
  const stage = (): void => {
    if (!available()) return
    if (!sessionId) useSessionStore.getState().clearSelection()
    const selected = useSessionStore.getState().sessions.find((row) => row.id === sessionId)
    const graph = selected?.conversationGraph
    const frame = graph?.frames.find((row) => row.id === graph.activeFrameId)
    useSessionReplayStore.getState().ask(context, {
      projectId,
      sessionId,
      frameId: frame?.id,
      branchId: frame?.activeBranchId,
      navigationRevision: useNavigationStore.getState().explicitNavigationRevision
    })
    usePreviewWorkbenchStore
      .getState()
      .upsertAndActivateItem(
        createSessionReplayItem(
          context.projectId,
          context.sourceSessionId,
          context.sourceTitle,
          projectId
        )
      )
    usePreviewWorkbenchStore.getState().setToolItemExpanded(null)
    onStaged?.()
  }
  const navigation = useNavigationStore.getState()
  return sessionId
    ? navigation.openSession(projectId, sessionId, 'user', stage)
    : navigation.openProject(projectId, 'user', stage)
}

export const openResearchDiscussion = async (
  context: SessionDiscussionCapture,
  signal?: AbortSignal
): Promise<boolean> => {
  const navigation = useNavigationStore.getState()
  const selectedId = useSessionStore.getState().selectedSessionId
  const selected = useSessionStore.getState().sessions.find((row) => row.id === selectedId)
  const binding = selected?.runtimeContext?.sessionContext?.bindings.at(-1)
  const draft = useSessionReplayStore.getState().draftDiscussion
  const currentDraft = draft?.draftKey === (selectedId ?? `new:${navigation.activeProjectId}`)
  const currentSource = currentDraft
    ? draft
    : binding && { projectId: binding.projectId, sourceSessionId: binding.sessionId }
  // Asking another question while already discussing this source keeps the current conversation,
  // including a conversation explicitly chosen in a different project.
  if (
    (!selectedId || writable(selected)) &&
    currentSource?.projectId === context.projectId &&
    currentSource.sourceSessionId === context.sourceSessionId &&
    navigation.activeProjectId
  )
    return signal?.aborted
      ? true
      : stageSessionDiscussion(context, {
          projectId: navigation.activeProjectId,
          sessionId: selectedId
        })
  const existing = await window.api.sessionReplay.findDiscussion({
    projectId: context.projectId,
    sourceSessionId: context.sourceSessionId
  })
  if (
    signal?.aborted ||
    useNavigationStore.getState().explicitNavigationRevision !==
      navigation.explicitNavigationRevision ||
    useSessionStore.getState().selectedSessionId !== selectedId
  )
    return true
  return stageSessionDiscussion(context, {
    projectId: context.projectId,
    sessionId: existing?.sessionId
  })
}
