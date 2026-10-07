import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../src/components/ui/button'
export const ReferencePanel = ({
  reference,
  kind = 'step',
  observedAt,
  presentation
}: {
  reference: string
  kind?: 'step' | 'file' | 'moment'
  observedAt?: number
  presentation?: 'desktop' | 'browser'
}): React.JSX.Element => {
  const { t } = useTranslation()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(reference)
      setCopyState('copied')
    } catch {
      setCopyState('manual')
    }
  }
  return (
    <section
      className="shrink-0 border-b border-border-200 px-3 py-2"
      aria-label={
        kind === 'moment'
          ? t('Recorded moment reference')
          : kind === 'file'
            ? t('Recorded file version')
            : t('Recorded step reference')
      }
    >
      <div className="flex items-center justify-between gap-2">
        {presentation !== 'desktop' ? (
          <p className="text-xs">
            {t(
              'Paste this reference into your conversation. Your agent can read the saved selection through the Open Science SDK.'
            )}
          </p>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void copy()
          }}
        >
          {copyState === 'copied'
            ? t('Copied')
            : kind === 'moment'
              ? t('Copy moment reference')
              : kind === 'file'
                ? t('Copy file reference')
                : t('Copy step reference')}
        </Button>
      </div>
      {observedAt !== undefined ? (
        <p role="status" className="mt-1 text-xs font-medium">
          {t('Saved reference for the record at {{time}}.', {
            time: new Date(observedAt).toISOString()
          })}
        </p>
      ) : null}
      <textarea
        readOnly
        aria-label={
          kind === 'moment'
            ? t('Recorded moment reference')
            : kind === 'file'
              ? t('Recorded file version')
              : t('Recorded step reference')
        }
        value={reference}
        rows={3}
        className="mt-2 w-full resize-none rounded border border-border-200 bg-bg-100 p-2 font-mono text-xs"
      />
      {copyState === 'manual' ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t('Select and copy the reference below.')}
        </p>
      ) : null}
    </section>
  )
}
