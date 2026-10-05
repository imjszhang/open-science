import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_NOTEBOOK_NETWORK_SETTINGS } from '../../shared/notebook-network'
import type { ManagedEnvironmentReference } from '../../shared/managed-execution'
import { ArtifactTurnOwner } from '../acp/artifact-turn-owner'
import { createArtifactHandlers } from '../artifacts/ipc'
import { ArtifactProvenanceRepository } from '../artifacts/provenance-repository'
import { createProvenanceTestFixture } from '../artifacts/provenance-test-fixtures'
import { ArtifactRunRegistry } from '../artifacts/run-registry'
import { SessionRepository } from '../session-persistence/repository'
import { SessionPersistenceReconciliationOwner } from '../session-persistence/reconciliation-owner'
import { RuntimeSessionOwner } from '../session-persistence/runtime-session-owner'
import { initDataRoot } from '../storage-root'
import { createNotebookArtifactSourceScopeProvider } from './artifact-source-scope'
import { ManagedExecutionService } from './managed-execution-service'
import { ManagedResearchEnvironmentOwner } from './managed-research-environment'
import { createManagedResearchNodeRuntimeRegistry } from './managed-research-node-runtime'
import { NotebookNetworkSandboxOwner } from './network-sandbox-owner'
import { getNotebookDataRoot, NotebookRunRepository } from './repository'
import { NotebookRuntimeService } from './runtime-service'
import { SessionOperationOwner, type SessionOperationDependencies } from './session-operation-owner'

vi.mock('electron', () => ({
  app: { getPath: () => '/home/user', isPackaged: true },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openPath: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() }
}))

const scope = { projectId: 'project-1', sessionId: 'session-1' }
const quote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'"
const sha = (value: string): string => createHash('sha256').update(value).digest('hex')
const script = String.raw`
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
const mode = process.argv[2];
const server = http.createServer((_request, response) => response.end('generic-node-ready'));
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(process.env.OPEN_SCIENCE_SERVICE_SOCKET, resolve) });
const reply = await new Promise((resolve, reject) => {
  http.get({ socketPath: process.env.OPEN_SCIENCE_SERVICE_SOCKET, path: '/status' }, response => {
    let content = ''; response.on('data', chunk => content += chunk); response.on('end', () => resolve(content));
  }).on('error', reject);
});
const tcp = await new Promise(resolve => {
  const attempt = net.createServer(); attempt.once('error', error => resolve(error.code));
  attempt.listen({ host: '127.0.0.1', port: 0 }, () => attempt.close(() => resolve('allowed')));
});
let inputWrite;
try { fs.writeFileSync(path.join(process.env.OPEN_SCIENCE_INPUT_DIR, 'main.mjs'), 'changed'); inputWrite = 'allowed' }
catch (error) { inputWrite = error.code }
let privateRead;
try { fs.readFileSync(process.argv[3]); privateRead = 'allowed' } catch (error) { privateRead = error.code }
const result = { reply, tcp, inputWrite, privateRead, pid: process.pid, mode, cwd: process.cwd() };
fs.writeFileSync(path.join(process.env.OPEN_SCIENCE_OUTPUT_DIR, 'result.json'), JSON.stringify(result));
console.log(JSON.stringify(result));
if (mode === 'normal') await new Promise(resolve => server.close(resolve));
`

type Harness = {
  root: string
  notebookRoot: string
  notebooks: NotebookRunRepository
  fixture: Awaited<ReturnType<typeof createProvenanceTestFixture>>
  notebook: NotebookRuntimeService
  sandbox: NotebookNetworkSandboxOwner
  environments: ManagedResearchEnvironmentOwner
  operations: SessionOperationOwner
  service: ManagedExecutionService
  environment: ManagedEnvironmentReference
  read: SessionOperationDependencies['sessions']['read']
  kernelExecute: ReturnType<typeof vi.fn>
  globalGrants: ReturnType<typeof vi.fn>
}

