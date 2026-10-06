import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorNotice } from '@/components/error-notice'
import {
  useRunObservationQuestionStore,
  type ObservationQuestionSelection
} from '@/stores/run-observation-question-store'
import type { ObservationQuestionRecovery } from './replay/use-observation-question-recovery'
import { useObservationRecordingStatus } from './replay/use-observation-recording-status'
import { ObservationRecordingStatus } from './replay/ObservationRecordingStatus'
import { showRecordedObservation } from './replay/open-run-observation'
import type {
  RunObservationSelection,
  RunObservationTarget
} from '../../../../shared/run-observation'
import type {
  RunObservationViewerAccess,
  RecordedObservationViewerAccess
} from '../../../../shared/run-observation-viewer'
import type {
  RecordedObservationTarget,
  RecordedRunObservationSelection
} from '../../../../shared/run-observation-recorded'
type ViewerAccess = RunObservationViewerAccess | RecordedObservationViewerAccess

export type RunObservationPreviewProps = {
  title: string
  isActive: boolean
  questionRecovery?: ObservationQuestionRecovery
} & (
  | {
      mode?: 'live'
      target: RunObservationTarget
      allowInteraction?: boolean
      allowCancel?: boolean
      allowCapture?: boolean
      onAskSelection?: (
        selection: RunObservationSelection,
        viewerId: string
      ) => void | Promise<void>
      onAskArchiveSelection?: never
    }
  | {
      mode: 'recorded'
      target: RecordedObservationTarget
      allowInteraction?: never
      allowCancel?: never
      allowCapture?: never
      onAskSelection?: never
      onAskArchiveSelection?: (
        selection: RecordedRunObservationSelection,
        viewerId: string
      ) => void | Promise<void>
    }
)

const targetKey = (target: RunObservationTarget | RecordedObservationTarget): string =>
  JSON.stringify(
    'artifactId' in target
      ? ['recorded', target.projectId, target.sessionId, target.artifactId, target.versionId]
      : [
          'live',
          target.projectId,
          target.sessionId,
          target.operationId,
          target.executionInvocationId,
          target.runId
        ]
  )
const validAccess = (
  access: ViewerAccess,
  target: RunObservationTarget | RecordedObservationTarget
): boolean => {
  if (targetKey(access.target) !== targetKey(target)) return false
  try {
    const url = new URL(access.url)
    return (
      url.protocol === 'http:' &&
      url.hostname === `viewer-${access.viewerId}.localhost` &&
      Boolean(url.port) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname === '/__open_science_viewer' &&
      /^[a-f0-9]{64}$/.test(url.searchParams.get('grant') ?? '') &&
      [...url.searchParams.keys()].length === 1
    )
  } catch {
    return false
  }
}
const matchesSelection = (
  selection: RunObservationSelection,
  target: RunObservationTarget
): boolean => {
  const identity = selection.identity
  return (
    identity.projectId === target.projectId &&
    identity.sessionId === target.sessionId &&
    (['operationId', 'executionInvocationId', 'runId'] as const).every(
      (key) => !target[key] || target[key] === identity[key]
    ) &&
    selection.cursor.epoch === selection.snapshot.cursor.epoch &&
    selection.cursor.sequence === selection.snapshot.cursor.sequence &&
    selection.stepId === selection.snapshot.stepId &&
    targetKey(identity) === targetKey(selection.snapshot.identity)
  )
}

/** Electron owns only this viewer's lifetime and selection delivery. The embedded browser bundle
 * owns the same scoped observation UI used by an external agent. No cross-origin message bridge. */
