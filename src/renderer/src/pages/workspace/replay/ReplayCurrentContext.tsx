import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ReplayScene, ReplayStep } from '../../../../../shared/replay'
import { useReplayTranslation } from './replay-presentation'
import { replayExcerpt } from './replay-content'

/** Compact historical context survives narrow layouts and material changes. */
export function ReplayCurrentContext({
  scene,
  steps,
  onHistory,
  onNotebook
}: {
  scene: ReplayScene
  steps: readonly ReplayStep[]
  onHistory: () => void
  onNotebook?: () => void
}): React.JSX.Element {
  const { t } = useReplayTranslation()
  const [expanded, setExpanded] = useState(false)
  const latest = steps
    .slice(0, scene.stepIndex + 1)
    .filter((step) => step.message)
    .at(-1)
  const message = latest?.message
  const description =
    scene.step?.kind === 'notebook'
      ? t('Notebook')
      : scene.step?.kind === 'artifact'
        ? t('Results')
        : scene.step?.kind === 'activity'
          ? t('Recorded activity')
          : scene.step?.kind === 'review'
            ? t('Review')
            : t('Original research conversation')
  return (
    <section
      aria-label={t('Current research context')}
      className="shrink-0 border-b border-border-200 bg-bg-10 px-3 py-2 text-xs"
      data-testid="replay-current-context"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{description}</span>
        <span className="text-text-300">{t('Read-only research history')}</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-xs"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? t('Collapse context') : t('Expand context')}
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onHistory}>
          {t('Browse original conversation')}
        </Button>
      </div>
      {message ? (
        <p
          className={`${expanded ? 'max-h-32 overflow-auto whitespace-pre-wrap' : 'line-clamp-2'} mt-1 break-words text-text-200`}
        >
          <span className="font-medium">{message.role === 'user' ? t('User') : t('Agent')}</span>
          {': '}
          {replayExcerpt(message.content, expanded ? 6000 : 400)}
        </p>
      ) : (
        <p className="mt-1 text-text-300">
          {t('No original conversation is saved for this step.')}
        </p>
      )}
      {expanded ? (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-text-300">
          <span>{t('Only saved research records are shown.')}</span>
          {onNotebook ? (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onNotebook}>
              {t('View related Notebook')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
