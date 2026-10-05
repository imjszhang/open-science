// @ts-expect-error The published ESM entry uses a sibling index.d.ts.
import { OpenScienceClient } from '../../../packages/open-science/index.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ApplicationEventHub } from '../application-events'
import { ImmutableInputAuthority } from '../immutable-input-authority'
import { createManagedExecutionExternalPort } from '../managed-execution-external-port'
import { ManagedFileVersionService } from '../managed-file-versions/service'
import { ManagedFileIndexRepository } from '../project-files/repository'
import { SessionPackageHeadless } from '../session-package/headless'
import { SessionPackageService } from '../session-package/service'
import { UploadRepository } from '../uploads/repository'
import { startWebHttpServer } from '../web-service/http-server'
import { HeadlessTaskApi } from '../web-service/task-api'
import { createManagedExecutionTurnPort } from './managed-execution-port'
import { ManagedExecutionService } from './managed-execution-service'
import type { ManagedExecutionProvenance } from './managed-execution-output'
import { ManagedResearchEnvironmentOwner } from './managed-research-environment'
import { createManagedResearchNodeRuntimeRegistry } from './managed-research-node-runtime'
import {
  createResearchMaterialAuthority,
  resolvePreparedResearchMaterialInput
} from './research-material-authority'
import type { ResearchMaterialInspection } from './research-materials'
import {
  createSessionOperationTestHarness,
  operationTestScope,
  type SessionOperationTestHarness
} from './session-operation.test-support'
import type { SessionPackageRequest } from '../../shared/session-package'
import type { ExecuteManagedEnvironmentRequest } from '../../shared/managed-execution'
import { parseResearchReproductionDescription } from '../../shared/research-reproduction'

vi.mock('electron', () => ({
  app: { getPath: () => '/home/user', isPackaged: true },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false },
  net: { fetch: globalThis.fetch },
  shell: { openPath: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() }
}))

