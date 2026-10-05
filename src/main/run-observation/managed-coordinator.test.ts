import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi, type Mock } from 'vitest'
import type {
  ArtifactVersionDescriptor,
  ArtifactVersionFile
} from '../../shared/artifact-provenance'
import type { RunObservationSnapshot } from '../../shared/run-observation'
import type { ManagedOutputWriteAttempt } from '../notebook/managed-output-publication'
import { saveAuxiliaryOutput } from './auxiliary-output'
import { ManagedRunObservationCoordinator } from './managed-coordinator'
import { RunObservationRecorder } from './recorder'

const target = {
  projectId: 'project-a',
  sessionId: 'session-a',
  operationId: 'operation-a',
  executionInvocationId: 'invocation-a'
}
const provenance = {
  rootFrameId: 'root',
  agentFrameId: 'root',
  messageBranchId: 'branch',
  runtimeSegmentId: 'segment',
  promptMessageId: 'prompt'
}
const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
const snapshot: RunObservationSnapshot = {
  identity: { ...target, runId: 'run-a' },
  cursor: { epoch: 'epoch-a', sequence: 0 },
  observedAt: 200,
  phase: 'completed',
  stepId: 'run:run-a',
  artifacts: [],
  artifactsTruncated: false,
  run: {
    runId: 'run-a',
    executionInvocationId: target.executionInvocationId,
    kernelKind: 'bash',
    status: 'completed',
    startedAt: 100,
    endedAt: 190,
    logs: {
      stdout: { text: 'completed', redacted: false, truncated: false },
      stderr: { text: '', redacted: false, truncated: false },
      traceback: { text: '', redacted: false, truncated: false }
    }
  }
}
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup(): Promise<{
  dataRoot: string
  coordinator: ManagedRunObservationCoordinator
  recorder: RunObservationRecorder
  context: {
    projectId: string
    sessionId: string
    provenanceContext: typeof provenance
    saveAuxiliaryOutput(
      output: Parameters<typeof saveAuxiliaryOutput>[0]
    ): ReturnType<typeof saveAuxiliaryOutput>
  }
  artifacts: {
    resolveVersionDescriptors: Mock<
      (request: { versionIds: string[] }) => Promise<ArtifactVersionDescriptor[]>
    >
    replayVersion: Mock<() => Promise<undefined>>
  }
  descriptors: Map<string, ArtifactVersionDescriptor>
  save: Mock<(output: Parameters<typeof saveAuxiliaryOutput>[0]) => Promise<ArtifactVersionFile>>
  attempts: ManagedOutputWriteAttempt[]
}> {
  const dataRoot = await mkdtemp(join(tmpdir(), 'observation-publication-'))
  cleanups.push(() => rm(dataRoot, { force: true, recursive: true }))
  const descriptors = new Map<string, ArtifactVersionDescriptor>()
  const attempts: ManagedOutputWriteAttempt[] = []
  const recorder = new RunObservationRecorder({
    dataRoot,
    intervalMs: 60_000,
    read: async () => snapshot,
    isPublished: async (_target, reference) =>
      descriptors.get(reference.versionId)?.isPublished === true
  })
  cleanups.push(() => recorder.close())
  const artifacts = {
    resolveVersionDescriptors: vi.fn(async ({ versionIds }: { versionIds: string[] }) =>
      versionIds.flatMap((versionId) => {
        const value = descriptors.get(versionId)
        return value ? [value] : []
      })
    ),
    replayVersion: vi.fn(async () => undefined)
  }
  const coordinator = new ManagedRunObservationCoordinator({
    dataRoot,
    recorder: () => recorder,
    artifacts
  })
  const save = vi.fn(
    async (output: Parameters<typeof saveAuxiliaryOutput>[0]): Promise<ArtifactVersionFile> => {
      const content = output.source.content
      const attempt: ManagedOutputWriteAttempt = {
        schemaVersion: 1,
        request: {
          projectId: target.projectId,
          appSessionId: target.sessionId,
          artifactStorageSessionId: target.sessionId,
          artifactRunId: 'artifact-run',
          writeOperationId: 'write-capture',
          filename: output.filename,
          contentType: output.contentType
        },
        destination: {
          provenanceContext: provenance,
          messageAncestry: [provenance.promptMessageId]
        },
        source: { kind: 'inline', sha256: hash(content), sizeBytes: Buffer.byteLength(content) }
      }
      await output.publication?.beforeWrite(attempt)
      attempts.push(attempt)
      const version: ArtifactVersionDescriptor = {
        projectId: target.projectId,
        sessionId: target.sessionId,
        id: 'version-capture',
        versionId: 'version-capture',
        artifactId: 'artifact-capture',
        versionNumber: 1,
        name: output.filename,
        checksum: hash(content),
        size: Buffer.byteLength(content),
        state: 'pending',
        isPublished: false,
        createdAt: new Date(0).toISOString(),
        mtimeMs: 0
      }
      descriptors.set(version.versionId, version)
      return { ...version, path: '/not-persisted', fileUrl: 'file:///not-persisted' }
    }
  )
  const context = {
    projectId: target.projectId,
    sessionId: target.sessionId,
    provenanceContext: provenance,
    saveAuxiliaryOutput: (output: Parameters<typeof saveAuxiliaryOutput>[0]) =>
      saveAuxiliaryOutput(output, (value) =>
        save(value as Parameters<typeof saveAuxiliaryOutput>[0])
      )
  }
  return { dataRoot, coordinator, context, recorder, artifacts, descriptors, save, attempts }
}

