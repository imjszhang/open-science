import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ArtifactTurnOwner } from '../acp/artifact-turn-owner'
import { createProvenanceTestFixture } from '../artifacts/provenance-test-fixtures'
import { ArtifactRunRegistry } from '../artifacts/run-registry'
import { createNotebookArtifactSourceScopeProvider } from './artifact-source-scope'
import { createRootNotebookLane } from './lane-identity'
import {
  createManagedExecutionTurnPort,
  type ManagedExecutionPort,
  type ManagedExecutionTurnContext
} from './managed-execution-port'
import { NotebookLocalRpcServer } from './local-rpc-server'

vi.mock('electron', () => ({
  app: { getPath: () => '/home/user', isPackaged: true },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openPath: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() }
}))

const servers: NotebookLocalRpcServer[] = []
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  try {
    for (const server of servers.splice(0)) await server.close()
  } finally {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  }
})
const provenance = {
  rootFrameId: 'root-frame-session',
  agentFrameId: 'root-frame-session',
  messageBranchId: 'branch',
  runtimeSegmentId: 'segment',
  promptMessageId: 'prompt'
}
const invocation = {
  rootExecutionId: 'execution',
  turnId: 'prompt',
  toolInvocationId: 'tool-call',
  controlInvocationGeneration: 1
}
const binding = {
  projectId: 'project',
  ownerExecutionId: 'execution',
  artifactRunId: 'artifact-run',
  artifactStorageSessionId: 'artifact-storage-route',
  provenanceContext: provenance
}
type Connection = { endpoint: string; token: string }
const send = async (
  connection: Connection,
  params: unknown = { method: 'runtimes', payload: {} }
): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(connection.endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'managedExecutionCall', params })
  })
  return { status: response.status, body: await response.json() }
}
const serverFor = (call: ManagedExecutionPort['call']): NotebookLocalRpcServer => {
  const server = new NotebookLocalRpcServer({ execute: vi.fn() } as never, {
    transport: 'tcp',
    managedExecution: { call }
  })
  servers.push(server)
  return server
}

it.each(['ordinary', 'fork'])(
  'borrows the %s active turn, with frozen application identities',
  async (sessionId) => {
    let captured!: ManagedExecutionTurnContext
    const call = vi.fn(async (_method, _payload, context: ManagedExecutionTurnContext) => {
      captured = context
      return { status: 'ready' }
    })
    const server = serverFor(call)
    server.setArtifactTurnBinding(sessionId, binding)
    const connection = await server.issueControlConnection(
      sessionId,
      'project',
      provenance.agentFrameId,
      { role: 'main' },
      '/workspace'
    )
    const end = connection.beginControlInvocation(invocation)
    expect(
      await send(connection, {
        method: 'inspectMaterials',
        payload: { sourceSessionId: 'imported-research' }
      })
    ).toMatchObject({ status: 200 })
    expect(captured).toMatchObject({
      sessionId,
      projectId: 'project',
      ownerExecutionId: 'execution',
      artifactRunId: 'artifact-run',
      artifactStorageSessionId: 'artifact-storage-route',
      invocationId: 'tool-call',
      workspaceCwd: '/workspace',
      provenanceContext: provenance
    })
    expect(Object.isFrozen(captured)).toBe(true)
    expect(Object.isFrozen(captured.provenanceContext)).toBe(true)
    expect(call).toHaveBeenCalledTimes(1)
    end()
    expect(captured.signal.aborted).toBe(true)
    expect(() => captured.assertActive()).toThrow()
    connection.release()
  }
)

it('rejects bootstrap, ordinary agent tokens, absent turns and body-issued authority', async () => {
  const call = vi.fn(async () => ({}))
  const server = serverFor(call)
  const bootstrap = await server.ensureStarted()
  expect((await send(bootstrap)).status).toBe(401)
  const ordinary = await server.issueSessionConnection(
    'session',
    'project',
    provenance.agentFrameId
  )
  expect((await send(ordinary)).status).toBe(403)
  const connection = await server.issueControlConnection(
    'session',
    'project',
    provenance.agentFrameId,
    { role: 'main' },
    '/workspace'
  )
  expect((await send(connection)).status).toBe(403)
  server.setArtifactTurnBinding('session', binding)
  const end = connection.beginControlInvocation(invocation)
  expect(
    (await send(connection, { method: 'runtimes', payload: {}, provenanceContext: provenance }))
      .status
  ).toBe(400)
  expect((await send(connection, { method: 'unknown', payload: {} })).status).toBe(400)
  expect(call).not.toHaveBeenCalled()
  end()
  connection.release()
  ordinary.release?.()
})

