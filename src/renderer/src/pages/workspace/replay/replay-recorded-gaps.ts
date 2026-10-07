import type { ReplayStep } from '../../../../../shared/replay'

export type ReplayRecordedRange = Readonly<{ startedAt: number; endedAt: number }>

/** Skipping is optional presentation, not a claim that the experiment was idle. */
export function advanceResearchReplay(input: {
  positionMs: number
  elapsedMs: number
  durationMs: number
  origin?: number
  steps: readonly ReplayStep[]
  ranges: readonly ReplayRecordedRange[]
  skip: boolean
}): { positionMs: number; skipped?: { from: number; to: number } } {
  const positionMs = Math.min(input.durationMs, input.positionMs + Math.max(0, input.elapsedMs))
  if (!input.skip || input.origin === undefined || !Number.isFinite(input.origin))
    return { positionMs }
  const origin = input.origin
  // A short reading hold preserves point records. It does not extend their recorded duration.
  const ranges = [
    ...input.steps.flatMap((step) =>
      [step.recordedAt, step.recordedEndAt].flatMap((time) =>
        time !== undefined && Number.isFinite(time)
          ? [{ start: time - origin, end: time - origin + 3000 }]
          : []
      )
    ),
    ...input.ranges
      .filter(
        (range) =>
          Number.isFinite(range.startedAt) &&
          Number.isFinite(range.endedAt) &&
          range.endedAt >= range.startedAt
      )
      .map((range) => ({ start: range.startedAt - origin, end: range.endedAt - origin }))
  ].sort((a, b) => a.start - b.start)
  if (ranges.some((range) => range.start <= positionMs && range.end > positionMs))
    return { positionMs }
  // Do not skip across a short recorded segment between animation frames (including 4× playback).
  const crossed = ranges.find(
    (range) => range.start > input.positionMs && range.start <= positionMs
  )
  if (crossed) return { positionMs: crossed.start }
  const next = ranges.find((range) => range.start > positionMs)
  if (!next || next.start - positionMs < 5000 || next.start > input.durationMs)
    return { positionMs }
  return { positionMs: next.start, skipped: { from: positionMs, to: next.start } }
}
