import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReplayDocument, ReplayResource } from '../../shared/replay'
import type {
  ResearchReplayDocument,
  ResearchReplayPosition,
  ResearchReplaySelection
} from '../../shared/research-replay'
import { replayViewStateSchema, type ReplayViewState } from '../../shared/session-replay'
import {
  projectLegacyObservationToTrack,
  projectRecordingToTrack
} from '../../shared/project-recording'
import { recordedMediaResource } from '../src/lib/replay/recorded-results'
import type { ReplayNotebookRunReader } from '../src/lib/replay/notebook-details'
import { ErrorNotice } from '../src/components/error-notice'
import { ReplayPanel } from '../src/pages/workspace/replay/ReplayPanel'
import type {
  ReplayMaterialPlayback,
  ReplayMaterialView
} from '../src/pages/workspace/replay/ReplayStage'
import { BrowserRecordingPlayer } from '../src/pages/workspace/replay/BrowserRecordingPlayer'
import { RecordedFootageStatus } from '../src/pages/workspace/replay/RecordedFootageStatus'
import { ProjectReplay } from '../src/pages/workspace/replay/ProjectReplay'
import { ResultsPanel } from '../src/pages/workspace/replay/results/ResultsPanel'
import type { SessionDiscussionCapture } from '../src/pages/workspace/replay/replay-context'
import { BrowserArtifactPreview } from './BrowserArtifactPreview'
import { ReferencePanel } from './ReferencePanel'
import { ReplayViewerRequestError, type ResearchReplayViewerContext } from './client'
import { ResearchReplayClient } from './research-client'
import {
  researchPosition,
  researchResults,
  type ResearchRecordingMaterial
} from './research-materials'

const storageKey = (viewerId: string, document: ReplayDocument): string =>
  `research-replay:${viewerId}:${document.source.fingerprint}`
const restoreView = (viewerId: string, document: ReplayDocument): ReplayViewState | undefined => {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(viewerId, document)) ?? 'null')
    const parsed = replayViewStateSchema.safeParse(value)
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}
const saveView = (viewerId: string, document: ReplayDocument, view: ReplayViewState): void => {
  try {
    sessionStorage.setItem(storageKey(viewerId, document), JSON.stringify(view))
  } catch {
    /* Optional per-viewer navigation state, never source history. */
  }
}

type MaterialPreferences = { materialId: 'notebook' | 'project' | 'results'; recordingId?: string }
const restoreMaterials = (viewerId: string, document: ReplayDocument): MaterialPreferences => {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(`${storageKey(viewerId, document)}:materials`) ?? 'null'
    )
    if (saved && ['notebook', 'project', 'results'].includes(saved.materialId))
      return {
        materialId: saved.materialId,
        recordingId: typeof saved.recordingId === 'string' ? saved.recordingId : undefined
      }
  } catch {
    /* Optional browser navigation state. */
  }
  return { materialId: 'notebook' }
}

