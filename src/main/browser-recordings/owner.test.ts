import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  BrowserRecordingOwner,
  type BrowserRecordingDriverInput,
  type BrowserRecordingDriver,
  type BrowserRecordingStatus
} from './owner'
import { createElectronCallerContext } from '../caller-context'
import type { AuxiliaryOutput, AuxiliaryOutputResult } from '../run-observation/auxiliary-output'
import { parseBrowserRecording } from '../../shared/browser-recording'

const target = {
  projectId: 'project',
  sessionId: 'session',
  operationId: 'operation',
  executionInvocationId: 'execution'
}
const host = {
  caller: createElectronCallerContext(1),
  viewerOrigin: 'http://viewer-test.localhost:1234',
  projectOrigin: 'http://rv-test.localhost:1234'
}
function fixture(options: { maxBytes?: number; failIndex?: boolean; dataRoot?: string } = {}): {
  owner: BrowserRecordingOwner
  registration: ReturnType<BrowserRecordingOwner['register']>
  saved: AuxiliaryOutput[]
  save: Mock<(output: AuxiliaryOutput) => Promise<AuxiliaryOutputResult>>
  start: (requestId?: string, viewerId?: string) => Promise<BrowserRecordingStatus>
  startDriver: Mock<(value: BrowserRecordingDriverInput) => Promise<BrowserRecordingDriver>>
  stop: Mock<() => Promise<undefined>>
  source: AbortController
  segment: (startMs?: number, endMs?: number) => Promise<void>
  input: () => BrowserRecordingDriverInput
} {
  let input!: BrowserRecordingDriverInput
  const saved: AuxiliaryOutput[] = []
  const stop = vi.fn(async () => undefined)
  const source = new AbortController()
  const save = vi.fn(async (output: AuxiliaryOutput): Promise<AuxiliaryOutputResult> => {
    if (options.failIndex && output.filename.endsWith('.json'))
      return { status: 'failed', code: 'artifact-save-failed' }
    saved.push(output)
    return {
      status: 'saved',
      artifact: {
        artifactId: output.filename.endsWith('.json') ? 'index' : `media-${saved.length}`,
        versionId: `version-${saved.length}`
      }
    } as AuxiliaryOutputResult
  })
  const startDriver = vi.fn(async (value: BrowserRecordingDriverInput) => {
    input = value
    return { pause: vi.fn(async () => undefined), resume: vi.fn(async () => undefined), stop }
  })
  const owner = new BrowserRecordingOwner({
    startDriver,
    maxBytes: options.maxBytes,
    dataRoot: options.dataRoot
  })
  const registration = owner.register({
    target,
    signal: source.signal,
    assertCurrent: () => source.signal.throwIfAborted(),
    save
  })
  const start = (
    requestId: string = randomUUID(),
    viewerId = 'viewer'
  ): Promise<BrowserRecordingStatus> =>
    owner.start({
      target,
      viewerId,
      host,
      request: { requestId },
      assertAuthorized: () => undefined
    })
  const segment = (startMs = 0, endMs = 1000): Promise<void> =>
    input.onSegment({
      bytes: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      startMs,
      endMs,
      width: 1280,
      height: 720,
      codec: 'vp8',
      frameRate: 10
    })
  return {
    owner,
    registration,
    saved,
    save,
    start,
    startDriver,
    stop,
    source,
    segment,
    input: () => input
  }
}

