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
import type { ReplayDocument } from '../../../../../shared/replay'
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
import { readRecordedResource } from './results/recorded-resource-reader'
import { readReplayResource } from './replay-resources'
import { ResultsPanel, type ReplayResultEntry } from './results/ResultsPanel'
import { ProjectReplay } from './ProjectReplay'
import type { RecordingDiscovery } from './use-recording-discovery'
import type { RecordingCandidate } from './recording-discovery'
import type { ReplayMaterialView } from './ReplayStage'

type Candidate = RecordingCandidate & { localHistory?: boolean }
export function useRecordedMaterials(
  document: ReplayDocument | undefined,
  discovery: RecordingDiscovery,
  legacySource?: ResearchDemoSource
): {
  views: ReplayMaterialView[]
  choose: (candidate: RecordingCandidate) => void
  request?: { id: string; revision: number }
} {
  const { t } = useTranslation()
  const sourceKey = JSON.stringify([
    document?.source.projectId,
    document?.source.sessionId,
    legacySource
  ])
  const askRequest = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => askRequest.current?.abort(), [sourceKey])
  const [history, setHistory] = useState<ResearchDemoHistory>()
  const [historyFailed, setHistoryFailed] = useState(false)
  const [selected, setSelected] = useState<Candidate>()
  const [request, setRequest] = useState<{ id: string; revision: number }>()
  const [payload, setPayload] = useState<RecordedObservationPayload | RecordedProjectPayload>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadedSourceKey, setLoadedSourceKey] = useState(sourceKey)
  if (loadedSourceKey !== sourceKey) {
    setLoadedSourceKey(sourceKey)
    setSelected(undefined)
    setPayload(undefined)
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
    setLoadFailed(false)
    if (reveal)
      setRequest((previous) => ({ id: 'project', revision: (previous?.revision ?? 0) + 1 }))
  }, [])
  useEffect(() => {
    if (!selected) return
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
  const results = useMemo<ReplayResultEntry[]>(
    () =>
      payload
        ? recordedResults(payload)
        : (document?.resources ?? []).map((resource) => ({
            resource,
            source: { kind: 'session-history', id: document!.source.sessionId },
            scope: { kind: 'recording' },
            stage: 'unspecified'
          })),
    [payload, document]
  )
  const readResults = useMemo(
    () =>
      payload
        ? authorizedRecordedResultsReader(payload, readRecordedResource)
        : readRecordedResource,
    [payload]
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
          }
        }}
      >
        <option value="">{t('Research source files')}</option>
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
    selected && !payload ? (
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
    choose,
    request,
    views: [
      {
        id: 'project',
        label: t('Project replay'),
        content: (active) => (
          <>
            {catalog}
            {pending ??
              (track ? (
                <ProjectReplay
                  active={active}
                  track={track}
                  readImage={readImage}
                  onAskFrame={(frame) => askFile(frame.mediaKey)}
                />
              ) : (
                <p className="p-3 text-sm text-muted-foreground">
                  {t('No project images were recorded. Other research materials remain available.')}
                </p>
              ))}
          </>
        )
      },
      {
        id: 'results',
        label: t('Results'),
        content: (
          <>
            {catalog}
            {pending ?? (
              <ResultsPanel
                entries={results}
                read={readResults}
                onAskFile={payload ? (entry) => askFile(entry.mediaKey!) : undefined}
              />
            )}
          </>
        )
      }
    ]
  }
}
