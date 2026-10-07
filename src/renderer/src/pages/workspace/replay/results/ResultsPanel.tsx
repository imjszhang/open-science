import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ErrorNotice } from '@/components/error-notice'
import type { ReplayResource } from '../../../../../../shared/replay'
import { RecordedResourcePreview } from './RecordedResourcePreview'
import { fixedReplayResource, type RecordedResourceReader } from './recorded-resource-reader'

export type ReplayResultEntry = Readonly<{
  resource: ReplayResource
  source: { kind: 'session-history' | 'run-observation' | 'project-recording'; id: string }
  scope: { kind: 'step'; stepKey: string } | { kind: 'recording' }
  /** Never inferred from the filename, latest Version, terminal status, or selected step. */
  stage: 'intermediate' | 'final' | 'unspecified'
  mediaKey?: string
  /** Exact publication time from saved evidence, never the receiver import timestamp. */
  availableAt?: number
  technical?: boolean
}>
export type ResultsPanelProps = {
  entries: readonly ReplayResultEntry[]
  recordedAt?: number
  read: RecordedResourceReader
  onAskFile?: (entry: ReplayResultEntry) => Promise<void> | void
}
const identity = (entry: ReplayResultEntry): string =>
  JSON.stringify([
    entry.source.kind,
    entry.source.id,
    entry.scope,
    entry.resource.projectId,
    entry.resource.sessionId,
    entry.resource.artifactId,
    entry.resource.fileId,
    entry.resource.versionId,
    entry.resource.checksum
  ])

/** Independent immutable results catalog. No Notebook, runtime service, or observation is required. */
export function ResultsPanel({
  entries,
  recordedAt,
  read,
  onAskFile
}: ResultsPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [scope, setScope] = useState<'current' | 'all'>('current')
  const [showTechnical, setShowTechnical] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()
  const [asking, setAsking] = useState(false)
  const [askFailed, setAskFailed] = useState<string>()
  const fixed = entries.filter((entry) => fixedReplayResource(entry.resource))
  const timestamp = (entry: ReplayResultEntry): number | undefined => {
    const time = entry.availableAt ?? entry.resource.createdAt
    return time !== undefined && Number.isFinite(time) ? time : undefined
  }
  const unknownTime = fixed.some((entry) => timestamp(entry) === undefined && !entry.technical)
  const available = fixed.filter(
    (entry) =>
      (!entry.technical || showTechnical) &&
      (scope === 'all' ||
        recordedAt === undefined ||
        (timestamp(entry) !== undefined && timestamp(entry)! <= recordedAt))
  )
  const selected = available.find((entry) => identity(entry) === selectedId)
  const ask = async (): Promise<void> => {
    if (!selected || !onAskFile || asking) return
    setAsking(true)
    setAskFailed(undefined)
    try {
      await onAskFile(selected)
    } catch {
      setAskFailed(identity(selected))
    } finally {
      setAsking(false)
    }
  }
  return (
    <section aria-label={t('Results')} className="flex h-full min-h-0 min-w-0 flex-col">
      {recordedAt !== undefined ? (
        <div className="shrink-0 border-b border-border-200 p-2 text-xs">
          <div role="group" aria-label={t('Result visibility')} className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant={scope === 'current' ? 'secondary' : 'ghost'}
              aria-pressed={scope === 'current'}
              onClick={() => setScope('current')}
            >
              {t('Available at this moment')}
            </Button>
            <Button
              size="sm"
              variant={scope === 'all' ? 'secondary' : 'ghost'}
              aria-pressed={scope === 'all'}
              onClick={() => setScope('all')}
            >
              {t('All saved results')}
            </Button>
          </div>
          <p className="mt-1 text-muted-foreground">
            {scope === 'all'
              ? t('Showing results from the entire research, including later records.')
              : t('Only results with a known publication time at or before this moment are shown.')}
          </p>
          {scope === 'current' && unknownTime ? (
            <p className="mt-1 text-muted-foreground">
              {t(
                'Some results have no saved publication time. Use All saved results to inspect them.'
              )}
            </p>
          ) : null}
        </div>
      ) : null}
      {fixed.some((entry) => entry.technical) ? (
        <label className="flex shrink-0 items-center gap-2 p-2 text-xs">
          <input
            type="checkbox"
            checked={showTechnical}
            onChange={(event) => setShowTechnical(event.currentTarget.checked)}
          />
          {t('Show technical attachments')}
        </label>
      ) : null}
      <div className="max-h-48 shrink-0 overflow-auto border-b border-border-200 p-2">
        {available.length ? (
          available.map((entry) => (
            <Button
              key={identity(entry)}
              variant="ghost"
              className="h-auto w-full justify-start whitespace-normal text-left"
              aria-pressed={identity(entry) === selectedId}
              onClick={() => setSelectedId(identity(entry))}
            >
              <span className="min-w-0">
                <span className="block truncate">{entry.resource.name}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {entry.scope.kind === 'step' ? t('Step result') : t('Recording attachment')}
                  {' · '}
                  {entry.stage === 'final'
                    ? t('Final result')
                    : entry.stage === 'intermediate'
                      ? t('Intermediate result')
                      : t('Stage not specified')}
                </span>
              </span>
            </Button>
          ))
        ) : (
          <p className="p-2 text-sm text-muted-foreground">
            {fixed.length && recordedAt !== undefined && scope === 'current'
              ? t('No results have a known publication time before this moment.')
              : t('No recorded results are available.')}
          </p>
        )}
      </div>
      {selected ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-200 p-2 text-xs">
            <span>
              {selected.source.kind === 'session-history'
                ? t('Session history')
                : selected.source.kind === 'project-recording'
                  ? t('Project recording')
                  : t('Archived observation')}
            </span>
            <span>
              {timestamp(selected) === undefined
                ? t('Publication time not recorded')
                : t('Recorded time: {{time}}', {
                    time: new Date(timestamp(selected)!).toLocaleString()
                  })}
            </span>
            <code className="break-all">{selected.resource.versionId}</code>
            {onAskFile ? (
              <Button size="sm" variant="outline" disabled={asking} onClick={() => void ask()}>
                {t('Ask about this file')}
              </Button>
            ) : null}
          </div>
          {askFailed === selectedId ? (
            <ErrorNotice inline title={t('Could not reference this recorded file.')} />
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto">
            <RecordedResourcePreview key={selectedId} resource={selected.resource} read={read} />
          </div>
        </>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">
          {t('Select a recorded file to preview.')}
        </p>
      )}
    </section>
  )
}
