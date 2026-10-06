import {
  createArtifactVersionLocator,
  parseArtifactVersionLocator
} from '../../../../../shared/artifact-provenance'
import type {
  ArtifactPreviewResult,
  ReadArtifactPreviewRequest
} from '../../../../../shared/artifacts'
import type { ReplayResource } from '../../../../../shared/replay'
import type { RecordedObservationTarget } from '../../../../../shared/run-observation-recorded'
import { isRecordedObservationContent } from './recorded-file-entry'

export const RECORDING_DISCOVERY_PAGE_SIZE = 32
export const RECORDING_DISCOVERY_PREVIEW_BYTES = 4096
export type RecordingDiscoverySource = { projectId: string; sessionId: string }
export type RecordingCandidate = { resource: ReplayResource; target: RecordedObservationTarget }
export type RecordingDiscoveryPage = {
  recordings: RecordingCandidate[]
  nextOffset: number
  unchecked: number
  unavailable: number
}

// A name/content-type only narrows a bounded byte inspection. It never admits a viewer or
// substitutes an author's Run identity for the receiving Artifact Version.
export const recordingCandidates = (
  resources: readonly ReplayResource[],
  source: RecordingDiscoverySource
): RecordingCandidate[] => {
  const candidates = new Map<string, RecordingCandidate>()
  const conflicting = new Set<string>()
  for (const resource of resources) {
    if (
      (resource.source ?? 'artifact') !== 'artifact' ||
      resource.projectId !== source.projectId ||
      resource.sessionId !== source.sessionId ||
      !resource.artifactId ||
      !resource.versionId
    )
      continue
    const mime = resource.mimeType?.split(';')[0].trim().toLowerCase()
    if (
      mime &&
      !mime.startsWith('text/') &&
      !mime.includes('json') &&
      !/\.json$/i.test(resource.name)
    )
      continue
    const target = {
      ...source,
      artifactId: resource.artifactId,
      versionId: resource.versionId
    }
    const locator = resource.locator ? parseArtifactVersionLocator(resource.locator) : undefined
    if (
      resource.locator &&
      (!locator ||
        locator.projectId !== source.projectId ||
        locator.appSessionId !== source.sessionId ||
        locator.artifactId !== target.artifactId ||
        locator.versionId !== target.versionId)
    )
      continue
    const previous = candidates.get(target.versionId)
    if (previous && previous.target.artifactId !== target.artifactId) {
      conflicting.add(target.versionId)
      continue
    }
    if (!previous) candidates.set(target.versionId, { resource, target })
  }
  return [...candidates.values()].filter(({ target }) => !conflicting.has(target.versionId))
}

const checkAbort = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException('Recording discovery cancelled', 'AbortError')
}

/** At most 32 exact Versions and two 4 KB reads at once. Main validates the complete archive on open. */
export const discoverRecordingPage = async (
  candidates: readonly RecordingCandidate[],
  readPreview: (request: ReadArtifactPreviewRequest) => Promise<ArtifactPreviewResult>,
  offset = 0,
  signal?: AbortSignal
): Promise<RecordingDiscoveryPage> => {
  checkAbort(signal)
  const start = Math.max(0, Math.min(candidates.length, Math.floor(offset)))
  const page = candidates.slice(start, start + RECORDING_DISCOVERY_PAGE_SIZE)
  const found = new Map<number, RecordingCandidate>()
  let unavailable = 0
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < page.length) {
      checkAbort(signal)
      const index = next++
      const candidate = page[index]
      if (candidate.resource.availability !== 'recorded') {
        unavailable += 1
        continue
      }
      const { target } = candidate
      try {
        const preview = await readPreview({
          path: createArtifactVersionLocator({ ...target, appSessionId: target.sessionId }),
          projectId: target.projectId,
          sessionId: target.sessionId,
          fileId: target.artifactId,
          versionId: target.versionId,
          maxBytes: RECORDING_DISCOVERY_PREVIEW_BYTES,
          encoding: 'utf8'
        })
        checkAbort(signal)
        if (
          preview.encoding === 'utf8' &&
          isRecordedObservationContent(preview.content, !preview.truncated)
        )
          found.set(index, candidate)
      } catch {
        checkAbort(signal)
        unavailable += 1
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, page.length) }, worker))
  const nextOffset = start + page.length
  return {
    recordings: [...found.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, value]) => value),
    nextOffset,
    unchecked: candidates.length - nextOffset,
    unavailable
  }
}
