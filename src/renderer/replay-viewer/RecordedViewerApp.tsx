import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReplayResource } from '../../shared/replay'
import type {
  RecordedObservationPayload,
  ResolvedObservationMedia,
  RecordedRunObservationSelection
} from '../../shared/run-observation-recorded'
import { RecordedRunObservationPreview } from '../src/pages/workspace/RecordedRunObservationPreview'
import { BrowserArtifactPreview } from './BrowserArtifactPreview'
import { ReferencePanel } from './ReferencePanel'
import { recordedSelectionReference } from './selection-reference'
import { ReplayViewerClient, type RecordedReplayViewerContext } from './client'

const NO_MEDIA: readonly ResolvedObservationMedia[] = []

export const RecordedViewerApp = ({
  client,
  context,
  payload
}: {
  client: ReplayViewerClient
  context: RecordedReplayViewerContext
  payload: RecordedObservationPayload
}): React.JSX.Element => {
  const { t } = useTranslation()
  const [selection, setSelection] = useState<RecordedRunObservationSelection>()
  useEffect(() => {
    const controller = new AbortController()
    void client.recordedSelection(payload, controller.signal).then(
      (saved) => {
        if (!controller.signal.aborted && saved) setSelection((current) => current ?? saved)
      },
      () => undefined
    )
    return () => controller.abort()
  }, [client, payload])
  const read = useCallback(
    (resource: ReplayResource, signal?: AbortSignal) =>
      client.recordedMedia(payload, resource, signal),
    [client, payload]
  )
  const readResource = useCallback(
    (resource: ReplayResource) =>
      context.canReadArtifacts
        ? client.readRecordedResource(payload, resource)
        : Promise.resolve({ status: 'unavailable' as const, reason: 'not-recorded' as const }),
    [client, payload, context.canReadArtifacts]
  )
  const ask = async (requested: RecordedRunObservationSelection): Promise<void> => {
    const selected = await client.selectRecording(payload, requested.stepKey)
    setSelection(selected)
  }
  const reference = selection ? recordedSelectionReference(context.viewerId, selection) : undefined
  return (
    <main className="flex h-svh min-h-0 flex-col bg-bg-000 text-text-100">
      {reference ? (
        <ReferencePanel
          key={reference}
          reference={reference}
          observedAt={selection?.record.observedAt}
        />
      ) : null}
      <div className="min-h-0 flex-1">
        <RecordedRunObservationPreview
          archive={payload.archive}
          receiving={payload.receiving}
          media={context.canReadArtifacts ? payload.media : NO_MEDIA}
          title={t('Archived observation')}
          readResource={readResource}
          renderResource={(resource) => (
            <BrowserArtifactPreview key={resource.versionId} resource={resource} read={read} />
          )}
          onAskArchiveSelection={ask}
        />
      </div>
    </main>
  )
}
