import { describe, expect, it, vi } from 'vitest'
import type { ReplayResource } from '../../../../../shared/replay'
import { recordedObservationTargetSchema } from '../../../../../shared/run-observation-recorded'
import {
  discoverRecordingPage,
  recordingCandidates,
  RECORDING_DISCOVERY_PAGE_SIZE
} from './recording-discovery'

const source = { projectId: 'receiver-project', sessionId: 'receiver-session' }
const resource = (overrides: Partial<ReplayResource> = {}): ReplayResource => ({
  id: 'version',
  name: 'renamed.json',
  ...source,
  artifactId: 'artifact',
  versionId: 'version',
  availability: 'recorded',
  mimeType: 'application/json',
  ...overrides
})
const archive = {
  content: '{"format":"open-science-run-observation","version":1,"records":[',
  encoding: 'utf8' as const,
  size: 10000,
  truncated: true
}

describe('receiving source recording discovery', () => {
  it('projects only the receiving viewer identity from a complete Replay source', async () => {
    const replaySource = { ...source, title: 'Received study', fingerprint: 'source-fingerprint' }
    const page = await discoverRecordingPage(
      recordingCandidates([resource()], replaySource),
      vi.fn().mockResolvedValue(archive)
    )
    expect(page.recordings).toHaveLength(1)
    // openRecorded and its recorded reader deliberately use this strict schema. Source display
    // metadata must not cross that IPC boundary, even though structural typing accepts it here.
    expect(recordedObservationTargetSchema.parse(page.recordings[0].target)).toEqual({
      projectId: source.projectId,
      sessionId: source.sessionId,
      artifactId: 'artifact',
      versionId: 'version'
    })
  })
  it('retains every immutable version and never searches another import, upload or binary file', async () => {
    const candidates = recordingCandidates(
      [
        resource({ versionId: 'old', versionNumber: 1 }),
        resource({ versionId: 'new', versionNumber: 2 }),
        resource({ sessionId: 'other-import' }),
        resource({ projectId: 'author-project' }),
        resource({ source: 'upload' }),
        resource({ name: 'frame.png', mimeType: 'image/png' }),
        resource({ artifactId: undefined }),
        resource({ locator: '/author/machine/archive.json' })
      ],
      source
    )
    const read = vi.fn().mockResolvedValue(archive)
    const page = await discoverRecordingPage(candidates, read)
    expect(page.recordings.map(({ target }) => target.versionId)).toEqual(['old', 'new'])
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[0][0]).toMatchObject({
      ...source,
      fileId: 'artifact',
      versionId: 'old',
      maxBytes: 4096,
      encoding: 'utf8'
    })
    expect(read.mock.calls[0][0].path).not.toContain('author')
  })

  it('deduplicates exact versions but excludes conflicting Artifact identity', () => {
    expect(recordingCandidates([resource(), resource()], source)).toHaveLength(1)
    expect(recordingCandidates([resource(), resource({ artifactId: 'other' })], source)).toEqual([])
  })

  it('does not treat a JSON filename as a recording and reports missing bytes without latest fallback', async () => {
    const candidates = recordingCandidates(
      [
        resource({ versionId: 'missing', availability: 'unavailable' }),
        resource({ versionId: 'ordinary' }),
        resource({ versionId: 'failed' })
      ],
      source
    )
    const read = vi
      .fn()
      .mockResolvedValueOnce({ ...archive, content: '{"some":"json"}', truncated: false })
      .mockRejectedValueOnce(new Error('Gone'))
    const page = await discoverRecordingPage(candidates, read)
    expect(page).toMatchObject({ recordings: [], unavailable: 2, unchecked: 0 })
    expect(read.mock.calls.map(([request]) => request.versionId)).toEqual(['ordinary', 'failed'])
  })

  it('bounds reads to one page, lets callers continue, and only keeps content header matches', async () => {
    const candidates = recordingCandidates(
      Array.from({ length: 35 }, (_, index) => resource({ versionId: `v-${index}` })),
      source
    )
    const read = vi.fn().mockResolvedValue(archive)
    const first = await discoverRecordingPage(candidates, read)
    expect(read).toHaveBeenCalledTimes(RECORDING_DISCOVERY_PAGE_SIZE)
    expect(first.unchecked).toBe(3)
    const next = await discoverRecordingPage(candidates, read, first.nextOffset)
    expect(next.recordings.map(({ target }) => target.versionId)).toEqual(['v-32', 'v-33', 'v-34'])
    expect(next.unchecked).toBe(0)
  })

  it('cancels remaining work when the source changes', async () => {
    const controller = new AbortController()
    const read = vi.fn().mockImplementation(async () => {
      controller.abort()
      return archive
    })
    await expect(
      discoverRecordingPage(
        recordingCandidates(
          Array.from({ length: 10 }, (_, index) => resource({ versionId: `v-${index}` })),
          source
        ),
        read,
        0,
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(read.mock.calls.length).toBeLessThanOrEqual(2)
  })
})
