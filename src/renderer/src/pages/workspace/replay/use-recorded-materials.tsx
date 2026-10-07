import { RunObservationPreview } from '../RunObservationPreview'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ErrorNotice } from '@/components/error-notice'
import { useNavigationStore } from '@/stores/navigation-store'
import {
  sameObservationQuestionDestination,
  useRunObservationQuestionStore
} from '@/stores/run-observation-question-store'
import { useObservationQuestionRecovery } from './use-observation-question-recovery'
import type { ReplayDocument, ReplayResource } from '../../../../../shared/replay'
import type { RecordedBrowserPayload } from '../../../../../shared/browser-recording'
import {
  createResearchReplayTimeline,
  type ResearchReplayTimeline
} from '@/lib/replay/recorded-time'
import type {
  RecordedObservationPayload,
  RecordedProjectPayload
} from '../../../../../shared/run-observation-recorded'
import type { ResearchDemoSource, ResearchDemoHistory } from '../../../../../shared/research-demo'
import {
  projectLegacyObservationToTrack,
  projectRecordingToTrack
} from '../../../../../shared/project-recording'
import {
  recordedResults,
  recordedMediaResource,
  authorizedRecordedResultsReader
} from '@/lib/replay/recorded-results'
import {
  readRecordedResource,
  type RecordedResourceReader
} from './results/recorded-resource-reader'
import { readReplayResource } from './replay-resources'
import { ResultsPanel, type ReplayResultEntry } from './results/ResultsPanel'
import { ProjectReplay } from './ProjectReplay'
import { RecordedFootageStatus } from './RecordedFootageStatus'
import type { RecordingDiscovery } from './use-recording-discovery'
import type { RecordingCandidate } from './recording-discovery'
import type { ReplayMaterialView } from './ReplayStage'
import { showRecordedObservation } from './open-run-observation'