const ResearchReplayContent = ({
  client,
  context,
  research,
  recordings,
  unavailable
}: {
  client: ResearchReplayClient
  context: ResearchReplayViewerContext
  research: ResearchReplayDocument
  recordings: readonly ResearchRecordingMaterial[]
  unavailable: boolean
}): React.JSX.Element => {
  const { t } = useTranslation()
  // Main computes timing while original publication/branch evidence still exists. Applying the
  // projection again after technical-step removal can lose attribution and trim valid coverage.
  const timed = research.timing
  const document = research.document
  const [initialView] = useState(() => restoreView(context.viewerId, document))
  const [selection, setSelection] = useState<ResearchReplaySelection>()
  const [selectionFailed, setSelectionFailed] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [preferences] = useState(() => restoreMaterials(context.viewerId, document))
  const [materialId, setMaterialId] = useState<string>(preferences.materialId)
  const [materialRequest, setMaterialRequest] = useState<{ id: string; revision: number }>({
    id: preferences.materialId,
    revision: 0
  })
  const [recordingId, setRecordingId] = useState(
    () =>
      recordings.find(({ descriptor }) => descriptor.id === preferences.recordingId)?.descriptor
        .id ??
      recordings.find(({ descriptor }) => descriptor.kind === 'web-recording')?.descriptor.id ??
      recordings[0]?.descriptor.id
  )
  useEffect(() => {
    try {
      sessionStorage.setItem(
        `${storageKey(context.viewerId, document)}:materials`,
        JSON.stringify({ materialId, recordingId })
      )
    } catch {
      /* Optional browser navigation state. */
    }
  }, [context.viewerId, document, materialId, recordingId])
  const pending = useRef(0)
  useEffect(() => {
    const controller = new AbortController()
    void client.researchSelection(document, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted && value) setSelection((current) => current ?? value)
      },
      () => undefined
    )
    return () => {
      controller.abort()
    }
  }, [client, document])
  const select = useCallback(
    async (position: ResearchReplayPosition): Promise<void> => {
      const revision = ++pending.current
      setSelecting(true)
      setSelectionFailed(false)
      try {
        const saved = await client.selectResearch(document, position)
        if (revision === pending.current) setSelection(saved)
      } catch (error) {
        if (revision === pending.current) setSelectionFailed(true)
        throw error
      } finally {
        if (revision === pending.current) setSelecting(false)
      }
    },
    [client, document]
  )
  const readRaw = useCallback(
    async (resource: ReplayResource, signal?: AbortSignal) => {
      const local = document.resources.find(
        (item) => item.id === resource.id && item.versionId === resource.versionId
      )
      if (local) return client.researchArtifact(local, signal)
      const material = recordings.find(({ payload }) =>
        payload.media.some(
          (media) =>
            media.artifactId === resource.artifactId && media.versionId === resource.versionId
        )
      )
      if (!material) throw new ReplayViewerRequestError('unavailable')
      return client.researchMedia(material.descriptor.id, material.payload, resource, signal)
    },
    [client, document, recordings]
  )
  const readResource = useCallback(
    (resource: ReplayResource) => client.prepareResearchResource(resource, () => readRaw(resource)),
    [client, readRaw]
  )
  const readNotebookRun: ReplayNotebookRunReader = useCallback(
    (_source, run, options) => client.notebook(run.runId, options?.signal),
    [client]
  )
  const results = useMemo(
    () => researchResults(document, recordings, research.supportingResourceIds),
    [document, recordings, research.supportingResourceIds]
  )
  const current = recordings.find(({ descriptor }) => descriptor.id === recordingId)
  const track = useMemo(
    () =>
      current && !('indexChecksum' in current.payload)
        ? 'archive' in current.payload
          ? projectLegacyObservationToTrack(current.payload.archive)
          : projectRecordingToTrack(current.payload.recording)
        : undefined,
    [current]
  )
  const readImage = useCallback(
    async (mediaKey: string, signal: AbortSignal) => {
      if (!current || 'indexChecksum' in current.payload) return null
      const resource = recordedMediaResource(current.payload, mediaKey)
      const prepared = await client.prepareResearchResource(resource, () =>
        client.researchMedia(current.descriptor.id, current.payload, resource, signal)
      )
      return prepared.status === 'ready' && prepared.kind === 'image' ? prepared.content : null
    },
    [client, current]
  )
  const mediaUrl = useCallback(
    (mediaKey: string) =>
      current ? client.researchMediaUrl(current.descriptor.id, current.payload, mediaKey) : null,
    [client, current]
  )
  const chooseNotebook = useCallback(() => {
    setMaterialId('notebook')
    setMaterialRequest((previous) => ({ id: 'notebook', revision: (previous?.revision ?? 0) + 1 }))
  }, [])
  const askResource = useCallback(
    async (resource: ReplayResource, playback?: ReplayMaterialPlayback) => {
      const position = researchPosition(document, timed.recordedTimeOrigins, playback)
      const fixed = document.resources.find(
        (item) =>
          item.versionId === resource.versionId &&
          item.artifactId === resource.artifactId &&
          item.fileId === resource.fileId
      )
      if (!position || !fixed) throw new ReplayViewerRequestError('unavailable')
      await select({ ...position, resourceId: fixed.id })
    },
    [document, select, timed.recordedTimeOrigins]
  )
  const materials = useMemo<ReplayMaterialView[]>(
    () => [
      {
        id: 'project',
        label: t('Project replay'),
        content: (active, playback) => {
          const payload = current?.payload
          const web = payload && 'indexChecksum' in payload ? payload : undefined
          const coverage =
            web && playback?.branchId
              ? timed.coverage[playback.branchId]?.find(
                  (item) =>
                    item.recordingId === web.recording.recordingId &&
                    (['projectId', 'sessionId', 'artifactId', 'versionId'] as const).every(
                      (key) => item.target[key] === web.receiving[key]
                    )
                )
              : undefined
          const aligned = Boolean(web && playback?.continuous && coverage)
          const at = playback?.recordedAt
          return (
            <div className="flex h-full min-h-0 flex-col">
              <div className="shrink-0 space-y-2 border-b border-border-200 p-2">
                <p className="text-xs text-muted-foreground">
                  {t('Choose saved project evidence. No environment is started.')}
                </p>
                {recordings.length > 1 ? (
                  <select
                    aria-label={t('Project recording')}
                    className="w-full rounded border border-border-200 bg-bg-000 p-2 text-xs"
                    value={recordingId}
                    onChange={(event) => setRecordingId(event.target.value)}
                  >
                    {recordings.map(({ descriptor }) => (
                      <option key={descriptor.id} value={descriptor.id}>
                        {descriptor.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              {!current ? (
                <p className="p-3 text-sm text-muted-foreground">
                  {t('No project images were recorded. Other research materials remain available.')}
                </p>
              ) : null}
              {web && aligned ? (
                <RecordedFootageStatus
                  recording={web.recording}
                  recordedAt={at}
                  onSeek={(timestamp) => playback?.onSeekRecordedAt(timestamp)}
                  onShowNotebook={chooseNotebook}
                />
              ) : null}
              {web ? (
                <BrowserRecordingPlayer
                  key={current!.descriptor.id}
                  active={active}
                  recording={web.recording}
                  mediaUrl={mediaUrl}
                  transport={{
                    offsetMs:
                      aligned && at !== undefined ? at - web.recording.startedAt : undefined,
                    playing: Boolean(playback?.playing && aligned),
                    speed: playback?.speed ?? 1,
                    onSeek: (offsetMs) =>
                      playback?.onSeekRecordedAt(web.recording.startedAt + offsetMs)
                  }}
                  onAskMoment={async (offsetMs) => {
                    const position = researchPosition(
                      document,
                      timed.recordedTimeOrigins,
                      playback,
                      web.recording.startedAt + offsetMs
                    )
                    if (!position) throw new ReplayViewerRequestError('unavailable')
                    await select({ ...position, recordingId: current!.descriptor.id, offsetMs })
                  }}
                />
              ) : null}
              {track ? (
                <ProjectReplay
                  key={current!.descriptor.id}
                  track={track}
                  active={active}
                  readImage={readImage}
                  transport={{
                    recordedAt: playback?.recordedAt,
                    onSeekRecordedAt: (at) => playback?.onSeekRecordedAt(at)
                  }}
                  onAskFrame={async (frame) => {
                    if (!current || 'indexChecksum' in current.payload) return
                    await askResource(
                      recordedMediaResource(current.payload, frame.mediaKey),
                      playback
                    )
                  }}
                />
              ) : null}
            </div>
          )
        }
      },
      {
        id: 'results',
        label: t('Results'),
        content: (_active, playback) => (
          <ResultsPanel
            entries={results}
            recordedAt={playback?.recordedAt}
            read={readRaw}
            onAskFile={(entry) => askResource(entry.resource, playback)}
          />
        )
      }
    ],
    [
      t,
      current,
      timed,
      recordings,
      recordingId,
      chooseNotebook,
      mediaUrl,
      document,
      select,
      track,
      readImage,
      askResource,
      results,
      readRaw
    ]
  )
  const askStep = useCallback(
    (capture: SessionDiscussionCapture) => {
      const step = document.branches
        .find((branch) => branch.id === capture.branchId)
        ?.steps.find((step) => step.id === capture.stepId)
      if (!step) return
      const timeMs = step.startMs + capture.stepOffsetMs
      const origin = timed.recordedTimeOrigins[capture.branchId]
      void select({
        branchId: capture.branchId,
        scope: capture.scope,
        stepId: capture.stepId,
        timeMs,
        ...(origin === undefined ? {} : { recordedAt: origin + timeMs })
      }).catch(() => undefined)
    },
    [document, timed.recordedTimeOrigins, select]
  )
  const reference = selection
    ? JSON.stringify(
        {
          kind: 'open-science-research-replay',
          viewerId: context.viewerId,
          selectionId: selection.selectionId,
          source: {
            projectId: selection.source.projectId,
            sessionId: selection.source.sessionId,
            fingerprint: selection.source.fingerprint
          },
          position: selection.position,
          phase: selection.phase,
          inspection: selection.inspection
        },
        null,
        2
      )
    : undefined
  return (
    <main
      className="flex h-svh min-h-0 flex-col bg-bg-000 text-text-100"
      data-testid="research-replay-viewer"
    >
      {reference ? (
        <ReferencePanel
          key={selection!.selectionId}
          reference={reference}
          kind={selection!.moment ? 'moment' : selection!.resource ? 'file' : 'step'}
          observedAt={selection!.position.recordedAt}
          presentation={context.presentation}
        />
      ) : null}
      {selectionFailed ? (
        <ErrorNotice inline title={t('Could not reference this research evidence.')} />
      ) : null}
      {unavailable ? (
        <p className="shrink-0 px-3 py-2 text-xs text-status-warning-foreground">
          {t('Some saved recordings are unavailable. Other research records remain available.')}
        </p>
      ) : null}
      {research.recordingsTruncated ? (
        <p className="shrink-0 px-3 py-2 text-xs text-status-warning-foreground">
          {t('Some saved recordings are not listed. The research history remains available.')}
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        <ReplayPanel
          host={null}
          document={document}
          initialView={initialView}
          recordedTimeOrigins={timed.recordedTimeOrigins}
          recordedCoverage={timed.timelineCoverage}
          materialViews={materials}
          materialViewRequest={materialRequest}
          onMaterialViewChange={setMaterialId}
          readNotebookRun={readNotebookRun}
          readResource={readResource}
          discussionPending={selecting}
          onAskStep={askStep}
          onViewChange={(view) => saveView(context.viewerId, document, view)}
          renderResource={(resource) => (
            <BrowserArtifactPreview key={resource.id} resource={resource} read={readRaw} />
          )}
        />
      </div>
    </main>
  )
}

export function ResearchReplayViewerApp({
  context,
  client: providedClient
}: {
  context: ResearchReplayViewerContext
  client?: ResearchReplayClient
}): React.JSX.Element {
  const { t } = useTranslation()
  const [client] = useState(() => providedClient ?? new ResearchReplayClient())
  const [retry, setRetry] = useState(0)
  const [loaded, setLoaded] = useState<{
    research: ResearchReplayDocument
    recordings: ResearchRecordingMaterial[]
    unavailable: boolean
  }>()
  const [error, setError] = useState<'authorization' | 'unavailable'>()
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      const research = await client.document(context.target, controller.signal)
      const recordings: ResearchRecordingMaterial[] = []
      let unavailable = research.unavailableRecordingIds.length > 0
      // Bounded concurrent index reads. Media, full Notebook outputs and files stay lazy.
      for (let offset = 0; offset < research.recordings.length; offset += 4) {
        const batch = research.recordings.slice(offset, offset + 4)
        const results = await Promise.allSettled(
          batch.map((descriptor) => client.researchRecording(descriptor, controller.signal))
        )
        results.forEach((result, index) => {
          if (result.status === 'fulfilled')
            recordings.push({ descriptor: batch[index], payload: result.value })
          else if (
            result.reason instanceof ReplayViewerRequestError &&
            result.reason.kind === 'authorization'
          )
            throw result.reason
          else unavailable = true
        })
        controller.signal.throwIfAborted()
      }
      if (!controller.signal.aborted) setLoaded({ research, recordings, unavailable })
    })().catch((reason) => {
      if (!controller.signal.aborted)
        setError(
          reason instanceof ReplayViewerRequestError && reason.kind === 'authorization'
            ? 'authorization'
            : 'unavailable'
        )
    })
    return () => controller.abort()
  }, [client, context.target, retry])
  if (!loaded)
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <ErrorNotice
          tone={error ? 'amber' : 'teal'}
          role={error ? 'alert' : 'status'}
          title={
            error === 'authorization'
              ? t('This observation link is no longer authorized.')
              : error
                ? t('Could not read the recorded material.')
                : t('Loading replay…')
          }
          description={
            error === 'authorization'
              ? t(
                  'Open a new viewer from Open Science or your agent. Existing experiments are not restarted.'
                )
              : undefined
          }
          primaryButton={
            error === 'unavailable'
              ? {
                  label: t('Retry'),
                  onClick: () => {
                    setError(undefined)
                    setRetry((value) => value + 1)
                  }
                }
              : undefined
          }
        />
      </main>
    )
  return <ResearchReplayContent client={client} context={context} {...loaded} />
}
