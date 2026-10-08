import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { ReplayDocument, ReplayResource, ReplayStep } from '../../shared/replay'
import type { RecordedEvidencePayload } from '../../shared/run-observation-recorded'
import * as replaySource from '../../renderer/src/lib/replay/source'
import { browserRecordedFixture } from '../run-observation/browser-recorded.test-support'
import { recordedFixture } from '../run-observation/recorded-viewer.test-support'
import { researchReplayHarness } from './test-support'

function step(
  id: string,
  branchId: string,
  recordedAt: number,
  resourceIds: string[] = []
): ReplayStep {
  return {
    id,
    branchId,
    recordedAt,
    kind: resourceIds.length ? 'artifact' : 'message',
    activities: [],
    runs: [],
    evidence: [],
    resourceIds,
    issues: [],
    startMs: 0,
    endMs: 1,
    durationMs: 1
  }
}
function setup(
  payload: RecordedEvidencePayload
): ReturnType<typeof researchReplayHarness> & { document: ReplayDocument } {
  const h = researchReplayHarness(),
    index = Buffer.from(JSON.stringify('archive' in payload ? payload.archive : payload.recording)),
    result = Buffer.from('scientific report'),
    indexChecksum = createHash('sha256').update(index).digest('hex'),
    resultChecksum = createHash('sha256').update(result).digest('hex')
  const resource = (
    id: string,
    versionId: string,
    checksum: string,
    size: number
  ): ReplayResource => ({
    id: `artifact-version:${versionId}`,
    name: `${id}.json`,
    projectId: h.target.projectId,
    sessionId: h.target.sessionId,
    artifactId: id,
    versionId,
    checksum,
    size,
    availability: 'recorded'
  })
  const indexResource = resource('artifact', 'version', indexChecksum, index.length),
    resultResource = resource('result', 'result-v', resultChecksum, result.length)
  const document: ReplayDocument = {
    generatorVersion: 3,
    presentationVersion: 2,
    source: { ...h.target, title: 'Study', fingerprint: 'frozen-source' },
    defaultBranchId: 'a',
    branches: [
      {
        id: 'a',
        kind: 'conversation',
        durationMs: 2,
        steps: [step('message-a', 'a', 1000), step('index', 'a', 5000, [indexResource.id])]
      },
      {
        id: 'b',
        kind: 'conversation',
        durationMs: 2,
        steps: [
          step('message-b', 'b', 1000),
          step('scientific-result', 'b', 3000, [resultResource.id])
        ]
      }
    ],
    resources: [indexResource, resultResource],
    issues: []
  }
  vi.mocked(h.dependencies.immutable.resolveVersion).mockImplementation(async (request) => {
    const saved = request.inputFileVersionId === 'version' ? indexResource : resultResource
    return {
      sourceKind: 'artifact-version',
      sourceProjectId: h.target.projectId,
      sourceSessionId: h.target.sessionId,
      sourceFileId: saved.artifactId!,
      inputFileVersionId: saved.versionId!,
      sourceVersionNumber: 1,
      filename: saved.name,
      sizeBytes: saved.size!,
      checksum: saved.checksum!,
      storageKey: saved.id,
      association: 'turn-attached'
    }
  })
  vi.mocked(h.dependencies.immutable.openContent).mockImplementation(
    async (input) =>
      ({
        readRange: async () => (input.inputFileVersionId === 'version' ? index : result),
        verifyUnchanged: async () => undefined,
        close: async () => undefined
      }) as never
  )
  vi.mocked(h.dependencies.recordings.readBrowser).mockResolvedValue(payload as never)
  vi.mocked(h.dependencies.recordings.read).mockResolvedValue(payload as never)
  return { ...h, document }
}

