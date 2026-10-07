import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ErrorNotice } from '@/components/error-notice'
import { recordingTime, segmentAt } from './browser-recording-playback'
import type { BrowserRecording } from '../../../../../shared/browser-recording'

export type BrowserRecordingPlayerProps = {
  recording: BrowserRecording
  active?: boolean
  mediaUrl: (mediaKey: string) => string | null
  onAskMoment?: (offsetMs: number) => void | Promise<void>
}
/** Passive media only: no project address, HTML, environment or execution capability enters here. */
const BrowserRecordingPlayerContent = ({
  recording,
  active = true,
  mediaUrl,
  onAskMoment
}: BrowserRecordingPlayerProps): React.JSX.Element => {
  const { t } = useTranslation()
  const video = useRef<HTMLVideoElement>(null)
  const surface = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(true)
  const [documentVisible, setDocumentVisible] = useState(document.visibilityState !== 'hidden')
  active = active && visible && documentVisible
  const firstOffset = recording.segments[0]?.startMs ?? 0
  const [offsetMs, setOffsetMs] = useState(firstOffset)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [failedSource, setFailedSource] = useState<string>()
  const [asking, setAsking] = useState(false)
  const [askFailed, setAskFailed] = useState(false)
  const mounted = useRef(true)
  const desiredOffset = useRef(firstOffset)
  const segment = segmentAt(recording, offsetMs)
  const source = segment && active ? mediaUrl(segment.mediaKey) : null
  const failed = Boolean(source && failedSource === source)
  if (!active && playing) setPlaying(false)
  const gap = recording.coverage.gaps.find(
    (item) => offsetMs >= item.startMs && offsetMs < item.endMs
  )
  const next = recording.segments.find((item) => item.startMs > offsetMs)
  const seek = (value: number): void => {
    const bounded = Math.max(0, Math.min(Math.max(0, recording.durationMs - 1), Math.round(value)))
    setPlaying(false)
    setFailedSource(undefined)
    desiredOffset.current = bounded
    setOffsetMs(bounded)
    const target = segmentAt(recording, bounded)
    if (video.current && target && target.segmentId === segment?.segmentId)
      video.current.currentTime = (bounded - target.startMs) / 1000
  }
  useEffect(() => {
    const update = (): void => setDocumentVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  useEffect(() => {
    if (!surface.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(surface.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    mounted.current = true
    const element = video.current
    return () => {
      mounted.current = false
      element?.pause()
      element?.removeAttribute('src')
      element?.load()
    }
  }, [])
  useEffect(() => {
    if (!active) {
      video.current?.pause()
      video.current?.removeAttribute('src')
      video.current?.load()
    }
  }, [active])
  useEffect(() => {
    const element = video.current
    return () => {
      element?.pause()
      element?.removeAttribute('src')
      element?.load()
    }
  }, [source])
  useEffect(() => {
    const element = video.current
    if (!element) return
    element.playbackRate = speed
    if (active && playing && source) {
      void element.play().catch(() => {
        if (mounted.current && element === video.current) {
          setPlaying(false)
          setFailedSource(source ?? undefined)
        }
      })
    } else element.pause()
  }, [playing, speed, active, source])
  const incomplete =
    recording.coverage.droppedFrames > 0 ||
    recording.coverage.gaps.length > 0 ||
    !['finished', 'stopped'].includes(recording.coverage.stopReason)
  return (
    <section
      ref={surface}
      aria-label={t('Project replay')}
      className="min-h-0 flex-1 space-y-3 overflow-auto p-3"
      data-testid="browser-recording-player"
    >
      <p className="text-xs text-muted-foreground">
        {t('Recorded webpage footage. Playback does not run the project.')}
      </p>
      {incomplete ? (
        <p role="status" className="text-xs text-status-warning-foreground">
          {t('This project recording is incomplete. Missing activity is not reconstructed.')}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!active || !segment || !source || failed}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? t('Pause replay') : t('Play replay')}
        </Button>
        <span className="font-mono text-xs" aria-live="off">
          {recordingTime(offsetMs)} / {recordingTime(recording.durationMs)}
        </span>
        <select
          aria-label={t('Playback speed')}
          value={speed}
          className="rounded border border-border-200 bg-bg-000 p-1 text-xs"
          onChange={(event) => setSpeed(Number(event.target.value))}
        >
          {[0.5, 1, 1.5, 2].map((rate) => (
            <option key={rate} value={rate}>
              {t('{{speed}}×', { speed: rate })}
            </option>
          ))}
        </select>
        {onAskMoment ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!active || !segment || !source || asking || failed}
            onClick={() => {
              // timeupdate is deliberately sparse. Freeze and read the actual media position,
              // rather than citing the earlier timestamp most recently rendered by React.
              const element = video.current
              element?.pause()
              const atMs =
                element &&
                segment &&
                element.readyState >= 1 &&
                Number.isFinite(element.currentTime)
                  ? Math.min(
                      segment.endMs - 1,
                      Math.max(
                        segment.startMs,
                        segment.startMs + Math.round(element.currentTime * 1000)
                      )
                    )
                  : Math.round(offsetMs)
              desiredOffset.current = atMs
              setOffsetMs(atMs)
              setPlaying(false)
              setAsking(true)
              setAskFailed(false)
              void Promise.resolve()
                .then(() => onAskMoment(atMs))
                .catch(() => {
                  if (mounted.current) setAskFailed(true)
                })
                .finally(() => {
                  if (mounted.current) setAsking(false)
                })
            }}
          >
            {t('Ask about this moment')}
          </Button>
        ) : null}
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(0, recording.durationMs - 1)}
        step={1}
        value={offsetMs}
        aria-label={t('Web recording timeline')}
        className="w-full"
        onChange={(event) => seek(Number(event.target.value))}
      />
      {source && segment ? (
        <video
          key={segment.segmentId}
          ref={video}
          src={source}
          muted
          playsInline
          preload="metadata"
          aria-label={t('Recorded webpage')}
          className="max-h-[65vh] w-full bg-bg-100 object-contain"
          onLoadedMetadata={(event) => {
            if (event.currentTarget !== video.current || !active) return
            event.currentTarget.currentTime = Math.max(
              0,
              (desiredOffset.current - segment.startMs) / 1000
            )
            event.currentTarget.playbackRate = speed
            if (playing && active) {
              const element = event.currentTarget
              void element.play().catch(() => {
                if (mounted.current && element === video.current) {
                  setPlaying(false)
                  setFailedSource(source ?? undefined)
                }
              })
            }
          }}
          onTimeUpdate={(event) => {
            if (event.currentTarget !== video.current || !active) return
            const value = Math.min(
              segment.endMs - 1,
              segment.startMs + Math.round(event.currentTarget.currentTime * 1000)
            )
            desiredOffset.current = value
            setOffsetMs(value)
          }}
          onEnded={(event) => {
            if (event.currentTarget !== video.current || !active) return
            const following = recording.segments.find((item) => item.startMs >= segment.endMs)
            if (
              following &&
              following.startMs - segment.endMs <= 250 &&
              !recording.coverage.gaps.some(
                (item) => item.startMs < following.startMs && item.endMs > segment.endMs
              )
            ) {
              desiredOffset.current = following.startMs
              setOffsetMs(following.startMs)
            } else {
              setPlaying(false)
              desiredOffset.current = Math.min(recording.durationMs - 1, segment.endMs)
              setOffsetMs(desiredOffset.current)
            }
          }}
          onError={(event) => {
            if (event.currentTarget !== video.current || !active) return
            setPlaying(false)
            setFailedSource(source ?? undefined)
          }}
        />
      ) : segment && active ? (
        <ErrorNotice inline title={t('Could not read the recorded material.')} />
      ) : (
        <div
          role="status"
          className="rounded border border-border-200 p-6 text-sm text-muted-foreground"
        >
          <span>
            {gap?.reason === 'paused'
              ? t('Recording was paused at this time.')
              : t('No webpage footage was recorded at this time.')}
          </span>
          {next ? (
            <Button className="ml-2" size="sm" variant="outline" onClick={() => seek(next.startMs)}>
              {t('Go to next recorded moment')}
            </Button>
          ) : null}
        </div>
      )}
      {failed ? (
        <ErrorNotice
          inline
          title={t('Could not play the recorded footage.')}
          primaryButton={{
            label: t('Retry'),
            onClick: () => {
              setFailedSource(undefined)
              video.current?.load()
            }
          }}
        />
      ) : null}
      {askFailed ? (
        <ErrorNotice inline title={t('Could not reference this recorded step.')} />
      ) : null}
      {recording.events.length ? (
        <details className="text-xs">
          <summary>{t('Recorded actions and events')}</summary>
          <ol className="mt-2 max-h-48 space-y-1 overflow-auto">
            {recording.events.map((event) => (
              <li key={event.eventId}>
                <button
                  className="text-left underline underline-offset-2"
                  onClick={() => seek(event.offsetMs)}
                >
                  {recordingTime(event.offsetMs)} · {event.label ?? event.kind} ·{' '}
                  {event.source === 'author-declared'
                    ? t('Author-declared event')
                    : event.source === 'host-observed'
                      ? t('Host-observed event')
                      : t('Browser-observed action')}
                </button>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  )
}
export const BrowserRecordingPlayer = (props: BrowserRecordingPlayerProps): React.JSX.Element => (
  <BrowserRecordingPlayerContent key={props.recording.recordingId} {...props} />
)