type Candidate = RecordingCandidate & { localHistory?: boolean }
export function useRecordedMaterials(
  document: ReplayDocument | undefined,
  discovery: RecordingDiscovery,
  legacySource?: ResearchDemoSource,
  onAskSourceFile?: (resource: ReplayResource) => Promise<void> | void
): {
  views: ReplayMaterialView[]
  choose: (candidate: RecordingCandidate) => void
  request?: { id: string; revision: number }
  playbackDocument?: ReplayDocument
  recordedTimeOrigins?: Readonly<Record<string, number>>
  playbackKey?: string
  timingReady: boolean
  timelineCoverage?: ResearchReplayTimeline['timelineCoverage']
} {
  const { t } = useTranslation()
  const sourceKey = JSON.stringify([
    document?.source.projectId,
    document?.source.sessionId,
    document?.source.fingerprint,
    legacySource
  ])
  const askRequest = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => askRequest.current?.abort(), [sourceKey])
  const [history, setHistory] = useState<ResearchDemoHistory>()
  const [historyFailed, setHistoryFailed] = useState(false)
  const [selected, setSelected] = useState<Candidate>()
  const [request, setRequest] = useState<{ id: string; revision: number }>()
  const [payload, setPayload] = useState<RecordedObservationPayload | RecordedProjectPayload>()
  const [browserPayload, setBrowserPayload] = useState<RecordedBrowserPayload>()
  const [timing, setTiming] = useState<{
    sourceKey: string
    timeline: ResearchReplayTimeline
    recordings: RecordedBrowserPayload[]
  }>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadedSourceKey, setLoadedSourceKey] = useState(sourceKey)
  if (loadedSourceKey !== sourceKey) {
    setLoadedSourceKey(sourceKey)
    setSelected(undefined)
    setPayload(undefined)
    setBrowserPayload(undefined)
    setTiming(undefined)
    setHistory(undefined)
    setHistoryFailed(false)
    setLoadFailed(false)
    setRequest(undefined)
  }
  const recovery = useObservationQuestionRecovery(
    document
      ? { projectId: document.source.projectId, sessionId: document.source.sessionId }
      : undefined
  )
  useEffect(() => {
    let disposed = false
    if (!document || !legacySource || !window.api?.researchDemos?.readHistory) return
    void window.api.researchDemos.readHistory(legacySource).then(
      (result) => {
        if (!disposed) setHistory(result)
      },
      () => {
        if (!disposed) setHistoryFailed(true)
      }
    )
    return () => {
      disposed = true
    }
  }, [legacySource, sourceKey, document])
  const candidates = useMemo<Candidate[]>(
    () => [
      ...discovery.recordings,
      ...(history?.receipts ?? []).flatMap((receipt) =>
        receipt.recordingTarget
          ? [
              {
                target: receipt.recordingTarget,
                localHistory: true,
                resource: {
                  id: receipt.recordingTarget.versionId,
                  name: receipt.title,
                  projectId: receipt.recordingTarget.projectId,
                  sessionId: receipt.recordingTarget.sessionId,
                  artifactId: receipt.recordingTarget.artifactId,
                  versionId: receipt.recordingTarget.versionId,
                  availability: 'recorded' as const
                }
              }
            ]
          : []
      )
    ],
    [discovery.recordings, history]
  )
  const choose = useCallback((candidate: Candidate, reveal = true) => {
    askRequest.current?.abort()
    setSelected(candidate)
    setPayload(undefined)
    setBrowserPayload(undefined)
    setLoadFailed(false)
    if (reveal)
      setRequest((previous) => ({ id: 'project', revision: (previous?.revision ?? 0) + 1 }))
  }, [])
  // Resolve the research catalog before first playback. Individual headers are read in bounded
  // pages; selecting a tab or a later local execution never rebuilds the source research clock.
  const {
    loading: discoveryLoading,
    scanned: discoveryScanned,
    unchecked: discoveryUnchecked,
    recordings: discoveredRecordings,
    supportingResourceIds: discoveredSupportingIds,
    loadMore: discoverMore
  } = discovery
  useEffect(() => {
    if (!document || timing?.sourceKey === sourceKey || discoveryLoading) return
    if (discoveryScanned === false) return
    if (discoveryUnchecked) {
      discoverMore()
      return
    }
    let disposed = false
    const recordings: RecordedBrowserPayload[] = []
    const candidates = discoveredRecordings.filter((item) => item.format === 'web-recording')
    let index = 0
    const worker = async (): Promise<void> => {
      while (!disposed && index < candidates.length) {
        const candidate = candidates[index++]
        try {
          const value = await window.api.projectRecordings.read({ target: candidate.target })
          if (!disposed) recordings.push(value)
        } catch {
          // Missing footage does not block the original conversation and Notebook.
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(2, candidates.length) }, worker)).then(() => {
      if (!disposed)
        setTiming({
          sourceKey,
          timeline: createResearchReplayTimeline(document, recordings, discoveredSupportingIds),
          recordings
        })
    })
    return () => {
      disposed = true
    }
  }, [
    document,
    sourceKey,
    discoveryLoading,
    discoveryScanned,
    discoveryUnchecked,
    discoveredRecordings,
    discoveredSupportingIds,
    discoverMore,
    timing?.sourceKey
  ])
  useEffect(() => {
    if (selected?.format !== 'web-recording') return
    let disposed = false
    void Promise.resolve()
      .then(() => window.api.projectRecordings.read({ target: selected.target }))
      .then(
        (value) => {
          if (!disposed) setBrowserPayload(value)
        },
        () => {
          if (!disposed) setLoadFailed(true)
        }
      )
    return () => {
      disposed = true
    }
  }, [selected])
  const timed = timing?.sourceKey === sourceKey ? timing.timeline : undefined
  useEffect(() => {
    if (!selected || selected.format === 'web-recording') return
    let disposed = false
    const load =
      selected.format === 'project-recording'
        ? window.api?.observations?.readProjectRecording
        : window.api?.observations?.readRecorded
    void Promise.resolve()
      .then<RecordedObservationPayload | RecordedProjectPayload>(() => {
        if (!load) throw new Error('Recording reader unavailable')
        return load({ target: selected.target })
      })
      .then(
        (value) => {
          if (!disposed) setPayload(value)
        },
        () => {
          if (!disposed) setLoadFailed(true)
        }
      )
    return () => {
      disposed = true
    }
  }, [selected])
  const track = useMemo(
    () =>
      payload
        ? 'archive' in payload
          ? projectLegacyObservationToTrack(payload.archive)
          : projectRecordingToTrack(payload.recording)
        : undefined,
    [payload]
  )
  const readImage = useCallback(
    async (key: string, signal: AbortSignal) => {
      signal.throwIfAborted()
      const resource = payload && recordedMediaResource(payload, key)
      if (!resource) return null
      const value = await readReplayResource(resource)
      signal.throwIfAborted()
      return value.status === 'ready' && value.kind === 'image' ? value.content : null
    },
    [payload]
  )
  const results = useMemo<ReplayResultEntry[]>(() => {
    const attachments = payload && !selected?.localHistory ? recordedResults(payload) : []
    const mapped = new Set(attachments.map((entry) => entry.resource.versionId))
    const supporting = new Set(timed?.supportingResourceIds)
    return [
      ...attachments,
      ...(document?.resources ?? [])
        .filter((resource) => !mapped.has(resource.versionId))
        .map((resource) => ({
          resource,
          source: { kind: 'session-history' as const, id: document!.source.sessionId },
          scope: { kind: 'recording' as const },
          stage: 'unspecified' as const,
          technical: supporting.has(resource.id)
        }))
    ]
  }, [payload, document, selected?.localHistory, timed])
  const readResults = useMemo<RecordedResourceReader>(
    () =>
      payload
        ? (resource, signal) => {
            const sourceResource = document?.resources.find(
              (item) =>
                item.projectId === resource.projectId &&
                item.sessionId === resource.sessionId &&
                item.versionId === resource.versionId &&
                item.checksum === resource.checksum
            )
            return sourceResource
              ? readRecordedResource(sourceResource, signal)
              : authorizedRecordedResultsReader(payload, readRecordedResource)(resource, signal)
          }
        : readRecordedResource,
    [payload, document]
  )
  const askFile = async (mediaKey: string): Promise<void> => {
    if (!payload) return
    askRequest.current?.abort()
    const controller = new AbortController()
    askRequest.current = controller
    const revision = useNavigationStore.getState().explicitNavigationRevision
    const destination = useRunObservationQuestionStore.getState().destination
    const selection = await window.api.observations.selectRecordedFile({
      target: payload.receiving,
      mediaKey,
      format: 'archive' in payload ? 'run-observation' : 'project-recording'
    })
    const currentDestination = useRunObservationQuestionStore.getState().destination
    if (
      controller.signal.aborted ||
      revision !== useNavigationStore.getState().explicitNavigationRevision ||
      ((destination || currentDestination) &&
        !sameObservationQuestionDestination(destination, currentDestination))
    )
      return
    if (!useRunObservationQuestionStore.getState().askRecorded(selection)) {
      if (!recovery) throw new Error('Discussion unavailable')
      await recovery.onClick(selection, controller.signal)
    }
  }
  const catalog = (
    <div className="shrink-0 space-y-2 border-b border-border-200 p-2">
      <p className="text-xs text-muted-foreground">
        {t('Choose saved project evidence. No environment is started.')}
      </p>
      <select
        aria-label={t('Project recording')}
        className="w-full rounded border border-border-200 bg-bg-000 p-2 text-xs"
        value={selected ? JSON.stringify(selected.target) : ''}
        onChange={(event) => {
          const next = candidates.find(
            (candidate) => JSON.stringify(candidate.target) === event.target.value
          )
          if (next) choose(next, false)
          else {
            askRequest.current?.abort()
            setSelected(undefined)
            setPayload(undefined)
            setBrowserPayload(undefined)
          }
        }}
      >
        <option value="">{t('Research source files')}</option>
        {selected &&
        !candidates.some(
          (candidate) => JSON.stringify(candidate.target) === JSON.stringify(selected.target)
        ) ? (
          // A later discovery page may replace a checkpoint in the catalog. Keep the user's
          // explicitly opened immutable Version selected without silently switching its footage.
          <option value={JSON.stringify(selected.target)} disabled>
            {selected.resource.name}
          </option>
        ) : null}
        {candidates.map((candidate) => (
          <option key={JSON.stringify(candidate.target)} value={JSON.stringify(candidate.target)}>
            {candidate.localHistory ? `${t('Local historical run')} · ` : ''}
            {candidate.resource.name}
          </option>
        ))}
      </select>
      {selected?.localHistory ? (
        <p className="text-xs text-muted-foreground">
          {t('Recorded on this device. This is separate from the imported author’s evidence.')}
        </p>
      ) : null}
      {(history?.receipts ?? []).some((receipt) => !receipt.recordingTarget) ? (
        <p className="text-xs text-muted-foreground">
          {t('Some local runs have no saved recording. Viewing history does not resume them.')}
        </p>
      ) : null}
      {historyFailed || discovery.unavailable ? (
        <p className="text-xs text-status-warning-foreground">
          {t('Some source files could not be checked for run recordings.')}
        </p>
      ) : null}
      {discovery.unchecked ? (
        <Button
          size="sm"
          variant="outline"
          onClick={discovery.loadMore}
          disabled={discovery.loading}
        >
          {t('Check more files')}
        </Button>
      ) : null}
    </div>
  )
  const pending =
    selected && selected.format !== 'web-recording' && !payload ? (
      loadFailed ? (
        <ErrorNotice
          inline
          title={t('Could not read the recorded material.')}
          primaryButton={{ label: t('Retry'), onClick: () => choose({ ...selected }) }}
        />
      ) : (
        <p role="status" className="p-3 text-sm">
          {t('Preparing recorded material…')}
        </p>
      )
    ) : null
  return {
    playbackDocument: timed?.document,
    recordedTimeOrigins: timed?.recordedTimeOrigins,
    playbackKey: sourceKey,
    timingReady: !!timed,
    timelineCoverage: timed?.timelineCoverage,
    choose,
    request,
    views: [
      {
        id: 'project',
        label: t('Project replay'),
        content: (active, playback) => {
          const browserAligned = Boolean(
            !selected?.localHistory &&
            browserPayload &&
            playback?.continuous &&
            playback.branchId &&
            timed?.coverage[playback.branchId]?.some(
              (item) => JSON.stringify(item.target) === JSON.stringify(browserPayload.receiving)
            )
          )
          return (
            <>
              {catalog}
              {selected &&
              (selected.localHistory ||
                (selected.format === 'web-recording' && browserPayload && !browserAligned)) ? (
                <div className="shrink-0 px-3 py-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      showRecordedObservation(
                        selected.target,
                        selected.resource.name,
                        selected.format
                      )
                    }
                  >
                    {t('Open recording separately')}
                  </Button>
                </div>
              ) : null}
              {browserPayload && browserAligned ? (
                <RecordedFootageStatus
                  recording={browserPayload.recording}
                  recordedAt={playback?.recordedAt}
                  onSeek={(at) => playback?.onSeekRecordedAt(at)}
                  onShowNotebook={() =>
                    setRequest((previous) => ({
                      id: 'notebook',
                      revision: (previous?.revision ?? 0) + 1
                    }))
                  }
                />
              ) : null}
              {selected?.format === 'web-recording' && loadFailed ? (
                <ErrorNotice
                  inline
                  title={t('Could not read the recorded material.')}
                  primaryButton={{ label: t('Retry'), onClick: () => choose({ ...selected }) }}
                />
              ) : null}
              {selected?.format === 'web-recording' ? (
                <RunObservationPreview
                  mode="recorded"
                  format="web-recording"
                  target={selected.target}
                  title={selected.resource.name}
                  isActive={active}
                  questionRecovery={recovery}
                  playback={
                    playback
                      ? {
                          ...playback,
                          recordedAt: browserAligned ? playback.recordedAt : undefined,
                          playing: browserAligned && playback.playing
                        }
                      : undefined
                  }
                  onAskBrowserMoment={(selection) => {
                    if (!useRunObservationQuestionStore.getState().askRecorded(selection))
                      throw new Error('Discussion unavailable')
                  }}
                />
              ) : (
                (pending ??
                (track ? (
                  <ProjectReplay
                    active={active}
                    transport={
                      playback
                        ? {
                            ...playback,
                            recordedAt:
                              !selected?.localHistory &&
                              payload?.receiving.projectId === document?.source.projectId &&
                              payload?.receiving.sessionId === document?.source.sessionId
                                ? playback.recordedAt
                                : undefined
                          }
                        : undefined
                    }
                    track={track}
                    readImage={readImage}
                    onAskFrame={(frame) => askFile(frame.mediaKey)}
                  />
                ) : (
                  <p className="p-3 text-sm text-muted-foreground">
                    {t(
                      'No project images were recorded. Other research materials remain available.'
                    )}
                  </p>
                )))
              )}
            </>
          )
        }
      },
      {
        id: 'results',
        label: t('Results'),
        content: (_active, playback) => (
          <>
            {catalog}
            {pending ?? (
              <ResultsPanel
                entries={results}
                recordedAt={playback?.continuous ? playback.recordedAt : undefined}
                read={readResults}
                onAskFile={
                  payload || onAskSourceFile
                    ? (entry) =>
                        entry.mediaKey ? askFile(entry.mediaKey) : onAskSourceFile?.(entry.resource)
                    : undefined
                }
              />
            )}
          </>
        )
      }
    ]
  }
}