it('revokes a replaced turn and waits for admitted managed work before clearing it', async () => {
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let captured!: ManagedExecutionTurnContext
  const server = serverFor(async (_method, _payload, context) => {
    captured = context
    entered()
    await gate
    context.assertActive()
    return {}
  })
  server.setArtifactTurnBinding('session', binding)
  const connection = await server.issueControlConnection(
    'session',
    'project',
    provenance.agentFrameId,
    { role: 'main' },
    '/workspace'
  )
  const end = connection.beginControlInvocation(invocation)
  const request = send(connection)
  await started
  let cleared = false
  const clearing = server.clearArtifactTurnBinding('session', 'execution').then(() => {
    cleared = true
  })
  await Promise.resolve()
  expect(cleared).toBe(false)
  expect(captured.signal.aborted).toBe(true)
  server.setArtifactTurnBinding('session', {
    ...binding,
    ownerExecutionId: 'next-execution',
    artifactRunId: 'next-run',
    provenanceContext: { ...provenance, promptMessageId: 'next-prompt' }
  })
  release()
  expect((await request).status).not.toBe(200)
  await clearing
  end()
  connection.release()
})

it('ends the old managed capability when a control invocation is replaced', async () => {
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const server = serverFor(async (_method, _payload, context) => {
    entered()
    await new Promise<void>((resolve) =>
      context.signal.addEventListener('abort', () => resolve(), { once: true })
    )
    context.assertActive()
    return {}
  })
  server.setArtifactTurnBinding('session', binding)
  const connection = await server.issueControlConnection(
    'session',
    'project',
    provenance.agentFrameId,
    { role: 'main' },
    '/workspace'
  )
  const firstEnd = connection.beginControlInvocation(invocation)
  const request = send(connection)
  await started
  const lastEnd = connection.beginControlInvocation({
    ...invocation,
    toolInvocationId: 'new-call',
    controlInvocationGeneration: 2
  })
  firstEnd()
  expect((await request).status).not.toBe(200)
  lastEnd()
  connection.release()
})

it('rejects delegated and background execution without invoking the managed service', async () => {
  const call = vi.fn(async () => ({}))
  const server = serverFor(call)
  server.setArtifactTurnBinding('session', binding)
  const delegate = await server.issueControlConnection(
    'session',
    'project',
    provenance.agentFrameId,
    { role: 'delegate', attemptId: 'attempt' },
    '/workspace'
  )
  const endDelegate = delegate.beginControlInvocation(invocation)
  expect((await send(delegate)).status).toBe(403)
  const main = await server.issueControlConnection(
    'session',
    'project',
    provenance.agentFrameId,
    { role: 'main' },
    '/workspace'
  )
  const endMain = main.beginControlInvocation({ ...invocation, executionMode: 'background' })
  const response = await send(main)
  expect(response.status).toBe(409)
  expect(response.body).toMatchObject({ error: { code: 'BACKGROUND_HOST_METHOD_UNSAFE' } })
  expect(call).not.toHaveBeenCalled()
  endMain()
  endDelegate()
  main.release()
  delegate.release()
})

const routedScope = {
  projectId: 'managed-project',
  sessionId: 'managed-app-session',
  artifactStorageSessionId: 'artifact-storage-route',
  ownerExecutionId: 'managed-owner-execution'
}
const routedProvenance = {
  ...provenance,
  rootFrameId: `root-frame-${routedScope.sessionId}`,
  agentFrameId: `root-frame-${routedScope.sessionId}`
}
const executePayload = (
  requestId: string
): { environmentId: string; requestId: string; command: string; outputs: [] } => ({
  environmentId: 'a'.repeat(64),
  requestId,
  command: 'fixture publishes one result',
  outputs: []
})

type ManagedTurnService = Parameters<typeof createManagedExecutionTurnPort>[0]['service']

