import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ErrorNotice } from '@/components/error-notice'
import type { ProjectReplayTrack } from '../../../../../shared/project-recording'

export type ProjectReplayProps = {
  track: ProjectReplayTrack
  active?: boolean
  readImage: (mediaKey: string, signal: AbortSignal) => Promise<string | null>
  onAskFrame?: (frame: ProjectReplayTrack['frames'][number]) => void | Promise<void>
}

/** The project's own recorded times are independent of conversation and Notebook steps.
 * No environment, URL, executable HTML or live control can enter this component. */
const ProjectReplayContent = ({
  track,
  active = true,
  readImage,
  onAskFrame
}: ProjectReplayProps): React.JSX.Element => {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loaded, setLoaded] = useState<{
    id: string
    track: ProjectReplayTrack
    reader: ProjectReplayProps['readImage']
    src: string | null
  }>()
  const [asking, setAsking] = useState(false)
  const [askFailed, setAskFailed] = useState(false)
  const frame = track.frames[index]
  useEffect(() => {
    const next = track.frames[index + 1]
    if (!playing || !active || !frame || !next) return
    const timer = setTimeout(
      () => {
        setIndex(index + 1)
        if (index + 1 === track.frames.length - 1) setPlaying(false)
      },
      Math.min(2_147_483_647, Math.max(1, next.recordedAt - frame.recordedAt))
    )
    return () => clearTimeout(timer)
  }, [active, playing, frame, index, track])
  useEffect(() => {
    if (!frame) return
    const abort = new AbortController()
    void readImage(frame.mediaKey, abort.signal).then(
      (src) => {
        if (!abort.signal.aborted) setLoaded({ id: frame.frameId, track, reader: readImage, src })
      },
      () => {
        if (!abort.signal.aborted)
          setLoaded({ id: frame.frameId, track, reader: readImage, src: null })
      }
    )
    return () => abort.abort()
  }, [frame, readImage, track])
  const ready =
    frame && loaded?.id === frame.frameId && loaded.track === track && loaded.reader === readImage
  const gap =
    track.coverage.failures ||
    track.coverage.droppedSamples ||
    track.coverage.missingMediaKeys.length ||
    !['finished', 'stopped'].includes(track.coverage.stopReason)
  return (
    <section
      aria-label={t('Project replay')}
      className="min-h-0 flex-1 space-y-3 overflow-auto p-3"
      data-testid="project-replay"
    >
      <p className="text-xs text-muted-foreground">
        {t(
          'Saved project frames use their own recording times. Viewing them does not run the project.'
        )}
      </p>
      {gap ? (
        <p role="status" className="text-xs text-status-warning-foreground">
          {t('This project recording is incomplete. Missing activity is not reconstructed.')}
        </p>
      ) : null}
      {!frame ? (
        <p className="text-sm text-muted-foreground">
          {t('No project images were recorded. Other research materials remain available.')}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={track.frames.length < 2}
              onClick={() => {
                if (index === track.frames.length - 1) setIndex(0)
                setPlaying(!playing)
              }}
            >
              {playing ? t('Pause replay') : t('Play replay')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={index === 0}
              onClick={() => {
                setPlaying(false)
                setIndex(index - 1)
              }}
            >
              {t('Previous image')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={index >= track.frames.length - 1}
              onClick={() => {
                setPlaying(false)
                setIndex(index + 1)
              }}
            >
              {t('Next image')}
            </Button>
            <span className="text-xs">
              {t('Recorded project image {{current}} of {{total}}', {
                current: index + 1,
                total: track.frames.length
              })}
            </span>
          </div>
          <input
            type="range"
            className="w-full"
            min={0}
            max={Math.max(0, track.frames.length - 1)}
            value={index}
            step={1}
            aria-label={t('Recorded project frame')}
            onChange={(event) => {
              setPlaying(false)
              setIndex(Number(event.target.value))
            }}
          />
          <p className="text-xs text-muted-foreground">
            {new Date(frame.recordedAt).toISOString()}
          </p>
          <p className="text-xs text-muted-foreground">
            {frame.provenance.kind === 'capture'
              ? t('Captured project image')
              : t('Derived visualization from saved data')}
          </p>
          {frame.provenance.kind === 'derived' ? (
            <p className="break-words text-xs">{frame.provenance.method}</p>
          ) : null}
          {!ready ? (
            <p role="status">{t('Preparing recorded material…')}</p>
          ) : loaded.src ? (
            <img
              src={loaded.src}
              alt={t('Recorded project image')}
              className="max-h-[70vh] max-w-full object-contain"
            />
          ) : (
            <ErrorNotice inline title={t('Could not read the recorded material.')} />
          )}
          {onAskFrame ? (
            <Button
              size="sm"
              variant="outline"
              disabled={asking}
              onClick={() => {
                setAsking(true)
                setAskFailed(false)
                void Promise.resolve(onAskFrame(frame))
                  .catch(() => setAskFailed(true))
                  .finally(() => setAsking(false))
              }}
            >
              {t('Ask about this frame')}
            </Button>
          ) : null}
          {askFailed ? (
            <ErrorNotice inline title={t('Could not reference this recorded step.')} />
          ) : null}
        </>
      )}
      {track.states.length || track.events.length ? (
        <details className="text-xs">
          <summary>{t('Recorded states and events')}</summary>
          <p className="mt-2 text-muted-foreground">
            {t('Author-declared data is shown as recorded; it is not an original screenshot.')}
          </p>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">
            {JSON.stringify({ states: track.states, events: track.events }, null, 2)}
          </pre>
        </details>
      ) : null}
    </section>
  )
}
export const ProjectReplay = (props: ProjectReplayProps): React.JSX.Element => (
  <ProjectReplayContent key={props.track.recordingId} {...props} />
)