const RunObservationPreviewContent = (props: RunObservationPreviewProps): React.JSX.Element => {
  const { t } = useTranslation()
  const [admission] = useState(() =>
    props.mode === 'recorded'
      ? { mode: 'recorded' as const, target: props.target }
      : {
          mode: 'live' as const,
          target: props.target,
          allowInteraction: props.allowInteraction,
          allowCancel: props.allowCancel,
          allowCapture: props.allowCapture
        }
  )
  const [access, setAccess] = useState<ViewerAccess>()
  const [openFailed, setOpenFailed] = useState(false)
  const [selectionFailed, setSelectionFailed] = useState<'read' | 'ask'>()
  const [retry, setRetry] = useState(0)
  const liveTarget = admission.mode === 'live' ? admission.target : undefined
  const readRecordingStatus = useCallback(
    () => window.api.observations.recordingStatus({ target: liveTarget! }),
    [liveTarget]
  )
  const { status: recordingStatus } = useObservationRecordingStatus({
    target: liveTarget,
    read: readRecordingStatus,
    active: Boolean(
      liveTarget &&
      access &&
      props.isActive &&
      typeof window.api?.observations?.recordingStatus === 'function'
    ),
    // The outer host does not own the iframe's live snapshot. Keep checking until the
    // exact archive receipt settles or the preview becomes inactive.
    running: true
  })
  const delivered = useRef(new Set<string>())
  const [requestedSelectionId, setRequestedSelectionId] = useState<string>()
  const [recovering, setRecovering] = useState(false)
  const failedSelection = useRef<ObservationQuestionSelection | undefined>(undefined)
  const recoveryRequest = useRef<AbortController | undefined>(undefined)
  const added = useRunObservationQuestionStore((state) => state.lastAdded)
  const draftReceived = Boolean(
    requestedSelectionId && added?.selection.selectionId === requestedSelectionId
  )
  const current = useRef(props)
  useLayoutEffect(() => {
    current.current = props
    if (!props.isActive) recoveryRequest.current?.abort()
  }, [props])
  useEffect(() => () => recoveryRequest.current?.abort(), [])
  useEffect(() => {
    let disposed = false,
      opened: ViewerAccess | undefined
    const api = window.api?.observations
    const revoke = (viewerId: string): void => {
      void api?.revoke({ viewerId }).catch(() => undefined)
    }
    if (!api) {
      queueMicrotask(() => {
        if (!disposed) setOpenFailed(true)
      })
      return () => {
        disposed = true
      }
    }
    const opening =
      admission.mode === 'recorded'
        ? api.openRecorded({ target: admission.target })
        : api.open({
            target: admission.target,
            allowInteraction: admission.allowInteraction,
            allowCancel: admission.allowCancel,
            allowCapture: admission.allowCapture
          })
    void opening.then(
      (result) => {
        if (disposed) {
          revoke(result.viewerId)
          return
        }
        if (
          !validAccess(result, admission.target) ||
          (admission.mode === 'recorded') !== ('mode' in result && result.mode === 'recorded')
        ) {
          revoke(result.viewerId)
          setOpenFailed(true)
          return
        }
        opened = result
        setAccess(result)
        setOpenFailed(false)
      },
      () => {
        if (!disposed) setOpenFailed(true)
      }
    )
    return () => {
      disposed = true
      if (opened) revoke(opened.viewerId)
    }
  }, [admission, retry])
  useEffect(() => {
    if (!access || !props.isActive || !(props.onAskSelection || props.onAskArchiveSelection)) return
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try {
        let selectionId: string | undefined,
          selectedEvidence: ObservationQuestionSelection | undefined,
          deliver: (() => void | Promise<void>) | undefined
        if (admission.mode === 'recorded') {
          const selected = await window.api.observations.recordingSelection({
            viewerId: access.viewerId
          })
          const destination = current.current
          if (disposed || !destination.isActive || destination.mode !== 'recorded') return
          if (selected) {
            if (
              !selected.selectionId ||
              targetKey(selected.receiving) !== targetKey(admission.target)
            )
              throw new Error('Recorded selection scope changed.')
            selectionId = selected.selectionId
            selectedEvidence = selected
            deliver = destination.onAskArchiveSelection
              ? () => destination.onAskArchiveSelection!(selected, access.viewerId)
              : undefined
          }
        } else {
          const selected = await window.api.observations.selection({ viewerId: access.viewerId })
          const destination = current.current
          if (disposed || !destination.isActive || destination.mode === 'recorded') return
          if (selected) {
            if (!matchesSelection(selected, admission.target))
              throw new Error('Selection scope changed.')
            selectionId = selected.selectionId
            selectedEvidence = selected
            deliver = destination.onAskSelection
              ? () => destination.onAskSelection!(selected, access.viewerId)
              : undefined
          }
        }
        if (selectionId && deliver && !delivered.current.has(selectionId)) {
          recoveryRequest.current?.abort()
          setRecovering(false)
          delivered.current.add(selectionId)
          setRequestedSelectionId(selectionId)
          // Freeze this exact explicit Ask action before navigation or later observations.
          failedSelection.current = selectedEvidence && structuredClone(selectedEvidence)
          try {
            await deliver()
            if (!disposed) {
              failedSelection.current = undefined
              setSelectionFailed(undefined)
            }
          } catch {
            if (!disposed) setSelectionFailed('ask')
          }
        }
      } catch {
        if (!disposed) setSelectionFailed('read')
      }
      if (!disposed)
        timer = setTimeout(() => {
          void poll()
        }, 750)
    }
    void poll()
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
    }
  }, [access, admission, props.isActive, props.onAskSelection, props.onAskArchiveSelection])
  return (
    // Keep the iframe inside fractional clipping/viewport edges and outside the workspace
    // divider's 20px hit area, which extends 9.5px into this panel. Preserve that drag corridor.
    <div className="flex h-full min-h-0 flex-col p-px pl-2.5" hidden={!props.isActive}>
      {openFailed ? (
        <ErrorNotice
          inline
          title={t('Could not open the research viewer.')}
          description={
            props.mode === 'recorded'
              ? t('The recorded evidence is unavailable.')
              : t('The experiment may still be running. Retry to open a new observation link.')
          }
          primaryButton={{ label: t('Retry'), onClick: () => setRetry((value) => value + 1) }}
        />
      ) : access ? (
        <>
          {recordingStatus?.archive ? (
            <div className="shrink-0 border-b border-border-200 px-3 py-2">
              <ObservationRecordingStatus
                status={recordingStatus}
                onOpenArchive={() =>
                  showRecordedObservation(recordingStatus.archive!, t('Archived observation'))
                }
              />
            </div>
          ) : null}
          {draftReceived ? (
            <p role="status" className="shrink-0 border-b border-border-200 px-3 py-2 text-xs">
              {t('Selected step added to the current draft. Review it before sending.')}
            </p>
          ) : null}
          {selectionFailed && !draftReceived ? (
            <ErrorNotice
              inline
              title={t('Could not reference this recorded step.')}
              description={
                selectionFailed === 'ask'
                  ? props.mode === 'recorded'
                    ? t(
                        'Open an editable Session in this Project, or use Discuss from the imported research, to ask about this step.'
                      )
                    : t('Open the recorded Session to ask about this step.')
                  : t('Return to this preview and select the step again.')
              }
              primaryButton={
                selectionFailed === 'ask' && props.questionRecovery
                  ? {
                      label: props.questionRecovery.label,
                      loading: recovering,
                      onClick: () => {
                        const selection = failedSelection.current
                        if (recovering || !selection) return
                        const abort = new AbortController()
                        recoveryRequest.current?.abort()
                        recoveryRequest.current = abort
                        setRecovering(true)
                        void Promise.resolve()
                          .then(() =>
                            props.questionRecovery!.onClick(
                              structuredClone(selection),
                              abort.signal
                            )
                          )
                          .catch(() => {
                            if (!abort.signal.aborted) setSelectionFailed('ask')
                          })
                          .finally(() => {
                            if (recoveryRequest.current === abort) setRecovering(false)
                          })
                      }
                    }
                  : undefined
              }
            />
          ) : null}
          <iframe
            key={access.viewerId}
            title={props.title}
            src={access.url}
            sandbox="allow-scripts allow-same-origin allow-forms"
            referrerPolicy="no-referrer"
            className="min-h-0 w-full flex-1 border-0"
          />
        </>
      ) : (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          {props.mode === 'recorded'
            ? t('Loading archived observation…')
            : t('Connecting to the research run…')}
        </p>
      )}
    </div>
  )
}
export const RunObservationPreview = (props: RunObservationPreviewProps): React.JSX.Element => (
  <RunObservationPreviewContent
    key={`${targetKey(props.target)}:${Boolean(props.allowInteraction)}:${Boolean(props.allowCancel)}:${Boolean(props.allowCapture)}`}
    {...props}
  />
)
