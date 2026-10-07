import { describe, expect, it } from 'vitest'
import { advanceResearchReplay } from './replay-recorded-gaps'
import type { ReplayStep } from '../../../../../shared/replay'
const step = (recordedAt: number): ReplayStep => ({ recordedAt }) as ReplayStep
const base = {
  positionMs: 3000,
  elapsedMs: 16,
  durationMs: 100000,
  origin: 1000,
  steps: [step(1000), step(85000)],
  ranges: [],
  skip: true
}
describe('optional gaps in a research clock', () => {
  it('preserves real time unless explicitly enabled and known', () => {
    expect(advanceResearchReplay({ ...base, skip: false })).toEqual({ positionMs: 3016 })
    expect(advanceResearchReplay({ ...base, origin: undefined })).toEqual({ positionMs: 3016 })
  })
  it('keeps readable point records and reports the real interval when skipping', () => {
    expect(advanceResearchReplay({ ...base, positionMs: 0 })).toEqual({ positionMs: 16 })
    expect(advanceResearchReplay(base)).toEqual({
      positionMs: 84000,
      skipped: { from: 3016, to: 84000 }
    })
  })
  it('never skips footage, even when no conversation record arrives', () => {
    expect(
      advanceResearchReplay({ ...base, ranges: [{ startedAt: 1000, endedAt: 86000 }] })
    ).toEqual({ positionMs: 3016 })
  })
  it('does not skip over a short recording between animation frames', () => {
    expect(
      advanceResearchReplay({
        ...base,
        elapsedMs: 200,
        ranges: [{ startedAt: 4100, endedAt: 4150 }]
      })
    ).toEqual({ positionMs: 3100 })
  })
  it('does not invent time past the last event or skip brief gaps', () => {
    expect(advanceResearchReplay({ ...base, steps: [step(1000)] })).toEqual({ positionMs: 3016 })
    expect(advanceResearchReplay({ ...base, steps: [step(1000), step(8000)] })).toEqual({
      positionMs: 3016
    })
  })
})