async function createRoutedManagedTurnFixture(corruptStorageBinding = false): Promise<{
  fixture: Awaited<ReturnType<typeof createProvenanceTestFixture>>
  owner: ArtifactTurnOwner
  handle: Awaited<ReturnType<ArtifactTurnOwner['openRootExecution']>>
  connection: Awaited<ReturnType<NotebookLocalRpcServer['issueControlConnection']>>
  executeInTurn: ReturnType<typeof vi.fn<ManagedTurnService['executeInTurn']>>
  runId: string
}> {
  const fixture = await createProvenanceTestFixture()
  cleanups.push(fixture.dispose)
  const { projectId, sessionId, artifactStorageSessionId, ownerExecutionId } = routedScope
  await fixture.client.project.create({ data: { id: projectId, name: 'Managed turn routing' } })
  const workspaceCwd = join(fixture.storageRoot, 'workspace')
  await mkdir(workspaceCwd)
  const owner = new ArtifactTurnOwner({
    dataRoot: fixture.storageRoot,
    repository: fixture.compatibilityRepository,
    runRegistry: new ArtifactRunRegistry(),
    provenance: fixture.repository,
    notebookArtifactSourceScope: createNotebookArtifactSourceScopeProvider(fixture.storageRoot),
    notebook: {
      setArtifactTurnBinding: (appSessionId, emittedBinding) =>
        server.setArtifactTurnBinding(
          appSessionId,
          corruptStorageBinding
            ? { ...emittedBinding, artifactStorageSessionId: 'wrong-storage-route' }
            : emittedBinding
        ),
      clearArtifactTurnBinding: (appSessionId, executionId) =>
        server.clearArtifactTurnBinding(appSessionId, executionId)
    }
  })
  // Only the business execution is stubbed. Admission, owner binding, Run persistence,
  // output authorization and Artifact Version publication use their real implementations.
  const executeInTurn = vi.fn<ManagedTurnService['executeInTurn']>(
    async (request, context, signal) => {
      signal.throwIfAborted()
      const lane = createRootNotebookLane(
        context.projectId,
        context.sessionId,
        context.provenanceContext.agentFrameId
      )
      await fixture.notebookRepository.loadOrCreate({
        projectId: context.projectId,
        sessionId: context.sessionId,
        workspaceCwd: context.workspaceCwd,
        lane
      })
      const runId = `notebook-run-${request.requestId}`
      await fixture.notebookRepository.appendRun({
        projectId: context.projectId,
        sessionId: context.sessionId,
        lane,
        run: {
          runId,
          cellId: `cell-${request.requestId}`,
          source: 'agent',
          kernelKind: 'bash',
          script: request.command,
          status: 'completed',
          startedAt: 1,
          endedAt: 2,
          exitCode: 0,
          text: { stdout: 'value,42\n', stderr: '', traceback: '', plain: [] },
          outputs: [],
          workingFiles: [],
          inputFiles: [],
          ...context.provenanceContext
        }
      })
      await context.recordRun(runId)
      const artifact = await context.saveOutput({
        filename: `result-${request.requestId}.txt`,
        contentType: 'text/plain',
        source: { kind: 'inline', content: 'value,42\n' },
        producerRunId: runId
      })
      return { status: 'completed', runId, versionId: artifact.versionId }
    }
  )
  const unexpected = async (): Promise<never> => {
    throw new Error('Unexpected managed service method in routing fixture.')
  }
  const port = createManagedExecutionTurnPort({
    dataRoot: fixture.storageRoot,
    service: {
      runtimes: unexpected,
      inspectMaterials: unexpected,
      prepare: unexpected,
      getEnvironment: unexpected,
      releaseEnvironment: unexpected,
      executeInTurn
    },
    artifacts: fixture.repository,
    notebooks: fixture.notebookRepository,
    trackArtifactWrite: (appSessionId, executionId, write) => {
      expect(appSessionId).toBe(sessionId)
      const handle = owner.handleForExecution(executionId)
      if (!handle) return Promise.reject(new Error('Managed output requires its active turn.'))
      return owner.trackWrite(handle, write)
    }
  })
  const server = serverFor(port.call)
  const handle = await owner.openRootExecution({
    executionId: ownerExecutionId,
    projectId,
    appSessionId: sessionId,
    artifactStorageSessionId,
    workspaceCwd,
    agentName: 'Managed routing fixture',
    provenanceContext: routedProvenance
  })
  cleanups.push(() => owner.dispose(handle))
  const connection = await server.issueControlConnection(
    sessionId,
    projectId,
    routedProvenance.agentFrameId,
    { role: 'main' },
    workspaceCwd
  )
  const end = connection.beginControlInvocation({
    ...invocation,
    rootExecutionId: ownerExecutionId,
    turnId: routedProvenance.promptMessageId
  })
  cleanups.push(async () => {
    end()
    connection.release()
  })
  return { fixture, owner, handle, connection, executeInTurn, runId: owner.snapshot(handle).runId }
}

