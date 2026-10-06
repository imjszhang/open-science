import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionPackageService } from '../session-package/service'
import { createProvenanceTestFixture } from '../artifacts/provenance-test-fixtures'
import { createManagedExecutionTurnPort } from './managed-execution-port'
import { ManagedExecutionService } from './managed-execution-service'
import {
  ManagedResearchEnvironmentOwner,
  type ManagedResearchRuntime
} from './managed-research-environment'
import {
  createSessionOperationTestHarness,
  operationTestScope as scope
} from './session-operation.test-support'
import type { ManagedExecutionProvenance } from './managed-execution-output'
import { ManagedRuntimeViews } from '../managed-runtime-views'
import { createManagedRunObservationReader } from '../managed-run-observation'
import { RunObservationOwner } from '../run-observation/owner'
import { ObservationViewers } from '../run-observation/viewers'
import {
  RunObservationRecorder,
  type RunObservationRecordingHandle
} from '../run-observation/recorder'
import { createTaskCallerContext } from '../caller-context'
import type { RunObservationTarget } from '../../shared/run-observation'
import { parseRunObservationArchive } from '../run-observation/archive'

vi.mock('electron', () => ({
  app: { getPath: () => '/home/user', isPackaged: true },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openPath: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() }
}))
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')

type Entry = 'external' | 'ordinary' | 'fork'
type Mode = 'plain' | 'interactive' | 'cancel' | 'restart'
const projectSource = `
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path';
fs.writeFileSync(path.join(process.env.OPEN_SCIENCE_OUTPUT_DIR,'result.csv'),'value,42\\n');
let actions = 0;
const server = http.createServer((req,res) => {
  if (req.method === 'POST' && req.url === '/increment') {
    actions++; console.log('generic action '+actions); res.end(String(actions)); return;
  }
  if (req.method === 'POST' && req.url === '/finish') {
    res.end('finishing'); setImmediate(()=>server.close()); return;
  }
  res.setHeader('content-type','text/html'); res.end('<h1>Generic research fixture</h1>');
});
server.listen(4173,'127.0.0.1',()=>console.log('generic project ready'));
`
function projectRequest(
  url: string,
  headers: Record<string, string> = {},
  method = 'GET'
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method,
        headers,
        family: 4,
        lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4)
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => (body += chunk))
        response.once('end', () =>
          resolve({ status: response.statusCode!, headers: response.headers, body })
        )
        response.once('error', reject)
      }
    )
    request.setTimeout(3000, () => request.destroy(new Error('Fixture HTTP request timed out')))
    request.once('error', reject)
    request.end()
  })
}
async function verifyEntry(entry: Entry, mode: Mode): Promise<void> {
  const observed = mode !== 'plain'
  const h = await createSessionOperationTestHarness(cleanups, {
    canonicalStorageRoot: true,
    nativeSandbox: observed
  })
  if (entry === 'fork')
    await h.mutate(scope, (session) => ({
      ...session,
      forkOrigin: {
        importId: 'copy',
        sourceProjectId: 'source-project',
        sourceSessionId: 'source-session',
        importedAt: 1,
        manifestChecksum: 'a'.repeat(64)
      }
    }))
  const executable = await realpath(process.execPath)
  const runtime: ManagedResearchRuntime = {
    kind: 'node',
    executable,
    version: process.versions.node,
    sha256: sha(await readFile(executable)),
    platform: process.platform as 'darwin' | 'linux',
    arch: process.arch,
    readOnlyRoots: [dirname(executable)]
  }
  // The original plain cases retain their pass-through policy. Stage-three cases use the real
  // macOS sandbox, Notebook process owner, observation reader, recorder and project proxy.
  const environments = new ManagedResearchEnvironmentOwner({
    dataRoot: await realpath(h.fixture.storageRoot),
    // macOS Unix service paths must fit sockaddr_un; retain the existing native fixture root.
    socketRoot: observed ? '/private/tmp' : await realpath(tmpdir()),
    verifyRuntime: async () => undefined,
    stopExecution: async (identity) => ({
      verified: (await h.notebook.confirmManagedShellCleanup(identity, { retry: true })).reaped
    })
  })
  cleanups.push(() => environments.close())
  const content = observed ? projectSource : 'fixed research source'
  const views = new ManagedRuntimeViews()
  cleanups.push(async () => views.close())
  const reader = createManagedRunObservationReader({
    inspectExecution: (target) => service.inspectExecution(target)
  })
  const authorize = async (target: RunObservationTarget): Promise<void> => {
    expect(target.projectId).toBe(scope.projectId)
    expect(target.sessionId).toBe(scope.sessionId)
    expect(await h.read(target)).toBeDefined()
  }
  const recordingObserver: RunObservationOwner = new RunObservationOwner({
    authorize,
    read: reader
  })
  const recorderDependencies = {
    dataRoot: h.fixture.storageRoot,
    authorize,
    intervalMs: 60_000,
    read: async (target: RunObservationTarget, signal: AbortSignal) => {
      signal.throwIfAborted()
      const snapshot = await recordingObserver.snapshot(target, { viewerId: 'internal-recording' })
      signal.throwIfAborted()
      return snapshot
    },
    isPublished: async (
      target: RunObservationTarget,
      reference: { artifactId?: string; versionId: string; checksum: string; sizeBytes: number }
    ) => {
      const versions = await h.artifacts.resolveVersionDescriptors({
        projectId: target.projectId,
        appSessionId: target.sessionId,
        versionIds: [reference.versionId]
      })
      return versions.some(
        (version) =>
          version.projectId === target.projectId &&
          version.sessionId === target.sessionId &&
          version.versionId === reference.versionId &&
          (!reference.artifactId || version.artifactId === reference.artifactId) &&
          version.checksum === reference.checksum &&
          version.size === reference.sizeBytes &&
          version.state === 'finalized' &&
          version.isPublished
      )
    }
  }
  const recorder = new RunObservationRecorder(recorderDependencies)
  cleanups.push(() => recorder.close())
  let recordingHandle: RunObservationRecordingHandle | undefined
  const createViewers = (): ObservationViewers => {
    const observer: RunObservationOwner = new RunObservationOwner({
      read: reader,
      authorize: (target, viewer) => viewers.assertViewer(target, viewer)
    })
    const viewers: ObservationViewers = new ObservationViewers({
      observer,
      authorizeScope: authorize,
      onRevoked: (viewerId) => views.closeViewer(viewerId)
    })
    cleanups.push(() => viewers.close())
    return viewers
  }
  const viewers = createViewers()
  const service: ManagedExecutionService = new ManagedExecutionService({
    registerProjectService: (registration) => views.register(registration),
    observations: {
      start: async (target) => (recordingHandle = await recorder.start(target)),
      load: (target) => recorder.load(target),
      markPublished: (target, reference) => recorder.markPublished(target, reference)
    },
    artifacts: h.artifacts,
    dataRoot: h.fixture.storageRoot,
    notebooks: h.fixture.notebookRepository,
    environments,
    operations: h.owner,
    runtime: h.notebook,
    runtimes: {
      discover: async () => ({ runtimes: [{ runtimeId: sha('runtime'), runtime }] }),
      resolve: async () => runtime
    },
    materials: async () => ({
      source: {
        projectId: scope.projectId,
        sessionId: 'source',
        identity: 'fixed-source-identity'
      },
      versions: [
        {
          versionId: 'input-version',
          sourceIdentity: 'fixed-source-identity',
          filename: observed ? 'main.mjs' : 'source.txt',
          sha256: sha(content),
          sizeBytes: Buffer.byteLength(content)
        }
      ],
      readVersion: async () => Buffer.from(content)
    }),
    resolvePreparedInputs: async () => [],
    createSession: async () => {
      throw new Error('No extra Session may be created.')
    },
    withWritableSession: async (_identity, operation) => operation()
  })
  const prepared = (await service.prepare({
    projectId: scope.projectId,
    sessionId: scope.sessionId,
    requestId: 'prepare',
    sourceSessionId: 'source',
    sourceIdentity: 'fixed-source-identity',
    runtimeId: sha('runtime'),
    materials: {
      files: [{ versionId: 'input-version', restorePath: observed ? 'main.mjs' : 'source.txt' }]
    }
  })) as { environmentId: string }
  const input = {
    projectId: scope.projectId,
    sessionId: scope.sessionId,
    environmentId: prepared.environmentId,
    requestId: scope.requestId,
    command: observed
      ? 'node "$OPEN_SCIENCE_INPUT_DIR/main.mjs"'
      : 'printf "value,42\\n" > "$OPEN_SCIENCE_OUTPUT_DIR/result.csv"',
    ...(observed
      ? {
          recordObservation: true,
          localServicePort: 4173,
          projectView: { title: 'Generic research fixture' },
          timeoutMs: 15000
        }
      : {}),
    outputs: [
      { path: 'result.csv', filename: 'result.csv', contentType: 'text/csv' },
      { path: 'optional-missing.txt', filename: 'optional-missing.txt', optional: true }
    ]
  }
  if (entry === 'external') {
    await service.execute(input)
  } else {
    await h.owner.start({
      ...scope,
      requestFingerprint: sha('native turn'),
      requestText: 'Use the prepared research in this current turn.',
      execute: async (context, signal) => {
        const handle = h.artifactTurns.handleForExecution(context.operationId)
        const artifactRunId = h.artifactTurns.snapshot(handle).runId
        const port = createManagedExecutionTurnPort({
          dataRoot: h.fixture.storageRoot,
          service,
          artifacts: h.artifacts,
          notebooks: h.fixture.notebookRepository,
          trackArtifactWrite: (sessionId, executionId, write) => {
            expect(sessionId).toBe(scope.sessionId)
            expect(executionId).toBe(context.operationId)
            return h.artifactTurns.trackWrite(handle, write)
          }
        })
        const turn = Object.freeze({
          projectId: scope.projectId,
          sessionId: scope.sessionId,
          ownerExecutionId: context.operationId,
          artifactRunId,
          artifactStorageSessionId: scope.sessionId,
          workspaceCwd: context.workspaceCwd,
          invocationId: 'native-call',
          provenanceContext: context.provenanceContext as ManagedExecutionProvenance,
          signal,
          assertActive: () => signal.throwIfAborted()
        })
        const result = await port.call('execute', input, turn)
        expect(result).toMatchObject({ status: 'completed' })
        expect(h.artifactTurns.snapshot(handle).phase).toBe('open')
        expect(await port.call('execute', input, turn)).toEqual(result)
        return { text: 'Current turn used the shared execution core.' }
      }
    })
  }
  if (observed) {
    let target!: RunObservationTarget
    await vi.waitFor(
      async () => {
        const operation = await h.owner.get(scope)
        expect(operation?.status, JSON.stringify(operation)).toBe('running')
        target = {
          projectId: scope.projectId,
          sessionId: scope.sessionId,
          operationId: operation!.operationId
        }
        const active = await service.inspectExecution(target)
        expect(active?.run?.status).toBe('running')
        expect(active?.run?.text.stdout).toContain('generic project ready')
      },
      { timeout: 10000 }
    )
    const caller = createTaskCallerContext()
    const access = await viewers.create(target, caller)
    const browser = await viewers.authenticateGrant(access.grant)
    const snapshot = await viewers.snapshot(access.viewerId, { capability: browser.capability })
    expect(snapshot.run?.status).toBe('running')
    expect(snapshot.identity.operationId).toBe(target.operationId)
    expect(snapshot.identity.executionInvocationId).toMatch(/^managed-/)
    expect(snapshot.run?.logs.stdout.text).toContain('generic project ready')
    expect((await h.owner.get(scope))?.artifactVersionIds).toEqual([])
    const selected = await viewers.select(
      access.viewerId,
      { cursor: snapshot.cursor, stepId: snapshot.stepId },
      { caller }
    )
    await recordingHandle!.sample()
    const project = await views.open(
      { projectId: scope.projectId, sessionId: scope.sessionId, runId: snapshot.identity.runId! },
      access.viewerId,
      ['http://127.0.0.1:4111']
    )
    const boot = await projectRequest(project.url)
    expect(boot.status).toBe(303)
    const cookie = boot.headers['set-cookie']![0].split(';')[0]
    const origin = new URL(project.url).origin
    expect((await projectRequest(origin + '/', { cookie })).body).toContain(
      'Generic research fixture'
    )
    expect((await projectRequest(origin + '/increment', { cookie, origin }, 'POST')).body).toBe('1')
    await vi.waitFor(async () =>
      expect((await viewers.snapshot(access.viewerId, { caller })).run?.logs.stdout.text).toContain(
        'generic action 1'
      )
    )
    expect(await viewers.selection(access.viewerId, { caller })).toEqual(selected)
    expect(selected.snapshot.run?.logs.stdout.text).not.toContain('generic action 1')
    await recordingHandle!.sample()
    if (mode === 'restart') {
      const oldGrant = await viewers.issueGrant(access.viewerId, caller)
      await viewers.close()
      await recorder.close()
      // Closing read owners revokes their capabilities without terminating the actual Run.
      expect((await service.inspectExecution(target))?.run?.status).toBe('running')
      await expect(projectRequest(origin + '/', { cookie })).rejects.toThrow()
      await h.owner.close()
      const restarted = h.restartedOwner()
      expect((await restarted.get(scope))?.status).toBe('cancelled')
      const restoredRecorder = new RunObservationRecorder(recorderDependencies)
      cleanups.push(() => restoredRecorder.close())
      const restored = await restoredRecorder.load(recordingHandle!.target)
      expect(restored?.archive?.coverage).toMatchObject({
        stopReason: 'app-exit',
        terminalRunObserved: false
      })
      expect(restored?.archive?.records.at(-1)?.run?.status).toBe('running')
      const restoredViewers = createViewers()
      await expect(restoredViewers.authenticateGrant(oldGrant.grant)).rejects.toMatchObject({
        code: 'unauthorized'
      })
      await expect(
        restoredViewers.snapshot(access.viewerId, { capability: browser.capability })
      ).rejects.toThrow()
      await expect(
        views.open(
          {
            projectId: scope.projectId,
            sessionId: scope.sessionId,
            runId: snapshot.identity.runId!
          },
          'new-viewer',
          ['http://127.0.0.1:4111']
        )
      ).rejects.toThrow()
      expect(
        await h.fixture.notebookRepository.readSessionRuns(scope.projectId, scope.sessionId)
      ).toHaveLength(1)
      expect(
        (await h.read(scope))!.artifacts!.some((artifact) => artifact.name === 'result.csv')
      ).toBe(true)
      return
    }
    if (mode === 'cancel') await service.cancelOperation(scope)
    else
      await projectRequest(origin + '/finish', { cookie, origin }, 'POST').catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ECONNRESET') throw error
        }
      )
    await h.owner.wait(scope)
    await expect(projectRequest(origin + '/', { cookie })).rejects.toThrow()
    const frozen = await viewers.selection(access.viewerId, { caller })
    expect(frozen).toEqual(selected)
  }
  const done = await h.owner.wait(scope)
  expect(done, JSON.stringify(done)).toMatchObject({
    status: mode === 'cancel' ? 'cancelled' : 'completed'
  })
  const session = (await h.read(scope))!
  expect(session.messages.filter((message) => message.role === 'user')).toHaveLength(1)
  expect(session.artifacts).toHaveLength(observed ? 3 : 2)
  expect(session.activeRun).toBeUndefined()
  const output = session.artifacts!.find((artifact) => artifact.name === 'result.csv')!
  const receipt = session.artifacts!.find((artifact) => artifact.name?.startsWith('execution-'))!
  expect(await readFile(output.path, 'utf8')).toBe('value,42\n')
  const runs = await h.fixture.notebookRepository.readSessionRuns(scope.projectId, scope.sessionId)
  expect(runs).toHaveLength(1)
  expect(runs[0]).toMatchObject({
    status: mode === 'cancel' ? 'cancelled' : 'completed',
    promptMessageId: session.messages.find((message) => message.role === 'user')!.id
  })
  const report = JSON.parse(await readFile(receipt.path, 'utf8'))
  expect(report).toMatchObject({
    kind: 'managed-research-execution',
    result: {
      runId: runs[0].runId,
      status: mode === 'cancel' ? 'cancelled' : 'completed',
      missingOptionalOutputs: ['optional-missing.txt']
    }
  })
  expect(report.runtime).not.toHaveProperty('executable')
  expect(h.kernelExecute).not.toHaveBeenCalled()
  if (observed) {
    const status = await service.recordingStatus({
      projectId: scope.projectId,
      sessionId: scope.sessionId,
      runId: runs[0].runId
    })
    expect(status.state).toBe('saved')
    const saved = session.artifacts!.find(
      (artifact) => artifact.versionId === status.archive!.versionId
    )!
    const archive = parseRunObservationArchive(await readFile(saved.path, 'utf8'))
    expect(archive.coverage.terminalRunObserved).toBe(true)
    expect(archive.records.some((record) => record.run?.status === 'running')).toBe(true)
    expect(archive.records.at(-1)?.run?.status).toBe(mode === 'cancel' ? 'cancelled' : 'completed')
    expect(
      archive.records.every((record) => record.sourceEvidence.identity.runId === runs[0].runId)
    ).toBe(true)
    const version = await h.fixture.client.artifactVersion.findUniqueOrThrow({
      where: { id: saved.versionId! }
    })
    expect(version.producerRunId).toBeNull()
    const count = await h.fixture.client.artifactVersion.count()
    expect(
      (
        await service.recordingStatus({
          projectId: scope.projectId,
          sessionId: scope.sessionId,
          runId: runs[0].runId
        })
      ).archive
    ).toEqual(status.archive)
    expect(await h.fixture.client.artifactVersion.count()).toBe(count)
  }
  if (entry === 'external' && mode === 'plain') {
    await h.snapshots.captureFinalizedMessages(session)
    const exporter = new SessionPackageService({
      storageRoot: h.fixture.storageRoot,
      getClient: async () => h.fixture.client
    })
    cleanups.push(() => exporter.close())
    const path = join(h.fixture.storageRoot, 'managed-result.science')
    await exporter.exportTo({ projectId: scope.projectId, sessionId: scope.sessionId }, path)
    const target = await createProvenanceTestFixture()
    cleanups.push(target.dispose)
    const importer = new SessionPackageService({
      storageRoot: target.storageRoot,
      getClient: async () => target.client
    })
    cleanups.push(() => importer.close())
    const imported = await importer.importFrom(path)
    const origin = await importer.readOrigin(imported)
    const version = await target.client.artifactVersion.findUniqueOrThrow({
      where: { id: origin.identities[output.versionId!] }
    })
    expect(await readFile(join(target.storageRoot, version.contentStorageKey), 'utf8')).toBe(
      'value,42\n'
    )
    const importedRuns = await target.notebookRepository.readSessionRuns(
      imported.projectId,
      imported.sessionId
    )
    expect(importedRuns).toHaveLength(1)
    expect(importedRuns[0].runId).toBe(origin.identities[runs[0].runId])
    expect(importedRuns[0].status).toBe('completed')
    expect(version.producerRunId).toBe(importedRuns[0].runId)
  }
}

it.skipIf(process.platform === 'win32').each(['external', 'ordinary', 'fork'] as const)(
  'runs the %s entry through the real shared core, managed Notebook Run, and existing Artifact publication',
  (entry) => verifyEntry(entry, 'plain')
)
it.skipIf(process.platform !== 'darwin').each(['external', 'ordinary', 'fork'] as const)(
  'observes, interacts with and records the %s entry through the actual native managed Run',
  (entry) => verifyEntry(entry, 'interactive'),
  30_000
)
it.skipIf(process.platform !== 'darwin').each(['cancel', 'restart'] as const)(
  'retains genuine generic Run evidence through %s without reusing old viewer grants or executing again',
  (mode) => verifyEntry('external', mode),
  30_000
)
