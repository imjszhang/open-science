import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorNotice } from '@/components/error-notice'
import { LiveReplayView } from './replay/LiveReplayView'
import {
  authorizedRecordedResourceReader,
  projectRecordedObservation,
  type RecordedObservationReceivingScope,
  type ResolvedObservationMedia,
  type RecordedRunObservationSelection,
  type RecordedObservationResourceRenderer
} from '@/lib/replay/recorded-observation'
import type { RunObservationArchive } from '../../../../shared/run-observation-archive'
import type { RunObservationExecutionContext } from '../../../../shared/run-observation'
import type { ReplayResourceReader } from './replay/replay-resources'
import { RecordedProjectImages, type RecordedProjectImage } from './replay/RecordedProjectImages'

export type RecordedRunObservationPreviewProps = {
  archive: RunObservationArchive
  receiving: RecordedObservationReceivingScope
  media: readonly ResolvedObservationMedia[]
  title: string
  executionContext?: RunObservationExecutionContext
  isActive?: boolean
  readResource: ReplayResourceReader
  renderResource?: RecordedObservationResourceRenderer
  onAskArchiveSelection: (selection: RecordedRunObservationSelection) => void | Promise<void>
}

export const RecordedRunObservationPreview = (
  props: RecordedRunObservationPreviewProps
): React.JSX.Element => {
  const { t } = useTranslation()
  // Hosts may recreate a target object while updating a reference or title. Only an actual
  // receiving Artifact Version change should rebuild all immutable archive snapshots.
  const { projectId, sessionId, artifactId, versionId } = props.receiving
  const receiving = useMemo(
    () => ({ projectId, sessionId, artifactId, versionId }),
    [projectId, sessionId, artifactId, versionId]
  )
  const projection = useMemo(() => {
    try {
      return projectRecordedObservation(props.archive, receiving, props.media)
    } catch {
      return undefined
    }
  }, [props.archive, receiving, props.media])
  const readResource = useMemo(
    () =>
      projection
        ? authorizedRecordedResourceReader(projection.resolveResource, props.readResource)
        : async () => ({ status: 'unavailable' as const, reason: 'not-recorded' as const }),
    [projection, props.readResource]
  )
  const imagesByStep = useMemo(() => {
    const result = new Map<string, RecordedProjectImage[]>()
    const resolved = new Map(props.media.map((item) => [item.mediaKey, item]))
    for (const media of props.archive.media) {
      const mapping = resolved.get(media.mediaKey)
      if (!media.capture) continue
      for (const key of new Set(media.stepKeys)) {
        const image = {
          id:
            mapping && projection?.resources.has(mapping.versionId)
              ? mapping.versionId
              : `missing:${media.mediaKey}`,
          capture: media.capture,
          publication: 'published' as const
        }
        const entries = result.get(key)
        if (entries) entries.push(image)
        else result.set(key, [image])
      }
    }
    return result
  }, [props.archive, props.media, projection])
  const readImage = useCallback(
    async (id: string) => {
      const resource = projection?.resources.get(id)
      if (!resource) return null
      const value = await readResource(resource)
      return value.status === 'ready' && value.kind === 'image' ? value.content : null
    },
    [projection, readResource]
  )
  if (!projection) return <ErrorNotice inline title={t('The recorded evidence is unavailable.')} />
  const archive = props.archive,
    source = archive.records.at(-1)!.sourceEvidence.identity
  const incomplete =
    !archive.coverage.terminalRunObserved ||
    archive.coverage.droppedEarlierObservations ||
    Boolean(
      archive.coverage.samplingFailures ||
      archive.coverage.unavailableSamples ||
      archive.coverage.sourceCursorGaps
    )
  const capacityMessage =
    archive.coverage.stopReason === 'capacity'
      ? archive.coverage.capacityLimit === 'snapshots'
        ? t(
            'Recording stopped at the observation count limit. Earlier records are preserved; later activity was not recorded.'
          )
        : archive.coverage.capacityLimit === 'record-bytes'
          ? t(
              'Recording stopped at this recording’s size limit. Earlier records are preserved; later activity was not recorded.'
            )
          : t(
              'Recording stopped at the total recording storage limit. Earlier records are preserved; later activity was not recorded.'
            )
      : undefined
  return (
    <div className="flex h-full min-h-0 flex-col" hidden={props.isActive === false}>
      <p className="shrink-0 px-3 pt-2 text-xs text-muted-foreground">
        {t(
          'Original IDs identify source evidence. Viewing this recording does not create a local Run.'
        )}
      </p>
      <details className="shrink-0 border-b border-border-200 px-3 py-2 text-xs">
        <summary className="cursor-pointer font-medium">{t('Archived observation')}</summary>
        <div className="mt-2 space-y-2">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 break-all">
            <dt>{t('Recording ID')}</dt>
            <dd>{archive.recordingId}</dd>
            <dt>{t('Source project')}</dt>
            <dd>{source.projectId}</dd>
            <dt>{t('Source Session')}</dt>
            <dd>{source.sessionId}</dd>
            {source.runId ? (
              <>
                <dt>{t('Source Run')}</dt>
                <dd>{source.runId}</dd>
              </>
            ) : null}
          </dl>
          <p>
            {t('Recorded from {{start}} to {{end}}.', {
              start: new Date(archive.coverage.firstObservedAt).toISOString(),
              end: new Date(archive.coverage.lastObservedAt).toISOString()
            })}
          </p>
          <p>{t('Activity before observation began is not included.')}</p>
        </div>
      </details>
      {capacityMessage ||
      incomplete ||
      projection.unresolvedMediaKeys.length ||
      projection.unlinkedSourceFiles ? (
        <div
          role="status"
          className="shrink-0 space-y-1 border-b border-border-200 px-3 py-2 text-xs text-status-warning-foreground"
        >
          {capacityMessage ? (
            <p>{capacityMessage}</p>
          ) : incomplete ? (
            <p>{t('This recording has gaps or ended before the Run finished.')}</p>
          ) : null}
          {projection.unresolvedMediaKeys.length ? (
            <p>{t('Some recorded media could not be resolved on this device.')}</p>
          ) : null}
          {projection.unlinkedSourceFiles ? (
            <p>{t('Some source files have no linked recorded media.')}</p>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <LiveReplayView
          title={props.title}
          executionContext={props.executionContext}
          sourceIdentity={projection.sourceIdentity}
          snapshot={projection.snapshots.at(-1)!}
          history={projection.snapshots}
          connection="disconnected"
          recorded
          active={props.isActive}
          historyTruncated={archive.coverage.droppedEarlierObservations}
          readResource={readResource}
          renderRecordedSurface={(snapshot) => {
            const images = imagesByStep.get(snapshot.stepId)
            return images?.length ? (
              <RecordedProjectImages
                key={snapshot.stepId}
                images={images}
                readImage={readImage}
                sourceStep={snapshot.stepId}
              />
            ) : undefined
          }}
          renderResource={
            props.renderResource
              ? (resource, onClose) => {
                  const authorized = projection.resolveResource(resource)
                  return authorized ? (
                    props.renderResource!(authorized, onClose)
                  ) : (
                    <ErrorNotice inline title={t('The recorded evidence is unavailable.')} />
                  )
                }
              : undefined
          }
          onAskSelection={(snapshot) => props.onAskArchiveSelection(projection.select(snapshot))}
        />
      </div>
    </div>
  )
}
