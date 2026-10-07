import type { RecordedBrowserPayload } from '../../../../shared/browser-recording'
import type { ReplayBranch, ReplayDocument } from '../../../../shared/replay'

type RecordingIdentity = Pick<RecordedBrowserPayload, 'receiving' | 'recording'>

export type RecordedReplayTimeline = {
  document: ReplayDocument
  branchId: string
  startedAt: number
  endedAt: number
  /** An elapsed position has a real wall-clock anchor. Out-of-range input is not clamped. */
  timestampAt: (positionMs: number) => number | undefined
  positionAt: (timestamp: number) => number | undefined
}

const timestamp = (value: number | undefined): value is number =>
  value !== undefined && Number.isSafeInteger(value) && value >= 0

/**
 * This is a presentation association, never authority to read another session or execute it.
 * Imported index bytes retain sender identities; native Replay evidence has receiving IDs.
 */
const belongsToBranch = (
  document: ReplayDocument,
  branch: ReplayBranch,
  { receiving, recording }: RecordingIdentity
): boolean => {
  const source = recording.source
  if (
    receiving.projectId !== document.source.projectId ||
    receiving.sessionId !== document.source.sessionId ||
    !source?.projectId ||
    !source.sessionId
  )
    return false
  const origin = document.source.packageOrigin
  const sameSource =
    (source.projectId === document.source.projectId &&
      source.sessionId === document.source.sessionId) ||
    (source.projectId === origin?.sourceProjectId && source.sessionId === origin.sourceSessionId)
  if (!sameSource) return false
  if (document.branches.length === 1) return true

  const matchingBranches = document.branches.filter((candidate) =>
    candidate.steps.some((step) =>
      step.runs.some((run) => {
        // A matching invocation must not override an explicitly contradictory Run identity.
        if (source.runId && run.runId === source.runId)
          return (
            !source.executionInvocationId ||
            !run.executionInvocationId ||
            run.executionInvocationId === source.executionInvocationId
          )
        return (
          !source.runId &&
          !!source.executionInvocationId &&
          run.executionInvocationId === source.executionInvocationId
        )
      })
    )
  )
  if (matchingBranches.length)
    return matchingBranches.some((candidate) => candidate.id === branch.id)

  // Notebook identities are remapped on import while ordinary Artifact bytes are untouched.
  // An exact receiving index Version published on only one branch is another explicit anchor.
  // Merely listing the recording in document.resources does not identify a conversation branch.
  const resources = new Set(
    document.resources
      .filter(
        (resource) =>
          resource.projectId === receiving.projectId &&
          resource.sessionId === receiving.sessionId &&
          resource.artifactId === receiving.artifactId &&
          resource.versionId === receiving.versionId
      )
      .map((resource) => resource.id)
  )
  const publicationBranches = document.branches.filter((candidate) =>
    candidate.steps.some((step) => step.resourceIds.some((resource) => resources.has(resource)))
  )
  return publicationBranches.length === 1 && publicationBranches[0].id === branch.id
}

/**
 * Replace one reconstructed presentation axis with actual recorded timestamps. The derived
 * view is chronological, with original order retained for equal timestamps. The underlying
 * transcript and publication grouping are untouched. Missing or invalid timestamps fail
 * closed rather than guessing a duration or stretching a video to fit the old timeline.
 *
 * Between two known points the previous recorded state is held; no intermediate evidence is
 * synthesized. Point observations (including the final step) may have zero duration. Callers
 * must present such a point as complete and must not animate reconstructed result boundaries.
 * Other branches remain unchanged and must be derived separately when selected.
 */
export const createBrowserRecordingReplayTimeline = (
  document: ReplayDocument,
  branchId: string,
  payload: RecordingIdentity
): RecordedReplayTimeline | undefined => {
  const branch = document.branches.find((candidate) => candidate.id === branchId)
  const { recording } = payload
  if (
    !branch?.steps.length ||
    !belongsToBranch(document, branch, payload) ||
    !timestamp(recording.startedAt) ||
    !timestamp(recording.durationMs) ||
    !timestamp(recording.startedAt + recording.durationMs)
  )
    return undefined
  for (const step of branch.steps) {
    if (
      !timestamp(step.recordedAt) ||
      (step.recordedEndAt !== undefined &&
        (!timestamp(step.recordedEndAt) || step.recordedEndAt < step.recordedAt))
    )
      return undefined
  }
  // Ordinary Replay places published files after the answer that links them, and unmatched
  // Notebook runs after that group. Their real timestamps can predate the publication message.
  // Only this elapsed-time projection orders those existing records chronologically.
  const chronological = [...branch.steps].sort(
    (left, right) => left.recordedAt! - right.recordedAt!
  )
  const startedAt = Math.min(recording.startedAt, chronological[0].recordedAt!)
  const endedAt = Math.max(
    recording.startedAt + recording.durationMs,
    ...chronological.map((step) => step.recordedEndAt ?? step.recordedAt!)
  )
  if (endedAt <= startedAt) return undefined
  const durationMs = endedAt - startedAt
  const steps = chronological.map((step, index) => {
    const startMs = step.recordedAt! - startedAt
    const endMs =
      (step.recordedEndAt ?? chronological[index + 1]?.recordedAt ?? endedAt) - startedAt
    return { ...step, startMs, endMs, durationMs: endMs - startMs }
  })
  return {
    document: {
      ...document,
      branches: document.branches.map((candidate) =>
        candidate.id === branchId ? { ...branch, steps, durationMs } : candidate
      )
    },
    branchId,
    startedAt,
    endedAt,
    timestampAt: (positionMs) =>
      Number.isFinite(positionMs) && positionMs >= 0 && positionMs <= durationMs
        ? startedAt + positionMs
        : undefined,
    positionAt: (value) =>
      Number.isFinite(value) && value >= startedAt && value <= endedAt
        ? value - startedAt
        : undefined
  }
}
