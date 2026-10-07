import { useCallback, useEffect, useRef, useState } from 'react'
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
  const heldFrame = useRef<HTMLCanvasElement>(null)
  const setHeldFrameNode = useCallback((node: HTMLCanvasElement | null) => {
    if (heldFrame.current && heldFrame.current !== node) {
      heldFrame.current.width = 0
      heldFrame.current.height = 0
    }
    heldFrame.current = node
  }, [])
  const surface = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(true)
  const [documentVisible, setDocumentVisible] = useState(document.visibilityState !== 'hidden')
  active = active && visible && documentVisible
  const firstOffset = recording.segments[0]?.startMs ?? 0
  const [offsetMs, setOffsetMs] = useState(firstOffset)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [failedSource, setFailedSource] = useState<string>()
  const [decodedSource, setDecodedSource] = useState<string>()
  const [heldOffset, setHeldOffset] = useState<number>()
  const [asking, setAsking] = useState(false)
  const [askFailed, setAskFailed] = useState(false)
  const mounted = useRef(true)
  const desiredOffset = useRef(firstOffset)
  const segment = segmentAt(recording, offsetMs)
  const source = segment && active ? mediaUrl(segment.mediaKey) : null
  const failed = Boolean(source && failedSource === source)
  const loading = Boolean(source && !failed && decodedSource !== source)
  const displayedOffset = loading && heldOffset !== undefined ? heldOffset : offsetMs
  if (!active) {
    if (playing) setPlaying(false)
    if (decodedSource !== undefined) setDecodedSource(undefined)
    if (heldOffset !== undefined) setHeldOffset(undefined)
  }
  const gap = recording.coverage.gaps.find(
    (item) => offsetMs >= item.startMs && offsetMs < item.endMs
  )
  const next = recording.segments.find((item) => item.startMs > offsetMs)
  const clearHeldFrame = (): void => {
    setHeldOffset(undefined)
    if (heldFrame.current) {
      heldFrame.current.width = 0
      heldFrame.current.height = 0
    }
  }
  const retainDecodedFrame = (): void => {
    const element = video.current
    const canvas = heldFrame.current
    if (
      !element ||
      !canvas ||
      !segment ||
      element.readyState < 2 ||
      !element.videoWidth ||
      !element.videoHeight
    )
      return
    try {
      // One bounded decoded frame, never an accumulating poster URL/bitmap list or a project
      // page capture. Imported media can have much larger dimensions than our own recorder.
      const scale = Math.min(1, 1280 / element.videoWidth, 720 / element.videoHeight)
      canvas.width = Math.max(1, Math.round(element.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(element.videoHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) return
      context.drawImage(element, 0, 0, canvas.width, canvas.height)
      setHeldOffset(
        Math.min(segment.endMs - 1, segment.startMs + Math.round(element.currentTime * 1000))
      )
    } catch {
      clearHeldFrame()
    }
  }
  const decoded = (element: HTMLVideoElement): void => {
    if (element !== video.current || !active || element.seeking) return
    setDecodedSource(source ?? undefined)
    clearHeldFrame()
  }
  const seek = (value: number): void => {
    const bounded = Math.max(0, Math.min(Math.max(0, recording.durationMs - 1), Math.round(value)))
    setPlaying(false)
    setFailedSource(undefined)
    clearHeldFrame()
    setDecodedSource(undefined)
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
    const canvas = heldFrame.current
    return () => {
      mounted.current = false
      element?.pause()
      element?.removeAttribute('src')
      element?.load()
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
    }
  }, [])
  useEffect(() => {
    if (!active) {
      video.current?.pause()
      video.current?.removeAttribute('src')
      video.current?.load()
      if (heldFrame.current) {
        heldFrame.current.width = 0
        heldFrame.current.height = 0
      }
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
    if (active && playing && source && decodedSource === source) {
      void element.play().catch(() => {
        if (mounted.current && element === video.current) {
          setPlaying(false)
          setFailedSource(source ?? undefined)
        }
      })
    } else element.pause()
  }, [playing, speed, active, source, decodedSource])
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
          {recordingTime(displayedOffset)} / {recordingTime(recording.durationMs)}
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
            disabled={!active || !segment || !source || asking || failed || loading}
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
        value={displayedOffset}
        aria-label={t('Web recording timeline')}
        className="w-full"
        onChange={(event) => seek(Number(event.target.value))}
      />
      {source && segment ? (
        <div
          className="relative max-h-[65vh] w-full bg-bg-100"
          style={{ aspectRatio: `${segment.width} / ${segment.height}` }}
          data-testid="recorded-video-surface"
        >
          <video
            key={segment.segmentId}
            ref={video}
            src={source}
            muted
            playsInline
            preload="auto"
            aria-label={t('Recorded webpage')}
            className="absolute inset-0 h-full w-full object-contain"
            style={{ visibility: loading ? 'hidden' : 'visible' }}
            onLoadedMetadata={(event) => {
              if (event.currentTarget !== video.current || !active) return
              event.currentTarget.currentTime = Math.max(
                0,
                (desiredOffset.current - segment.startMs) / 1000
              )
              event.currentTarget.playbackRate = speed
            }}
            onLoadedData={(event) => decoded(event.currentTarget)}
            onSeeked={(event) => {
              if (event.currentTarget.readyState >= 2) decoded(event.currentTarget)
            }}
            onTimeUpdate={(event) => {
              if (event.currentTarget !== video.current || !active || loading) return
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
                retainDecodedFrame()
                setDecodedSource(undefined)
                desiredOffset.current = following.startMs
                setOffsetMs(following.startMs)
              } else {
                clearHeldFrame()
                setPlaying(false)
                desiredOffset.current = Math.min(recording.durationMs - 1, segment.endMs)
                setOffsetMs(desiredOffset.current)
              }
            }}
            onError={(event) => {
              if (event.currentTarget !== video.current || !active) return
              setPlaying(false)
              clearHeldFrame()
              setFailedSource(source ?? undefined)
            }}
          />
          <canvas
            ref={setHeldFrameNode}
            aria-hidden="true"
            hidden={!loading || heldOffset === undefined}
            className="absolute inset-0 h-full w-full object-contain"
            data-testid="held-recorded-frame"
          />
          {loading ? (
            <div
              role="status"
              className="absolute inset-0 flex items-center justify-center bg-bg-000/40 text-sm"
              data-testid="recorded-segment-loading"
            >
              {t('Loading…')}
            </div>
          ) : null}
        </div>
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