async function setup(): Promise<Harness> {
  const fixture = await createProvenanceTestFixture()
  const root = await realpath(fixture.storageRoot)
  // Reproduce mixed logical/canonical storage roots even when TMPDIR has no /var alias.
  const notebookRoot = join(root, 'logical-storage')
  await symlink(root, notebookRoot, 'dir')
  initDataRoot(root)
  await fixture.client.project.create({
    data: { id: scope.projectId, name: 'Generic managed execution' }
  })
  const workspace = join(root, 'ordinary-workspace')
  await mkdir(workspace)
  await writeFile(join(workspace, 'unrelated.txt'), 'ordinary workspace stays separate')
  const sessions = new SessionRepository(root)
  await sessions.saveSession({
    id: scope.sessionId,
    projectId: scope.projectId,
    title: 'Offline engineering check',
    cwd: workspace,
    status: 'idle',
    messages: [],
    createdAt: 1,
    updatedAt: 1
  })
  const read: SessionOperationDependencies['sessions']['read'] = async ({
    projectId,
    sessionId
  }) => {
    const loaded = await sessions.loadSessionWithDiagnostics(projectId, sessionId, {
      preserveRuntimeState: true
    })
    if (loaded.status === 'unreadable') throw new Error('Fixture Session is unreadable')
    return loaded.status === 'found' ? loaded.session : undefined
  }
  let tail: Promise<unknown> = Promise.resolve()
  const mutate: SessionOperationDependencies['sessions']['mutate'] = (identity, change) => {
    const mutation = tail.then(async () => {
      const session = await read(identity)
      if (!session) throw new Error('Fixture Session is missing')
      return sessions.saveSession(change(session), session.revision)
    })
    tail = mutation.catch(() => undefined)
    return mutation
  }
  const artifacts = new ArtifactProvenanceRepository({
    ...fixture.repositoryOptions,
    storageRoot: root,
    loadSession: (projectId, sessionId) => read({ projectId, sessionId })
  })
  const registry = new ArtifactRunRegistry()
  const handlers = createArtifactHandlers(fixture.compatibilityRepository, registry, {
    provenance: artifacts
  })
  const runtimeSessions = new RuntimeSessionOwner({
    loadSession: read,
    mutateSession: mutate,
    finalizeArtifacts: handlers.finalizeRunArtifacts
  })
  const artifactTurns = new ArtifactTurnOwner({
    dataRoot: root,
    repository: fixture.compatibilityRepository,
    runRegistry: registry,
    provenance: artifacts,
    notebookArtifactSourceScope: createNotebookArtifactSourceScopeProvider(root)
  })
  const sandbox = new NotebookNetworkSandboxOwner({
    resourceRoot: join(process.cwd(), 'packages/notebook-network-sandbox/vendor'),
    temporaryRoot: join(root, 'commands'),
    getSettings: async () => DEFAULT_NOTEBOOK_NETWORK_SETTINGS,
    persistAlwaysAllow: async () => DEFAULT_NOTEBOOK_NETWORK_SETTINGS,
    requestDecision: async () => 'deny'
  })
  const notebooks = new NotebookRunRepository(notebookRoot)
  const kernelExecute = vi.fn(() => {
    throw new Error('No kernel or model may run in this fixture')
  })
  const globalGrants = vi.fn(async () => [
    { id: 'global-user-root', path: workspace, name: 'ordinary workspace', access: 'rw' as const }
  ])
  const notebook = new NotebookRuntimeService({
    configRoot: root,
    dataRoot: notebookRoot,
    projectId: scope.projectId,
    repository: notebooks,
    processSandbox: sandbox,
    getGrantedLocalRoots: globalGrants,
    executorFactory: () => ({ execute: kernelExecute, shutdown: async () => ({ reaped: true }) })
  })
  await notebook.recoverInterruptedOperations()
  const reconciliation = new SessionPersistenceReconciliationOwner({
    repository: sessions,
    artifactStorage: artifacts,
    fileIndex: { syncSession: async () => [], reconcileActiveSessions: async () => undefined }
  })
  const operations = new SessionOperationOwner({
    dataRoot: root,
    sessions: { read, mutate },
    runtimeSessions,
    artifactTurns,
    artifacts,
    notebooks,
    reserveSession: async () => () => undefined,
    recoverNotebookOperations: async () => {
      await notebook.recoverInterruptedOperations()
    },
    retryArtifactFinalization: async (request) => {
      const session = await read(request)
      if (!session) throw new Error('Fixture Session missing during recovery')
      return reconciliation.retryArtifactFinalization(session, request)
    }
  })
  const runtimes = createManagedResearchNodeRuntimeRegistry({
    trustedCandidates: [process.execPath]
  })
  const discovered = await runtimes.discover()
  expect(discovered.runtimes).toHaveLength(1)
  const environments = new ManagedResearchEnvironmentOwner({
    dataRoot: root,
    socketRoot: '/private/tmp',
    verifyRuntime: (runtime) => runtimes.verify(runtime),
    stopExecution: async (request) => ({
      verified: (await notebook.confirmManagedShellCleanup(request, { retry: true })).reaped
    })
  })
  const service = new ManagedExecutionService({
    artifacts,
    dataRoot: root,
    notebooks,
    environments,
    operations,
    runtime: notebook,
    runtimes,
    // A synthetic immutable material authority; the real import/selection bridge has separate tests.
    materials: async () => ({
      source: { projectId: scope.projectId, sessionId: 'synthetic-source', identity: sha(script) },
      versions: [
        {
          versionId: 'generic-node-script',
          sourceIdentity: sha(script),
          filename: 'main.mjs',
          sha256: sha(script),
          sizeBytes: Buffer.byteLength(script)
        }
      ],
      readVersion: async () => Buffer.from(script)
    }),
    resolvePreparedInputs: async () => [],
    createSession: async () => {
      throw new Error('This fixture uses its real existing Session')
    },
    withWritableSession: async (_scope, operation) => operation()
  })
  const prepared = (await service.prepare({
    ...scope,
    requestId: 'prepare-node',
    sourceSessionId: 'synthetic-source',
    sourceIdentity: sha(script),
    runtimeId: discovered.runtimes[0].runtimeId,
    materials: { files: [{ versionId: 'generic-node-script', restorePath: 'main.mjs' }] }
  })) as { environmentId: string }
  return {
    root,
    notebookRoot,
    notebooks,
    fixture,
    notebook,
    sandbox,
    environments,
    operations,
    service,
    environment: { ...scope, environmentId: prepared.environmentId },
    read,
    kernelExecute,
    globalGrants
  }
}