// These explicit opt-ins select reviewed local materials and a NEW directory for retained evidence.
// No project-specific API, command, outcome or material path belongs in this generic harness.
const materialsRoot = process.env.OPEN_SCIENCE_MANAGED_RESEARCH_MATERIALS
const evidenceRoot = process.env.OPEN_SCIENCE_MANAGED_RESEARCH_OUTPUT
const cleanups: Array<() => Promise<unknown>> = []
async function disposeCleanups(from = 0): Promise<void> {
  const errors: unknown[] = []
  for (const cleanup of cleanups.splice(from).reverse()) {
    try {
      await cleanup()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Research acceptance cleanup failed.')
}
afterEach(() => disposeCleanups())
const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
const quote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'"
const scope = { projectId: operationTestScope.projectId, sessionId: operationTestScope.sessionId }
type Acceptance = {
  title: string
  descriptorFilename: string
  planKey: string
  // Older reviewed engineering fixtures predate this optional harness expectation.
  planScope?: 'end-to-end' | 'downstream-only' | 'alternative-conditions' | 'engineering-check'
  command: string
  localServicePort?: number
  timeoutMs: number
  outputs: ExecuteManagedEnvironmentRequest['outputs']
  expect: { jsonAssertions: Array<{ path: string; pointer: string; equals: unknown }> }
}

const packageService = (h: SessionOperationTestHarness): SessionPackageService => {
  const service = new SessionPackageService({
    storageRoot: h.fixture.storageRoot,
    getClient: async () => h.fixture.client
  })
  cleanups.push(() => service.close())
  return service
}

const transfer = (service: SessionPackageService): SessionPackageHeadless => {
  const owner = new SessionPackageHeadless({
    service,
    assertCanStart: () => undefined,
    withDataRootWrite: (operation) => operation(),
    reserveExport: async () => () => undefined,
    reserveImport: async () => () => undefined,
    afterImport: async () => undefined
  })
  cleanups.push(() => owner.close())
  return owner
}

async function client(
  h: SessionOperationTestHarness,
  packages: SessionPackageHeadless,
  service?: ManagedExecutionService
): Promise<import('../../../packages/open-science/index').OpenScienceClient> {
  const forbidModel = vi.fn(async (): Promise<never> => {
    throw new Error('Research execution acceptance must not start another Agent or model.')
  })
  const tasks = new HeadlessTaskApi({
    commands: { commandNames: () => [], invoke: forbidModel },
    agent: {
      withSessionAvailable: async (_project, _session, operation) => operation(),
      listAttachedSessionIds: async () => [],
      createSession: forbidModel,
      resumeSession: forbidModel,
      setPermissionProfile: forbidModel,
      setMemoryEnabled: forbidModel,
      prompt: forbidModel,
      cancelPrompt: forbidModel
    },
    sessionPackages: packages,
    managedExecution: service
      ? createManagedExecutionExternalPort({ service, assertOpen: () => undefined })
      : undefined
  })
  cleanups.push(async () => {
    await tasks.dispose()
    expect(forbidModel).not.toHaveBeenCalled()
  })
  const token = randomUUID()
  const server = await startWebHttpServer({
    host: '127.0.0.1',
    port: 0,
    token,
    staticRoot: h.fixture.storageRoot,
    applicationEvents: new ApplicationEventHub(),
    applicationCommands: {
      localWeb: { commandNames: () => [], invoke: forbidModel },
      remoteWeb: { commandNames: () => [], rejectedCommandNames: () => [], invoke: forbidModel }
    },
    tasks,
    bootstrap: {
      appName: 'Managed research acceptance',
      appVersion: 'test',
      configRoot: h.fixture.storageRoot,
      platform: process.platform,
      versions: { electron: 'test', chrome: 'test', node: process.versions.node }
    }
  })
  cleanups.push(() => server.close())
  return new OpenScienceClient({ baseUrl: `http://127.0.0.1:${server.port}`, token })
}

async function publishMaterials(
  root: string,
  output: string,
  acceptance: Acceptance
): Promise<string> {
  const h = await createSessionOperationTestHarness(cleanups, { canonicalStorageRoot: true })
  await h.mutate(scope, (session) => ({ ...session, title: acceptance.title }))
  const index = JSON.parse(await readFile(join(root, 'material-file-index.json'), 'utf8')) as {
    description: string
    descriptionSha256: string
    files: Array<{ key: string; relativePath: string; sha256: string; sizeBytes: number }>
  }
  const descriptorBytes = await readFile(join(root, index.description))
  expect(sha(descriptorBytes)).toBe(index.descriptionSha256)
  const parsed = parseResearchReproductionDescription(descriptorBytes.toString('utf8'))
  if (parsed.status !== 'valid')
    throw new Error('Acceptance materials require a valid description.')
  const materials = parsed.description.materials.filter((item) => item.availability === 'included')
  expect(index.files).toHaveLength(materials.length)
  const workspace = (await h.read(scope))!.cwd!
  const inputs = [{ filename: acceptance.descriptorFilename, bytes: descriptorBytes }]
  for (const material of materials) {
    const item = index.files.find((entry) => entry.key === material.key)!
    expect(item).toBeDefined()
    const sourcePath = resolve(root, item.relativePath)
    expect(sourcePath.startsWith(resolve(root) + '/')).toBe(true)
    const bytes = await readFile(sourcePath)
    expect(bytes.length).toBe(item.sizeBytes)
    expect(sha(bytes)).toBe(item.sha256)
    expect(material).toMatchObject({ sha256: item.sha256, sizeBytes: item.sizeBytes })
    inputs.push({ filename: material.filename, bytes })
  }
  for (const input of inputs) {
    expect(basename(input.filename)).toBe(input.filename)
    await writeFile(join(workspace, input.filename), input.bytes, { flag: 'wx' })
  }
  await h.owner.start({
    ...scope,
    requestId: 'publish-reviewed-materials',
    requestFingerprint: sha(index.descriptionSha256),
    requestText:
      'Publish the selected reviewed research materials. Publication does not execute their research plan.',
    execute: async (context, signal) => {
      // A real copying command records exactly how these selected public input copies were published.
      // It does not fabricate a historical study, Notebook Run or producer assertion.
      const result = await h.notebook.executeShell(
        {
          ...scope,
          workspaceCwd: context.workspaceCwd,
          provenanceContext: context.provenanceContext,
          executionInvocationId: context.operationId,
          command: inputs
            .map(({ filename }) => `/bin/cp ${quote(join(workspace, filename))} ${quote(filename)}`)
            .join(' && ')
        },
        signal
      )
      expect(result.exitCode).toBe(0)
      const run = (
        await h.fixture.notebookRepository.readSessionRuns(scope.projectId, scope.sessionId)
      ).find((item) => item.submissionIdentity === context.operationId)!
      expect(run.status).toBe('completed')
      await context.recordRun(run.runId)
      for (const { filename } of inputs)
        await context.saveOutput({
          filename,
          producerRunId: run.runId,
          contentType: filename.endsWith('.json') ? 'application/json' : 'application/octet-stream',
          source: { kind: 'localPath', path: filename }
        })
      return { text: 'Fixed materials published; scientific trials performed: zero.' }
    }
  })
  const done = await h.owner.wait({ ...scope, requestId: 'publish-reviewed-materials' })
  expect(done, JSON.stringify(done)).toMatchObject({ status: 'completed' })
  await h.snapshots.captureFinalizedMessages((await h.read(scope))!)
  const api = await client(h, transfer(packageService(h)))
  const path = join(output, 'research.science')
  await api.packages.export({ ...scope, filePath: path })
  return path
}

it.skipIf(process.platform !== 'darwin' || !materialsRoot || !evidenceRoot)(
  'imports reviewed real research through the SDK and executes the same material plan through all three entries in the native sandbox',
  async () => {
    const root = await realpath(materialsRoot!)
    const output = resolve(evidenceRoot!)
    await mkdir(output, { recursive: false })
    const acceptance = JSON.parse(
      await readFile(join(root, 'acceptance.json'), 'utf8')
    ) as Acceptance
    const expectedPlanScope = acceptance.planScope ?? 'engineering-check'
    expect([
      'end-to-end',
      'downstream-only',
      'alternative-conditions',
      'engineering-check'
    ]).toContain(expectedPlanScope)
    const archive = await publishMaterials(root, output, acceptance)
    const evidence: unknown[] = []
    const sourcePackageSha256 = sha(await readFile(archive))
    const writeEvidence = async (status: 'passed' | 'in-progress'): Promise<void> => {
      await writeFile(
        join(output, 'acceptance-results.json'),
        JSON.stringify(
          {
            status,
            title: acceptance.title,
            planKey: acceptance.planKey,
            planScope: expectedPlanScope,
            sourcePackageSha256,
            entries: evidence
          },
          null,
          2
        )
      )
    }
    for (const entry of ['external', 'ordinary', 'fork'] as const) {
      const cleanupStart = cleanups.length
      try {
        const h = await createSessionOperationTestHarness(cleanups, {
          canonicalStorageRoot: true,
          nativeSandbox: true
        })
        await h.notebook.recoverInterruptedOperations()
        const packages = packageService(h)
        const versions = new ManagedFileVersionService({
          storageRoot: h.fixture.storageRoot,
          getClient: async () => h.fixture.client
        })
        const inputAuthority = new ImmutableInputAuthority({
          storageRoot: h.fixture.storageRoot,
          managedFileVersions: versions
        })
        const catalog = new ManagedFileIndexRepository(
          async () => h.fixture.client,
          h.fixture.storageRoot,
          versions,
          new UploadRepository(h.fixture.storageRoot, { getClient: async () => h.fixture.client })
        )
        const runtimes = createManagedResearchNodeRuntimeRegistry({
          trustedCandidates: [process.execPath]
        })
        const environments = new ManagedResearchEnvironmentOwner({
          dataRoot: h.fixture.storageRoot,
          socketRoot: '/private/tmp',
          verifyRuntime: (runtime) => runtimes.verify(runtime),
          stopExecution: async (identity) => ({
            verified: (await h.notebook.confirmManagedShellCleanup(identity, { retry: true }))
              .reaped
          })
        })
        cleanups.push(() => environments.close())
        const service = new ManagedExecutionService({
          artifacts: h.artifacts,
          dataRoot: h.fixture.storageRoot,
          notebooks: h.fixture.notebookRepository,
          environments,
          operations: h.owner,
          runtime: h.notebook,
          runtimes,
          materials: (request) =>
            createResearchMaterialAuthority(
              {
                catalog,
                inputAuthority,
                readSession: (projectId, sessionId) => h.read({ projectId, sessionId }),
                readOrigin: (request) => packages.readOrigin(request)
              },
              request
            ),
          resolvePreparedInputs: (receipt) =>
            Promise.all(
              (receipt.prepared?.inputs ?? []).map((input) =>
                resolvePreparedResearchMaterialInput(
                  { catalog, inputAuthority },
                  {
                    projectId: receipt.projectId,
                    versionId: input.versionId,
                    sha256: input.sha256,
                    sizeBytes: input.sizeBytes
                  }
                )
              )
            ),
          createSession: async () => {
            throw new Error('Acceptance uses existing ordinary or actual fork Sessions.')
          },
          withWritableSession: async (_scope, operation) => operation()
        })
        const api = await client(h, transfer(packages), service)
        const preview = await api.packages.preflightImport({
          filePath: archive,
          target: { projectId: scope.projectId }
        })
        const importedResult = await api.packages.commitImport({
          preflightId: preview.preflightId
        })
        expect(importedResult.cleanupPending).not.toBe(true)
        const imported: SessionPackageRequest = {
          projectId: importedResult.projectId,
          sessionId: importedResult.sessionId
        }
        const sourceBefore = JSON.stringify(await h.read(imported))
        const target = entry === 'fork' ? await packages.fork(imported) : scope
        expect((await h.read(target))?.packageOrigin).toBeUndefined()
        if (entry === 'fork') expect((await h.read(target))?.forkOrigin).toBeDefined()
        const inspected = (await api.execution.inspectMaterials({
          ...target,
          sourceSessionId: imported.sessionId
        })) as ResearchMaterialInspection
        expect(inspected.status).toBe('ready')
        const plan = inspected.description!.plans.find((item) => item.key === acceptance.planKey)!
        expect(plan.scope).toBe(expectedPlanScope)
        const available = await api.execution.runtimes()
        const prepared = await api.execution.prepare({
          ...target,
          requestId: 'prepare-research',
          sourceSessionId: imported.sessionId,
          sourceIdentity: inspected.source.identity,
          runtimeId: available.runtimes[0].runtimeId,
          materials: {
            descriptorVersionId: inspected.descriptor!.versionId,
            materialKeys: plan.materialKeys
          }
        })
        const request = {
          ...target,
          requestId: 'run-research',
          environmentId: prepared.environmentId,
          command: acceptance.command,
          timeoutMs: acceptance.timeoutMs,
          localServicePort: acceptance.localServicePort,
          outputs: acceptance.outputs,
          description: `Execute the ${acceptance.title} plan in Open Science with scope ${expectedPlanScope}.`
        }
        const previousRuns = new Set(
          (
            await h.fixture.notebookRepository.readSessionRuns(target.projectId, target.sessionId)
          ).map((run) => run.runId)
        )
        let nativeRunId: string | undefined
        if (entry === 'external') {
          await api.execution.execute(request)
        } else {
          await h.owner.start({
            ...target,
            requestId: request.requestId,
            requestFingerprint: sha(JSON.stringify(request)),
            requestText: request.description,
            execute: async (context, signal) => {
              const handle = h.artifactTurns.handleForExecution(context.operationId)
              const port = createManagedExecutionTurnPort({
                dataRoot: h.fixture.storageRoot,
                service,
                artifacts: h.artifacts,
                notebooks: h.fixture.notebookRepository,
                trackArtifactWrite: (_sessionId, _executionId, write) =>
                  h.artifactTurns.trackWrite(handle, write)
              })
              const result = await port.call('execute', request, {
                ...target,
                ownerExecutionId: context.operationId,
                artifactRunId: h.artifactTurns.snapshot(handle).runId,
                artifactStorageSessionId: target.sessionId,
                workspaceCwd: context.workspaceCwd,
                invocationId: 'research-execution-call',
                provenanceContext: context.provenanceContext as ManagedExecutionProvenance,
                signal,
                assertActive: () => signal.throwIfAborted()
              })
              expect(result).toMatchObject({ status: 'completed' })
              nativeRunId = (result as { runId: string }).runId
              expect(typeof nativeRunId).toBe('string')
              return { text: 'Declared research task completed in the existing turn.' }
            }
          })
        }
        const done = await api.execution.waitOperation({
          ...target,
          requestId: request.requestId,
          timeoutMs: 60000
        })
        // Retain failure diagnostics before assertions, without exposing auth tokens or private input.
        await writeFile(join(output, `${entry}-operation.json`), JSON.stringify(done, null, 2), {
          flag: 'wx'
        })
        const current = (await h.read(target))!
        const runs = (
          await h.fixture.notebookRepository.readSessionRuns(target.projectId, target.sessionId)
        ).filter((run) => !previousRuns.has(run.runId))
        await writeFile(
          join(output, `${entry}-notebook-runs.json`),
          JSON.stringify(
            runs.map((run) => ({
              runId: run.runId,
              status: run.status,
              exitCode: run.exitCode,
              text: run.text,
              shellErrorCode: run.shellErrorCode,
              interruptionReason: run.interruptionReason,
              promptMessageId: run.promptMessageId,
              submissionIdentity: run.submissionIdentity
            })),
            null,
            2
          ),
          { flag: 'wx' }
        )
        const resultRoot = join(output, entry)
        await mkdir(resultRoot)
        for (const selection of acceptance.outputs ?? []) {
          const artifact = current.artifacts?.find((item) => item.name === selection.filename)
          if (artifact) await copyFile(artifact.path, join(resultRoot, selection.filename))
        }
        expect(done, JSON.stringify(done)).toMatchObject({ status: 'completed' })
        if (!done) throw new Error('The admitted research operation disappeared.')
        // The native port borrows a current turn; it does not write an external-operation ledger.
        // Both entries must instead prove their actual new Notebook Run and output provenance.
        expect(runs).toHaveLength(1)
        const run = runs[0]
        expect(run.status).toBe('completed')
        if (entry === 'external') expect(done.notebookRunIds).toEqual([run.runId])
        else expect(nativeRunId).toBe(run.runId)
        for (const assertion of acceptance.expect.jsonAssertions) {
          let actual: unknown = JSON.parse(await readFile(join(resultRoot, assertion.path), 'utf8'))
          for (const part of assertion.pointer.split('/').slice(1))
            actual = (actual as Record<string, unknown>)[
              part.replaceAll('~1', '/').replaceAll('~0', '~')
            ]
          expect(actual, `${entry}: ${assertion.path}${assertion.pointer}`).toEqual(
            assertion.equals
          )
        }
        expect(JSON.stringify(await h.read(imported))).toBe(sourceBefore)
        expect(h.kernelExecute).not.toHaveBeenCalled()
        await h.snapshots.captureFinalizedMessages(current)
        const resultArchive = join(output, `${entry}-results.science`)
        await api.packages.export({ ...target, filePath: resultArchive })
        const roundtripPreview = await api.packages.preflightImport({
          filePath: resultArchive,
          target: { projectId: scope.projectId }
        })
        const roundtrip = await api.packages.commitImport({
          preflightId: roundtripPreview.preflightId
        })
        expect(roundtrip.cleanupPending).not.toBe(true)
        const origin = await packages.readOrigin({
          projectId: roundtrip.projectId,
          sessionId: roundtrip.sessionId
        })
        for (const selection of acceptance.outputs ?? []) {
          const artifact = current.artifacts?.find((item) => item.name === selection.filename)
          if (!artifact?.versionId) continue
          const mapped = await h.fixture.client.artifactVersion.findUniqueOrThrow({
            where: { id: origin.identities[artifact.versionId] }
          })
          expect(await readFile(join(h.fixture.storageRoot, mapped.contentStorageKey))).toEqual(
            await readFile(artifact.path)
          )
          expect(mapped.producerRunId).toBe(origin.identities[run.runId])
        }
        await api.execution.releaseEnvironment({ ...target, environmentId: prepared.environmentId })
        // Published Artifact versions survive removal of the mutable output/environment directories.
        for (const artifact of current.artifacts ?? []) await readFile(artifact.path)
        evidence.push({
          entry,
          sourceIdentity: inspected.source.identity,
          operation: done,
          notebookRunId: run.runId,
          packageSha256: sha(await readFile(resultArchive)),
          outputCount: current.artifacts?.length
        })
        await writeEvidence('in-progress')
      } finally {
        // Native policy has one process owner. End this isolated application before starting the
        // next entry, including when an assertion or package transfer fails.
        await disposeCleanups(cleanupStart)
      }
    }
    await disposeCleanups()
    await writeEvidence('passed')
  },
  240_000
)