describe('browser recording evidence owner', () => {
  it('retains exact native media attestation across restart without trusting imported sender IDs', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'browser-recording-receipts-'))
    const f = fixture({ dataRoot })
    try {
      await f.start()
      await f.segment(0, 1000)
      await f.segment(1000, 2000)
      await f.registration.close('finished')
      const target = f.owner.status('viewer').target!
      const content = f.saved.at(-1)!.source.content
      const identity = {
        checksum: createHash('sha256').update(content).digest('hex'),
        sizeBytes: Buffer.byteLength(content)
      }
      await f.owner.close()
      const restarted = new BrowserRecordingOwner({ dataRoot, startDriver: f.startDriver })
      const mapping = await restarted.readNativeSourceVersionMapping(target, identity)
      const recording = parseBrowserRecording(content)
      expect(mapping).toEqual(
        Object.fromEntries(
          recording.media.map((media) => [media.sourceVersionId, media.sourceVersionId])
        )
      )
      expect(recording.media[0].checksum).toBe(recording.media[1].checksum)
      expect(recording.media[0].sourceVersionId).not.toBe(recording.media[1].sourceVersionId)
      expect(
        await restarted.readNativeSourceVersionMapping(
          { ...target, sessionId: 'imported-session' },
          identity
        )
      ).toBeUndefined()
      expect(
        await restarted.readNativeSourceVersionMapping(target, {
          ...identity,
          checksum: '0'.repeat(64)
        })
      ).toBeUndefined()
      expect(f.startDriver).toHaveBeenCalledTimes(1)
      await restarted.close()
    } finally {
      await f.owner.close()
      await rm(dataRoot, { recursive: true, force: true })
    }
  })
  it('starts once and checkpoints exact immutable media versions without any Notebook', async () => {
    const f = fixture()
    try {
      const requestId = randomUUID()
      const [first, repeated] = await Promise.all([f.start(requestId), f.start(requestId)])
      expect(first.recordingId).toBe(repeated.recordingId)
      expect(f.startDriver).toHaveBeenCalledTimes(1)
      await f.segment()
      const checkpoint = parseBrowserRecording(f.saved[1].source.content)
      expect(checkpoint.coverage.stopReason).toBe('interrupted')
      expect(checkpoint.media[0].sourceVersionId).toBe('version-1')
      expect(checkpoint.segments[0]).toMatchObject({ startMs: 0, endMs: 1000, codec: 'vp8' })
      const request = { requestId: randomUUID(), recordingId: first.recordingId }
      const [closed, duplicate] = await Promise.all([
        f.owner.control('stop', 'viewer', request),
        f.owner.control('stop', 'viewer', request)
      ])
      expect(closed).toEqual(duplicate)
      expect(closed.state).toBe('finalized')
      expect(f.stop).toHaveBeenCalledTimes(1)
      const final = parseBrowserRecording(f.saved.at(-1)!.source.content)
      expect(final.coverage.stopReason).toBe('stopped')
      expect(final.media).toEqual(checkpoint.media)
    } finally {
      await f.owner.close()
    }
  })

  it('does not grant another viewer control or allow a second recording of the same surface', async () => {
    const f = fixture()
    try {
      const recording = await f.start()
      await expect(f.start(randomUUID(), 'other-viewer')).rejects.toThrow('already being recorded')
      await expect(
        f.owner.control('stop', 'other-viewer', {
          requestId: randomUUID(),
          recordingId: recording.recordingId
        })
      ).rejects.toThrow('outside this viewer')
      expect(() => f.owner.status('other-viewer', recording.recordingId)).toThrow(
        'outside this viewer'
      )
      expect(f.stop).not.toHaveBeenCalled()
    } finally {
      await f.owner.close()
    }
  })

  it('finishes inside the admitted publication lifetime and drains the encoder final segment', async () => {
    const f = fixture()
    await f.start()
    f.stop.mockImplementation(async () => {
      await f.segment(0, 1500)
    })
    await f.registration.close('finished')
    expect(f.owner.status('viewer')).toMatchObject({ state: 'finalized', segments: 1 })
    expect(f.owner.inspect(target)).toBe(false)
    f.source.abort()
    expect(parseBrowserRecording(f.saved.at(-1)!.source.content).coverage.stopReason).toBe(
      'finished'
    )
    await expect(f.start()).rejects.toThrow('source is unavailable')
    await f.owner.close()
  })

  it('retains honest gaps and browser event provenance on an interrupted recording', async () => {
    const f = fixture()
    await f.start()
    await f.segment(0, 1000)
    f.input().onGap({ startMs: 1000, endMs: 2000, reason: 'hidden' })
    f.input().onEvent({ offsetMs: 2100, kind: 'click', source: 'browser-observed', x: 23, y: 47 })
    await f.segment(2000, 3000)
    await f.registration.close('interrupted')
    const recording = parseBrowserRecording(f.saved.at(-1)!.source.content)
    expect(recording.coverage.gaps).toEqual([{ startMs: 1000, endMs: 2000, reason: 'hidden' }])
    expect(recording.events[0]).toMatchObject({ source: 'browser-observed', offsetMs: 2100 })
    expect(f.owner.status('viewer').state).toBe('partial')
    await f.owner.close()
  })

  it('bounds media without treating capture capacity as experiment failure', async () => {
    const f = fixture({ maxBytes: 4 })
    await f.start()
    await f.segment()
    await f.segment(1000, 2000)
    await vi.waitFor(() => expect(f.owner.status('viewer').state).toBe('partial'))
    expect(f.saved.filter((output) => output.filename.endsWith('.webm'))).toHaveLength(1)
    expect(f.owner.status('viewer').error).toBe('capacity')
    await f.owner.close()
  })

  it('fails locally when the optional index cannot publish', async () => {
    const f = fixture({ failIndex: true })
    await f.start()
    await f.segment()
    await vi.waitFor(() => expect(f.owner.status('viewer').state).toBe('failed'))
    expect(f.owner.status('viewer').error).toBe('publication-failed')
    expect(f.source.signal.aborted).toBe(false)
    await f.owner.close()
  })
})
