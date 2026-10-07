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
}>
export type ResultsPanelProps = {
  entries: readonly ReplayResultEntry[]
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
export function ResultsPanel({ entries, read, onAskFile }: ResultsPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState<string>()
  const [asking, setAsking] = useState(false)
  const [askFailed, setAskFailed] = useState<string>()
  const available = entries.filter((entry) => fixedReplayResource(entry.resource))
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
            {t('No recorded results are available.')}
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