describe('authoritative research timing and supporting files', () => {
  it('retains branch association and trailing duration after hiding the only index publication step', async () => {
    const fixture = browserRecordedFixture(),
      receiving = {
        projectId: 'project',
        sessionId: 'session',
        artifactId: 'artifact',
        versionId: 'version'
      }
    const payload = {
      ...fixture.payload,
      receiving,
      recording: {
        ...fixture.payload.recording,
        source: { projectId: 'project', sessionId: 'session' },
        startedAt: 2000,
        durationMs: 2000
      }
    }
    const h = setup(payload),
      read = vi.spyOn(replaySource, 'loadReplayDocument').mockResolvedValue(h.document)
    try {
      const view = await h.service.open(h.target, h.caller),
        research = await h.service.document(view.viewerId, h.caller)
      expect(research.document.branches[0].steps.map((item) => item.id)).toEqual(['message-a'])
      expect(research.document.branches[0].durationMs).toBe(4000)
      expect(research.timing.recordedTimeOrigins.a).toBe(1000)
      expect(research.timing.coverage.a).toHaveLength(1)
      expect(research.timing.coverage.b).toEqual([])
      expect(research.timing.coverage.a[0].target).toEqual(receiving)
      // This metadata travels with the already-projected document. Removing the index must
      // neither make the browser recompute a zero-length branch nor detach valid footage.
      expect(
        (await h.service.read(view.viewerId, { kind: 'overview' }, h.caller)) as object
      ).toMatchObject({
        branches: [
          { id: 'a', durationMs: 4000 },
          { id: 'b', durationMs: 2000 }
        ]
      })
    } finally {
      read.mockRestore()
      h.service.close()
    }
  })
  it('keeps a declared scientific report visible instead of classifying every archive attachment as technical', async () => {
    const fixture = recordedFixture(),
      receiving = {
        projectId: 'project',
        sessionId: 'session',
        artifactId: 'artifact',
        versionId: 'version'
      }
    const payload = {
      ...fixture.payload,
      receiving,
      media: fixture.payload.media.map((media) => ({
        ...media,
        artifactId: 'result',
        versionId: 'result-v'
      }))
    }
    const h = setup(payload),
      read = vi.spyOn(replaySource, 'loadReplayDocument').mockResolvedValue(h.document)
    try {
      const view = await h.service.open(h.target, h.caller),
        research = await h.service.document(view.viewerId, h.caller)
      expect(research.supportingResourceIds).toContain('artifact-version:version')
      expect(research.supportingResourceIds).not.toContain('artifact-version:result-v')
      expect(
        research.document.branches[1].steps.some((item) => item.id === 'scientific-result')
      ).toBe(true)
    } finally {
      read.mockRestore()
      h.service.close()
    }
  })
})

describe('verified observation bindings in the research read model', () => {
  it('exposes Main-resolved bindings without changing ordinary recorded payloads', async () => {
    const payload = recordedFixture().payload
    const h = setup(payload)
    const binding = {
      target: payload.receiving,
      recordingId: payload.archive.recordingId,
      archiveChecksum: h.document.resources[0].checksum!,
      runId: 'receiver-run',
      branchIds: ['a'],
      basis: 'import-receipt' as const
    }
    h.dependencies.observationBindings = vi.fn(async () => [binding])
    vi.spyOn(replaySource, 'loadReplayDocument').mockResolvedValueOnce(h.document)
    const view = await h.service.open(h.target, h.caller)
    expect(h.dependencies.observationBindings).toHaveBeenCalledWith(h.document, [payload])
    expect((await h.service.document(view.viewerId, h.caller)).observationBindings).toEqual([
      binding
    ])
    expect(await h.service.read(view.viewerId, { kind: 'overview' }, h.caller)).toMatchObject({
      observationBindings: [binding]
    })
    binding.runId = 'changed-outside'
    // The bindings join the same immutable viewer snapshot as the saved source document.
    expect((await h.service.document(view.viewerId, h.caller)).observationBindings?.[0].runId).toBe(
      'receiver-run'
    )
  })
  it('keeps the ordinary Replay readable when an optional binding cannot be established', async () => {
    const h = setup(recordedFixture().payload)
    h.dependencies.observationBindings = vi.fn(async () => {
      throw new Error('receipt unavailable')
    })
    vi.spyOn(replaySource, 'loadReplayDocument').mockResolvedValueOnce(h.document)
    const view = await h.service.open(h.target, h.caller)
    expect((await h.service.document(view.viewerId, h.caller)).observationBindings).toEqual([])
  })
})
