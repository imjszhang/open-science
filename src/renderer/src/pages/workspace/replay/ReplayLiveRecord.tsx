import type { ReactNode } from 'react'
import { useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { RunObservationSnapshot } from '../../../../../shared/run-observation'
import { useObservationPhaseLabel } from './replay-observation-labels'
import type { ReplayObservationMode } from '@/lib/replay/live-source'

export type ReplayRuntimeSurface = {
  runId: string
  activationId?: string
  content: ReactNode
}

/** Read-only presentation. All runtime page capabilities are supplied by the host adapter. */
export const ReplayLiveRecord = ({
  snapshot,
  mode,
  runtimeSurface,
  recordedSurface,
  historyTruncated,
  onProjectActiveChange
}: {
  snapshot: RunObservationSnapshot
  mode: ReplayObservationMode
  runtimeSurface?: ReplayRuntimeSurface
  recordedSurface?: ReactNode
  historyTruncated?: boolean
  onProjectActiveChange?: (active: boolean) => void
}): React.JSX.Element => {
  const { t } = useTranslation()
  const phaseLabel = useObservationPhaseLabel()
  const [tab, setTab] = useState<'record' | 'project'>(() =>
    runtimeSurface?.activationId ? 'project' : 'record'
  )
  const [activationId, setActivationId] = useState(runtimeSurface?.activationId)
  if (runtimeSurface?.activationId && runtimeSurface.activationId !== activationId) {
    setActivationId(runtimeSurface.activationId)
    setTab('project')
  }
  useLayoutEffect(() => {
    onProjectActiveChange?.(tab === 'project')
  }, [tab, onProjectActiveChange])
  const livePage =
    mode === 'follow' &&
    snapshot.phase === 'running' &&
    snapshot.run?.status === 'running' &&
    runtimeSurface?.runId === snapshot.run.runId
  return (
    <div
      className={`flex min-h-0 flex-col ${tab === 'project' ? 'h-full gap-2' : 'gap-3'}`}
      data-testid="replay-live-record"
      data-observation-record={`${snapshot.cursor.epoch}:${snapshot.cursor.sequence}`}
    >
      <div
        className="flex shrink-0 flex-wrap gap-1"
        role="group"
        aria-label={t('Run view')}
        data-replay-live-interaction
      >
        <Button
          variant={tab === 'record' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setTab('record')}
          aria-pressed={tab === 'record'}
        >
          {t('Execution record')}
        </Button>
        <Button
          variant={tab === 'project' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setTab('project')}
          aria-pressed={tab === 'project'}
        >
          {t('Project interface')}
        </Button>
      </div>
      <div
        inert={tab !== 'project'}
        hidden={tab !== 'project'}
        className={`min-h-0 flex-1${livePage ? '' : ' overflow-auto'}`}
        data-replay-live-interaction
      >
        <div hidden={!livePage} inert={!livePage} className="flex h-full min-h-0 flex-col">
          {runtimeSurface && runtimeSurface.runId === snapshot.run?.runId && mode !== 'history' ? (
            <>
              <p className="mb-1 shrink-0 text-xs text-status-warning-foreground">
                {t('This page controls the current run. Interactions can change its results.')}
              </p>
              {runtimeSurface.content}
            </>
          ) : null}
        </div>
        {!livePage && tab === 'project'
          ? (recordedSurface ?? (
              <p role="status" className="p-4 text-sm text-muted-foreground">
                {mode === 'inspect' || mode === 'history'
                  ? t(
                      'No project screen was recorded for this step. The current live page is not historical evidence.'
                    )
                  : t('The project interface is not available for this run yet.')}
              </p>
            ))
          : null}
      </div>
      {tab === 'record' ? (
        <>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 break-words text-xs">
            <dt>{t('Status')}</dt>
            <dd data-testid="observation-phase">{phaseLabel(snapshot.phase)}</dd>
            <dt>{t('Observed at')}</dt>
            <dd>{new Date(snapshot.observedAt).toISOString()}</dd>
            {snapshot.run ? (
              <>
                <dt>{t('Run ID')}</dt>
                <dd>{snapshot.run.runId}</dd>
              </>
            ) : null}
          </dl>
          <p className="text-xs text-muted-foreground">
            {historyTruncated
              ? t('Earlier observed records are no longer available in this view.')
              : t('Only observed records are shown. Earlier activity may not have been captured.')}
          </p>
          {snapshot.run ? (
            (['stdout', 'stderr', 'traceback'] as const).map((key) => {
              const log = snapshot.run!.logs[key]
              return log.text || log.truncated || log.redacted ? (
                <section key={key} aria-label={key}>
                  <h3 className="text-xs font-medium">{key}</h3>
                  {log.truncated ? (
                    <p className="text-xs text-status-warning-foreground">
                      {t('Earlier log output was truncated.')}
                    </p>
                  ) : null}
                  {log.redacted ? (
                    <p className="text-xs text-muted-foreground">
                      {t('Sensitive log content was redacted.')}
                    </p>
                  ) : null}
                  <pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-bg-100 p-3 font-mono text-xs">
                    {log.text}
                  </pre>
                </section>
              ) : null
            })
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('Waiting for the execution record.')}
            </p>
          )}
          {snapshot.artifactsTruncated ? (
            <p className="text-xs text-status-warning-foreground">
              {t('Some result files are outside this observation window.')}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
