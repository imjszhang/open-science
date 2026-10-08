import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ErrorNotice } from '@/components/error-notice'
import { RecordedMediaViewport } from './RecordedMediaViewport'
import { useReplayMaterialAction, type ReplayMaterialAction } from './replay-material-action'
import { recordingTime, segmentAt } from './browser-recording-playback'
import type {
  BrowserRecording,
  BrowserRecordingSegment
} from '../../../../../shared/browser-recording'

export type BrowserRecordingTransport = {
  /** Recording-relative time from the research clock. Undefined means no reliable alignment. */
  offsetMs: number | undefined
  playing: boolean
  speed: number
  /** Requests a seek (and pause) of the owning research clock. */
  onSeek: (offsetMs: number) => void
  onPause?: () => void
}

export type BrowserRecordingPlayerProps = {
  recording: BrowserRecording
  active?: boolean
  mediaUrl: (mediaKey: string) => string | null
  onAskMoment?: (offsetMs: number) => void | Promise<void>
  transport?: BrowserRecordingTransport
  presentationMode?: 'standalone' | 'research'
  /** Used by the trusted recorded-viewer bridge; never a live project capability. */
  onActionChange?: (action: ReplayMaterialAction | undefined) => void
  onPlaybackError?: () => void
  retryRevision?: number
  /** Only keys explicitly absent from the resolved saved-media catalog. */
  missingMediaKeys?: readonly string[]
}
/** Passive media only: no project address, HTML, environment or execution capability enters here. */
const BrowserRecordingPlayerContent = ({
  recording,
  active = true,
  mediaUrl,
  onAskMoment,
  transport,
  presentationMode = 'standalone',
  onActionChange,
  onPlaybackError,
  retryRevision = 0,
  missingMediaKeys
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
  const [localOffsetMs, setOffsetMs] = useState(firstOffset)
  const [localPlaying, setPlaying] = useState(false)
  const [localSpeed, setSpeed] = useState(1)
  const controlled = transport !== undefined
  const aligned = !controlled || Number.isFinite(transport.offsetMs)
  const offsetMs = controlled ? (transport.offsetMs ?? Number.NaN) : localOffsetMs
  const playing = transport?.playing ?? localPlaying
  const speed = transport?.speed ?? localSpeed
  const [failedSource, setFailedSource] = useState<{ identity: string; retryRevision: number }>()
  const [, setRetryAttempt] = useState(0)
  const [decodedSource, setDecodedSource] = useState<string>()
  const [decodedPosition, setDecodedPosition] = useState<{ source: string; offsetMs: number }>()
  const [heldOffset, setHeldOffset] = useState<number>()
  const [asking, setAsking] = useState(false)
  const [askFailed, setAskFailed] = useState(false)
  const [decodedSize, setDecodedSize] = useState<{
    source: string | undefined
    width: number
    height: number
  }>()
  const mounted = useRef(true)
  const desiredOffset = useRef(firstOffset)
  const segment = segmentAt(recording, offsetMs)
  const missing = Boolean(segment && missingMediaKeys?.includes(segment.mediaKey))
  const source = segment && active && !missing ? mediaUrl(segment.mediaKey) : null
  const sourceIdentity = source && segment ? `${segment.segmentId}:${source}` : undefined
  const failed = Boolean(
    sourceIdentity &&
    failedSource?.identity === sourceIdentity &&
    failedSource.retryRevision === retryRevision
  )
  const loading = Boolean(source && !failed && decodedSource !== sourceIdentity)
  const displayedOffset = loading && heldOffset !== undefined ? heldOffset : offsetMs
  if (localPlaying && (failed || (segment && !source))) setPlaying(false)
  if (!active) {
    if (localPlaying) setPlaying(false)
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
  const retainDecodedFrame = (
    element = video.current,
    capturedSegment: BrowserRecordingSegment | undefined = segment
  ): void => {
    const canvas = heldFrame.current
    if (
      !element ||
      !canvas ||
      !capturedSegment ||
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
        Math.min(
          capturedSegment.endMs - 1,
          capturedSegment.startMs + Math.round(element.currentTime * 1000)
        )
      )
    } catch {
      clearHeldFrame()
    }
  }
  const decoded = (element: HTMLVideoElement): void => {
    if (element !== video.current || !active || element.seeking || failed || element.readyState < 2)
      return
    setDecodedSource(sourceIdentity)
    if (segment && sourceIdentity)
      setDecodedPosition({
        source: sourceIdentity,
        offsetMs: Math.min(
          segment.endMs - 1,
          Math.max(segment.startMs, segment.startMs + Math.round(element.currentTime * 1000))
        )
      })
    clearHeldFrame()
  }
  const seek = (value: number): void => {
    const bounded = Math.max(0, Math.min(Math.max(0, recording.durationMs - 1), Math.round(value)))
    if (transport) {
      if (aligned) transport.onSeek(bounded)
      return
    }
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
    // An initially hidden desktop frame may become visible between render and subscription.
    update()
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  useEffect(() => {
    const element = surface.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      // Hidden material tabs can queue both hide and show records before this callback runs.
      // Using the first record would leave a visible iframe suspended until another tab switch.
      let latest: IntersectionObserverEntry | undefined
      for (const entry of entries) {
        if (entry.target === element && (!latest || entry.time >= latest.time)) latest = entry
      }
      if (latest) setVisible(latest.isIntersecting)
    })
    observer.observe(element)
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
  }, [sourceIdentity])
  const reportFailure = useEffectEvent(() => {
    if (transport?.onPause) transport.onPause()
    else if (transport && aligned) transport.onSeek(offsetMs)
    if (!missing) onPlaybackError?.()
  })
  useEffect(() => {
    if (active && segment && (failed || !source)) reportFailure()
  }, [active, segment, failed, source, missing])
  const retry = (): void => {
    setRetryAttempt((attempt) => attempt + 1)
    setFailedSource(undefined)
    setDecodedSource(undefined)
    setDecodedPosition(undefined)
    clearHeldFrame()
    video.current?.load()
  }
  const retryCurrent = useEffectEvent(retry)
  const previousRetryRevision = useRef(retryRevision)
  useEffect(() => {
    if (previousRetryRevision.current === retryRevision) return
    previousRetryRevision.current = retryRevision
    retryCurrent()
  }, [retryRevision])
  const retainAtControlledTransition = useEffectEvent(
    (
      previousElement: HTMLVideoElement | null,
      previousSegment: BrowserRecordingSegment | undefined
    ) => {
      if (!controlled) return
      const nextSegment = segmentAt(recording, offsetMs)
      // The master clock may cross the boundary before the video's ended event. Retain only
      // an adjacent decoded frame while loading, never a frame across a seek or missing interval.
      if (
        active &&
        playing &&
        previousSegment &&
        nextSegment &&
        nextSegment.segmentId !== previousSegment.segmentId &&
        nextSegment.startMs >= previousSegment.endMs &&
        nextSegment.startMs - previousSegment.endMs <= 250 &&
        offsetMs - nextSegment.startMs <= 250 &&
        !recording.coverage.gaps.some(
          (item) => item.startMs < nextSegment.startMs && item.endMs > previousSegment.endMs
        )
      ) {
        retainDecodedFrame(previousElement, previousSegment)
      } else clearHeldFrame()
    }
  )
  useLayoutEffect(() => {
    const previousElement = video.current
    const previousSegment = segment
    return () => retainAtControlledTransition(previousElement, previousSegment)
    // Capture the departing element before React removes it, using the latest research clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceIdentity])
  useEffect(() => {
    if (!controlled || !active || !segment || !source) return
    const element = video.current
    if (!element || element.readyState < 1) return
    const targetSeconds = Math.max(0, (offsetMs - segment.startMs) / 1000)
    // Let the media decoder advance between research-clock updates; continuously resetting
    // currentTime causes seek storms. Pauses and explicit jumps still settle at the exact time.
    if (Math.abs(element.currentTime - targetSeconds) > (playing ? 0.15 : 0.001)) {
      setDecodedSource(undefined)
      element.currentTime = targetSeconds
    }
  }, [controlled, active, sourceIdentity, offsetMs, playing, segment, source])
  useEffect(() => {
    const element = video.current
    if (!element) return
    let cancelled = false
    element.playbackRate = speed
    if (active && playing && source && decodedSource === sourceIdentity) {
      void element.play().catch(() => {
        if (!cancelled && mounted.current && element === video.current) {
          setPlaying(false)
          setDecodedSource(undefined)
          setFailedSource(sourceIdentity ? { identity: sourceIdentity, retryRevision } : undefined)
        }
      })
    } else element.pause()
    return () => {
      cancelled = true
    }
  }, [playing, speed, active, source, sourceIdentity, decodedSource, retryRevision])
  const incomplete =
    recording.coverage.droppedFrames > 0 ||
    recording.coverage.gaps.length > 0 ||
    !['finished', 'stopped'].includes(recording.coverage.stopReason)
  const askDisabled = !active || !segment || !source || asking || failed || loading
  const ask = (): void => {
    const element = video.current
    if (
      askDisabled ||
      !onAskMoment ||
      !element ||
      !segment ||
      element.seeking ||
      element.readyState < 2
    )
      return
    // Capture the actual decoded media position, never a stale research-clock timestamp.
    element.pause()
    const atMs = Math.min(
      segment.endMs - 1,
      Math.max(segment.startMs, segment.startMs + Math.round(element.currentTime * 1000))
    )
    if (!Number.isFinite(atMs)) return
    if (transport) transport.onSeek(atMs)
    else {
      desiredOffset.current = atMs
      setOffsetMs(atMs)
      setPlaying(false)
    }
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
  }
  const actionLabel = active && onAskMoment ? t('Ask about this moment') : undefined
  const actionRecordedAt =
    !askDisabled && decodedPosition && decodedPosition.source === sourceIdentity
      ? recording.startedAt + decodedPosition.offsetMs
      : undefined
  const actionTitle = recording.title ?? t('Project recording')
  const materialAction = actionLabel
    ? {
        label: actionLabel,
        disabled: askDisabled,
        pending: asking,
        recordedAt: actionRecordedAt,
        title: actionTitle,
        onAsk: ask
      }
    : undefined
  const sharedAction = useReplayMaterialAction(materialAction)
  const latestAction = useRef(materialAction)
  const actionCallback = useRef(onActionChange)
  useLayoutEffect(() => {
    latestAction.current = materialAction
    actionCallback.current = onActionChange
  })
  const hasActionCallback = Boolean(onActionChange)
  useLayoutEffect(() => {
    if (!hasActionCallback || !actionLabel) return
    actionCallback.current?.({
      label: actionLabel,
      disabled: askDisabled,
      pending: asking,
      recordedAt: actionRecordedAt,
      title: actionTitle,
      onAsk: () => {
        const action = latestAction.current
        if (action && !action.disabled && !action.pending) action.onAsk()
      }
    })
    return () => actionCallback.current?.(undefined)
  }, [hasActionCallback, actionLabel, askDisabled, asking, actionRecordedAt, actionTitle])
  const compact = presentationMode === 'research' || sharedAction
  const centralized = sharedAction || (presentationMode === 'research' && hasActionCallback)
  const dimensions =
    decodedSize && decodedSize.source === sourceIdentity && decodedSize.width && decodedSize.height
      ? decodedSize
      : segment
  const status = missing ? (
    <ErrorNotice inline title={t('This recorded media file is not included.')} />
  ) : failed ? (
    <ErrorNotice
      inline
      title={t('Could not play the recorded footage.')}
      primaryButton={{
        label: t('Retry'),
        onClick: retry
      }}
    />
  ) : source && segment ? (
    loading ? (
      <div role="status" data-testid="recorded-segment-loading">
        {t('Loading…')}
      </div>
    ) : null
  ) : segment && active ? (
    <ErrorNotice
      inline
      title={t('Could not read the recorded material.')}
      primaryButton={{ label: t('Retry'), onClick: retry }}
    />
  ) : (
    <div role="status" className="max-w-prose text-center">
      <p>
        {!aligned
          ? t('This recording cannot be aligned with the research replay timeline.')
          : gap?.reason === 'paused'
            ? t('Recording was paused at this time.')
            : compact && offsetMs < firstOffset
              ? t('The project recording has not started yet.')
              : compact && offsetMs >= (recording.segments.at(-1)?.endMs ?? recording.durationMs)
                ? t('The project recording has ended.')
                : t('No webpage footage was recorded at this time.')}
      </p>
      {next && aligned ? (
        <Button className="mt-3" size="sm" variant="outline" onClick={() => seek(next.startMs)}>
          {compact && offsetMs < firstOffset
            ? t('Jump to recorded footage')
            : t('Go to next recorded moment')}
        </Button>
      ) : null}
    </div>
  )
  return (
    <section
      ref={surface}
      aria-label={t('Project replay')}
      className={
        compact
          ? 'flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden p-3'
          : 'flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3'
      }
      data-testid="browser-recording-player"
    >
      {!compact ? (
        <p className="text-xs text-muted-foreground">
          {controlled
            ? t('Follows playback progress')
            : t('Recorded webpage footage. Playback does not run the project.')}
        </p>
      ) : null}
      {incomplete && !compact ? (
        <p role="status" className="text-xs text-status-warning-foreground">
          {t('This project recording is incomplete. Missing activity is not reconstructed.')}
        </p>
      ) : null}
      {!controlled || (onAskMoment && !centralized) ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!controlled ? (
            <>
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
            </>
          ) : null}
          {onAskMoment && !centralized ? (
            <Button size="sm" variant="outline" disabled={askDisabled} onClick={ask}>
              {t('Ask about this moment')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {!controlled ? (
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
      ) : null}
      <div
        className={compact ? 'flex min-h-0 flex-1' : 'flex h-[min(65vh,480px)] min-h-48 shrink-0'}
      >
        <RecordedMediaViewport
          compact={compact}
          width={dimensions?.width}
          height={dimensions?.height}
          status={status}
          surfaceTestId="recorded-video-surface"
          metadata={
            compact && dimensions
              ? `${dimensions.width} × ${dimensions.height}${segment ? ` · WebM · ${segment.codec.toUpperCase()}` : ''}`
              : undefined
          }
        >
          {source && segment ? (
            <>
              <video
                key={segment.segmentId}
                ref={video}
                src={source}
                muted
                playsInline
                preload="auto"
                aria-label={t('Recorded webpage')}
                className="absolute inset-0 h-full w-full object-contain"
                style={{ visibility: loading || failed ? 'hidden' : 'visible' }}
                onLoadedMetadata={(event) => {
                  if (event.currentTarget !== video.current || !active) return
                  setDecodedSize({
                    source: sourceIdentity,
                    width: event.currentTarget.videoWidth,
                    height: event.currentTarget.videoHeight
                  })
                  event.currentTarget.currentTime = Math.max(
                    0,
                    ((controlled ? offsetMs : desiredOffset.current) - segment.startMs) / 1000
                  )
                  event.currentTarget.playbackRate = speed
                }}
                onResize={(event) => {
                  if (event.currentTarget === video.current)
                    setDecodedSize({
                      source: sourceIdentity,
                      width: event.currentTarget.videoWidth,
                      height: event.currentTarget.videoHeight
                    })
                }}
                onLoadedData={(event) => decoded(event.currentTarget)}
                onCanPlay={(event) => {
                  if (event.currentTarget.readyState >= 2) decoded(event.currentTarget)
                }}
                onWaiting={() => setDecodedSource(undefined)}
                onSeeking={() => setDecodedSource(undefined)}
                onSeeked={(event) => {
                  if (event.currentTarget.readyState >= 2) decoded(event.currentTarget)
                }}
                onTimeUpdate={(event) => {
                  if (
                    event.currentTarget !== video.current ||
                    !active ||
                    loading ||
                    failed ||
                    event.currentTarget.seeking
                  )
                    return
                  const value = Math.min(
                    segment.endMs - 1,
                    segment.startMs + Math.round(event.currentTarget.currentTime * 1000)
                  )
                  if (sourceIdentity)
                    setDecodedPosition({ source: sourceIdentity, offsetMs: value })
                  if (controlled) return
                  desiredOffset.current = value
                  setOffsetMs(value)
                }}
                onEnded={(event) => {
                  if (event.currentTarget !== video.current || !active) return
                  if (controlled) {
                    event.currentTarget.pause()
                    return
                  }
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
                  setDecodedSource(undefined)
                  setFailedSource(
                    sourceIdentity ? { identity: sourceIdentity, retryRevision } : undefined
                  )
                }}
              />
              <canvas
                ref={setHeldFrameNode}
                aria-hidden="true"
                hidden={!loading || heldOffset === undefined}
                className="absolute inset-0 h-full w-full object-contain"
                data-testid="held-recorded-frame"
              />
            </>
          ) : null}
        </RecordedMediaViewport>
      </div>
      {askFailed ? (
        <ErrorNotice inline title={t('Could not reference this recorded step.')} />
      ) : null}
      {recording.events.length || (compact && incomplete) ? (
        <details className="shrink-0 text-xs">
          <summary>{t('Recorded actions and events')}</summary>
          {compact && incomplete ? (
            <p className="mt-2 text-status-warning-foreground">
              {t('This project recording is incomplete. Missing activity is not reconstructed.')}
            </p>
          ) : null}
          <ol className="mt-2 max-h-32 space-y-1 overflow-auto">
            {recording.events.map((event) => (
              <li key={event.eventId}>
                <button
                  className="text-left underline underline-offset-2"
                  disabled={!aligned}
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