it('persists HTTP managed output through the real turn storage route and keeps app Session ownership', async () => {
  const { fixture, owner, handle, connection, executeInTurn, runId } =
    await createRoutedManagedTurnFixture()
  const { projectId, sessionId, artifactStorageSessionId } = routedScope
  expect(artifactStorageSessionId).not.toBe(sessionId)
  const response = await send(connection, { method: 'execute', payload: executePayload('valid') })
  expect(response).toMatchObject({
    status: 200,
    body: { result: { status: 'completed', runId: 'notebook-run-valid' } }
  })
  const versions = await fixture.client.artifactVersion.findMany({ include: { artifact: true } })
  expect(versions).toHaveLength(1)
  const version = versions[0]!
  expect(version).toMatchObject({
    artifactRunId: runId,
    notebookSessionId: sessionId,
    producerRunId: 'notebook-run-valid',
    ...routedProvenance,
    artifact: { projectId, sessionId }
  })
  expect(response.body).toMatchObject({ result: { versionId: version.id } })
  const pending = await fixture.compatibilityRepository.listPendingRunFiles({
    projectId,
    sessionId: artifactStorageSessionId,
    runId
  })
  expect(pending).toHaveLength(1)
  expect(await readFile(pending[0]!.path, 'utf8')).toBe('value,42\n')
  expect(
    await fixture.compatibilityRepository.listPendingRunFiles({ projectId, sessionId, runId })
  ).toHaveLength(0)
  expect(await fixture.notebookRepository.readSessionRuns(projectId, sessionId)).toHaveLength(1)
  expect(
    await fixture.notebookRepository.readSessionRuns(projectId, artifactStorageSessionId)
  ).toHaveLength(0)

  const forged = await send(connection, {
    method: 'execute',
    payload: { ...executePayload('forged'), artifactStorageSessionId: 'attacker-storage' }
  })
  expect(forged.status).not.toBe(200)
  expect(executeInTurn).toHaveBeenCalledTimes(1)
  expect(await fixture.client.artifactVersion.count()).toBe(1)

  expect(await owner.finalize(handle)).toMatchObject({
    appSessionId: sessionId,
    artifactStorageSessionId,
    runId,
    artifacts: [expect.objectContaining({ versionId: version.id })]
  })
  // Keep the control invocation open: closing the real turn alone must revoke admission.
  await owner.dispose(handle)
  expect(
    (await send(connection, { method: 'execute', payload: executePayload('after-turn') })).status
  ).toBe(403)
  expect(executeInTurn).toHaveBeenCalledTimes(1)
  expect(await fixture.client.artifactVersion.count()).toBe(1)
})

it('rejects a trusted RPC binding whose storage route differs from the actual Artifact owner', async () => {
  const { fixture, connection, executeInTurn, runId } = await createRoutedManagedTurnFixture(true)
  const response = await send(connection, {
    method: 'execute',
    payload: executePayload('mismatch')
  })
  expect(response.status).not.toBe(200)
  expect(response.body).toMatchObject({
    error: 'Managed output does not belong to the current Artifact turn.'
  })
  expect(executeInTurn).toHaveBeenCalledTimes(1)
  expect(await fixture.client.artifactVersion.count()).toBe(0)
  for (const sessionId of [routedScope.artifactStorageSessionId, 'wrong-storage-route']) {
    expect(
      await fixture.compatibilityRepository.listPendingRunFiles({
        projectId: routedScope.projectId,
        sessionId,
        runId
      })
    ).toHaveLength(0)
  }
})