it('keeps its exact write intent outside the execution journal and confirms publication after independent restart', async () => {
  const h = await setup()
  const capture = await h.coordinator.begin(target, h.context)
  const saved = await h.coordinator.publish({
    target,
    context: h.context,
    handle: capture.handle,
    recovery: false
  })
  expect(saved).toMatchObject({
    savedInCurrentTurn: true,
    result: { status: 'saved', versionId: 'version-capture' }
  })
  const files = await readdir(join(h.dataRoot, 'managed-observation-publications'))
  expect(files).toHaveLength(1)
  const text = await readFile(
    join(h.dataRoot, 'managed-observation-publications', files[0]),
    'utf8'
  )
  expect(text).not.toMatch(/not-persisted|file:\/\/|producerRunId/)
  expect(JSON.parse(text)).toMatchObject({
    target,
    reference: { versionId: 'version-capture' },
    attempts: [{ request: h.attempts[0].request }]
  })
  const descriptor = h.descriptors.get('version-capture')!
  descriptor.state = 'finalized'
  descriptor.isPublished = true
  const restarted = new ManagedRunObservationCoordinator({
    dataRoot: h.dataRoot,
    recorder: () => h.recorder,
    artifacts: h.artifacts
  })
  await restarted.reconcilePublished(target)
  expect(await restarted.status(target)).toMatchObject({
    status: 'published',
    versionId: 'version-capture'
  })
  expect(h.save).toHaveBeenCalledOnce()
})

it('does not deadlock when the current Artifact write emits a reentrant publication hint', async () => {
  const h = await setup()
  const capture = await h.coordinator.begin(target, h.context)
  const markPublished = h.recorder.markPublished.bind(h.recorder)
  vi.spyOn(h.recorder, 'markPublished').mockImplementation(async (...args) => {
    // The exact reference is already durable at this point; this hook must skip its own in-flight writer.
    await h.coordinator.reconcilePublished(target)
    return markPublished(...args)
  })
  const save = h.save.getMockImplementation()!
  h.save.mockImplementation(async (output) => {
    const result = await save(output)
    await h.coordinator.reconcilePublished(target)
    return result
  })
  const result = await h.coordinator.publish({
    target,
    context: h.context,
    handle: capture.handle,
    recovery: false
  })
  expect(result.result.status).toBe('saved')
})

it('refuses a foreign Main branch or changed operation identity before any Artifact write', async () => {
  const h = await setup()
  const capture = await h.coordinator.begin(target, h.context)
  await capture.handle!.finish()
  const branch = await h.coordinator.publish({
    target,
    context: { ...h.context, provenanceContext: { ...provenance, messageBranchId: 'foreign' } },
    recovery: true
  })
  expect(branch.result).toMatchObject({ status: 'pending', warning: 'archive-recovery-pending' })
  const operation = await h.coordinator.publish({
    target: { ...target, operationId: 'different-operation' },
    context: h.context,
    recovery: true
  })
  expect(operation.result.status).toBe('pending')
  expect(h.save).not.toHaveBeenCalled()
})

it('preserves a malformed or future publication record instead of issuing another write', async () => {
  const h = await setup()
  const capture = await h.coordinator.begin(target, h.context)
  await capture.handle!.finish()
  const path = join(
    h.dataRoot,
    'managed-observation-publications',
    (await readdir(join(h.dataRoot, 'managed-observation-publications')))[0]
  )
  const future = JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), schemaVersion: 2 })
  await writeFile(path, future)
  const result = await h.coordinator.publish({ target, context: h.context, recovery: true })
  expect(result.result.status).toBe('pending')
  expect(await readFile(path, 'utf8')).toBe(future)
  expect(h.save).not.toHaveBeenCalled()
})

it('never falls back to a required-output writer when the optional capability is absent', async () => {
  const h = await setup()
  const capture = await h.coordinator.begin(target, h.context)
  const result = await h.coordinator.publish({
    target,
    context: { ...h.context, saveAuxiliaryOutput: undefined },
    handle: capture.handle,
    recovery: false
  })
  expect(result.result).toMatchObject({ status: 'pending', warning: 'archive-save-failed' })
  expect(h.save).not.toHaveBeenCalled()
  expect((await h.recorder.load(target))?.archive).toBeDefined()
})