describe.skipIf(process.platform !== 'darwin')(
  'managed execution service in the native macOS sandbox',
  () => {
    it.each(['normal', 'cancel', 'timeout'] as const)(
      'restores generic Node material, publishes %s results and releases only after process proof',
      async (mode) => {
        const h = await setup()
        const operation = { ...scope, requestId: 'run-' + mode }
        const request = {
          ...h.environment,
          requestId: operation.requestId,
          command:
            'node "$OPEN_SCIENCE_INPUT_DIR/main.mjs" ' +
            mode +
            ' ' +
            quote(join(h.root, 'ordinary-workspace/unrelated.txt')),
          timeoutMs: mode === 'timeout' ? 2000 : 15_000,
          localServicePort: 4173,
          outputs: [
            { path: 'result.json', filename: 'result.json', contentType: 'application/json' }
          ],
          description: 'Run a generic Node service with no model or network provider.'
        }
        let reaped = false
        try {
          const admitted = await h.service.execute(request)
          if (mode === 'cancel') {
            await vi.waitFor(
              async () =>
                expect(
                  JSON.parse(
                    await readFile(
                      join(
                        getNotebookDataRoot(h.root, scope.projectId, scope.sessionId),
                        'managed-execution',
                        h.environment.environmentId,
                        'files/result.json'
                      ),
                      'utf8'
                    )
                  ).reply
                ).toBe('generic-node-ready'),
              { timeout: 15_000 }
            )
            await h.service.cancelOperation(operation)
          }
          const done = await h.operations.wait(operation)
          expect(done, JSON.stringify(done)).toMatchObject({
            status: mode === 'normal' ? 'completed' : mode === 'cancel' ? 'cancelled' : 'failed'
          })
          expect(done!.notebookRunIds).toHaveLength(1)
          expect(done!.artifactVersionIds).toHaveLength(2)
          expect(h.kernelExecute).not.toHaveBeenCalled()
          const runs = (
            await h.notebooks.readSessionDocuments(scope.projectId, scope.sessionId)
          ).flatMap((document) => document.runs)
          expect(runs).toHaveLength(1)
          expect(runs[0]).toMatchObject({
            runId: done!.notebookRunIds[0],
            status: mode === 'normal' ? 'completed' : mode === 'cancel' ? 'cancelled' : 'timeout',
            ...done!.provenance
          })
          expect(runs[0].workingFiles).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                path: join(
                  getNotebookDataRoot(h.notebookRoot, scope.projectId, scope.sessionId),
                  'managed-execution',
                  h.environment.environmentId,
                  'files/result.json'
                ),
                createdByRunId: runs[0].runId
              })
            ])
          )
          // OS containment and observed output bytes do not prove every file read by arbitrary Node code.
          expect(runs[0].fileEvidence?.fileReads).not.toBe('complete')
          const version = await h.fixture.client.artifactVersion.findUniqueOrThrow({
            where: { id: done!.artifactVersionIds[0] }
          })
          expect(version).toMatchObject({
            producerRunId: runs[0].runId,
            notebookSessionId: scope.sessionId
          })
          const result = JSON.parse(await readFile(join(h.root, version.contentStorageKey), 'utf8'))
          expect(result.reply).toBe('generic-node-ready')
          expect(['EPERM', 'EACCES']).toContain(result.tcp)
          expect(['EPERM', 'EACCES']).toContain(result.inputWrite)
          expect(['EPERM', 'EACCES']).toContain(result.privateRead)
          expect(h.globalGrants).not.toHaveBeenCalled()
          expect(result.cwd).toBe(
            join(h.root, 'research-environments', h.environment.environmentId, 'work')
          )
          expect(() => process.kill(result.pid, 0)).toThrow()
          const session = (await h.read(scope))!
          expect(session.activeRun).toBeUndefined()
          expect(session.cwd).toBe(join(h.root, 'ordinary-workspace'))
          expect(session.artifacts?.map((artifact) => artifact.versionId)).toEqual(
            expect.arrayContaining(done!.artifactVersionIds)
          )
          const repeated = await h.service.execute(request)
          expect(repeated.operationId).toBe(admitted.operationId)
          expect(
            (await h.notebooks.readSessionDocuments(scope.projectId, scope.sessionId)).flatMap(
              (document) => document.runs
            )
          ).toHaveLength(1)
          expect(await h.service.releaseEnvironment(h.environment)).toMatchObject({
            state: 'released'
          })
          await expect(
            stat(join(h.root, 'research-environments', h.environment.environmentId))
          ).rejects.toMatchObject({ code: 'ENOENT' })
          await expect(
            stat(
              join(
                getNotebookDataRoot(h.root, scope.projectId, scope.sessionId),
                'managed-execution',
                h.environment.environmentId
              )
            )
          ).rejects.toMatchObject({ code: 'ENOENT' })
        } catch (error) {
          const documents = await h.notebooks.readSessionDocuments(scope.projectId, scope.sessionId)
          throw new Error(
            JSON.stringify({
              cause: String(error),
              runs: documents
                .flatMap((document) => document.runs)
                .map((run) => ({
                  status: run.status,
                  text: run.text,
                  workingFiles: run.workingFiles
                }))
            }),
            { cause: error }
          )
        } finally {
          await h.operations.close()
          await h.environments.close()
          const shutdown = await h.notebook.shutdownAll()
          reaped = shutdown.reaped
          await h.notebook.dispose()
          await h.sandbox.dispose()
          if (reaped) await h.fixture.dispose()
          expect(reaped).toBe(true)
        }
      },
      40_000
    )
  }
)
