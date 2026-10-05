import { useCallback, useEffect, useRef, useState } from 'react'
import type { RunObservationSnapshot } from '../../shared/run-observation'
import type { ObservationViewerCapture } from '../../shared/run-observation-capture'
import type { ReplayViewerClient } from './client'

export const capturesForObservation = (
  captures: readonly ObservationViewerCapture[],
  snapshot: RunObservationSnapshot
): readonly ObservationViewerCapture[] =>
  captures.filter(
    (capture) =>
      capture.viewerEvidence?.cursor.epoch === snapshot.cursor.epoch &&
      capture.viewerEvidence.cursor.sequence === snapshot.cursor.sequence &&
      capture.viewerEvidence.stepId === snapshot.stepId &&
      capture.viewerEvidence.observedAt === snapshot.observedAt
  )

export const useViewerCaptures = (
  client: ReplayViewerClient,
  active: boolean
): {
  captures: readonly ObservationViewerCapture[]
  readImage: (id: string) => Promise<string | null>
} => {
  const [captures, setCaptures] = useState<ObservationViewerCapture[]>([])
  const available = useRef<readonly ObservationViewerCapture[]>([])
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try {
        const results = await client.captures(controller.signal)
        if (!controller.signal.aborted) {
          available.current = results
          setCaptures(results)
        }
      } catch {
        /* Recorded Notebook evidence remains usable if the short-lived frame cache expires. */
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => {
          void poll()
        }, 1500)
    }
    void poll()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [client, active])
  const readImage = useCallback(
    async (id: string) => {
      const capture = available.current.find((item) => item.captureId === id)
      return capture ? client.captureImage(capture) : null
    },
    [client]
  )
  return { captures: active ? captures : [], readImage }
}
