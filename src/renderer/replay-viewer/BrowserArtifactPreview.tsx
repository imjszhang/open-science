import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorNotice } from '../src/components/error-notice'
import type { ReplayResource } from '../../shared/replay'
import { staticHtml } from './static-html'
import { replayImageSource } from '../src/pages/workspace/replay/replay-svg'

export const BrowserArtifactPreview = ({
  read,
  resource
}: {
  read: (
    resource: ReplayResource,
    signal?: AbortSignal
  ) => Promise<{ content: string; mimeType: string; truncated: boolean }>
  resource: ReplayResource
}): React.JSX.Element => {
  const { t } = useTranslation()
  const [result, setResult] = useState<{
    content: string
    mimeType: string
    truncated: boolean
  } | null>()
  useEffect(() => {
    const controller = new AbortController()
    void read(resource, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setResult(value)
      },
      () => {
        if (!controller.signal.aborted) setResult(null)
      }
    )
    return () => controller.abort()
  }, [read, resource])
  if (result === undefined)
    return <p className="p-4 text-sm">{t('Preparing recorded material…')}</p>
  if (result === null)
    return <ErrorNotice inline title={t('Could not read the recorded material.')} />
  if (result.mimeType === 'text/html' || /\.html?$/i.test(resource.name))
    return (
      <div className="flex h-full min-h-0 flex-col">
        <p className="shrink-0 p-2 text-xs text-muted-foreground">
          {t('Saved HTML preview. Scripts and external connections are disabled.')}
        </p>
        {result.truncated ? (
          <p className="p-2 text-xs text-status-warning-foreground">
            {t('Preview is truncated. Open the evidence for the complete file.')}
          </p>
        ) : null}
        <iframe
          title={resource.name}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={staticHtml(result.content)}
          className="min-h-0 w-full flex-1 border-0"
        />
      </div>
    )
  if (result.mimeType.startsWith('image/')) {
    const source = !result.truncated && replayImageSource(result.mimeType, result.content)
    return source ? (
      <img alt={resource.name} src={source} className="max-h-full max-w-full object-contain" />
    ) : (
      <ErrorNotice inline title={t('This file preview is unavailable here.')} />
    )
  }
  if (
    !result.mimeType.startsWith('text/') &&
    !/^application\/(?:json|xml|javascript|x-yaml)$/.test(result.mimeType)
  )
    return <ErrorNotice inline title={t('This file preview is unavailable here.')} />
  return (
    <div className="h-full overflow-auto p-4">
      <pre className="whitespace-pre-wrap break-words text-xs">{result.content}</pre>
    </div>
  )
}
