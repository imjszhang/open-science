import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { ArtifactVersionFile } from '../../shared/artifact-provenance'
import type { ExecuteManagedEnvironmentRequest } from '../../shared/managed-execution'
import {
  ManagedExecutionService,
  type ManagedExecutionServiceDependencies,
  type ManagedExecutionTurnContext
} from './managed-execution-service'
import {
  ManagedResearchEnvironmentOwner,
  ManagedEnvironmentCancelledError,
  type ManagedResearchRuntime
} from './managed-research-environment'
import { resolveManagedShellExecutionCapability } from './managed-shell-execution'
import { resolveManagedOutputAuthority } from './managed-output-authority'
import type { ResearchMaterialAuthority } from './research-materials'
import { createManagedExecutionTurnPort } from './managed-execution-port'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const scope = { projectId: 'project', sessionId: 'receiver' }
const sha = (value: string): string => createHash('sha256').update(value).digest('hex')
const provenance = {
  rootFrameId: 'root',
  agentFrameId: 'root',
  messageBranchId: 'branch',
  runtimeSegmentId: 'segment',
  promptMessageId: 'prompt'
}
const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function setup(): Promise<{
  root: string
  service: ManagedExecutionService
  dependencies: ManagedExecutionServiceDependencies
  environments: ManagedResearchEnvironmentOwner
  context: ManagedExecutionTurnContext
  request: ExecuteManagedEnvironmentRequest
  runtime: ManagedExecutionServiceDependencies['runtime']
  published: Array<{ filename: string; content: string; producerRunId?: string }>
}> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'managed-core-')))
  roots.push(root)
  await mkdir(join(root, 'workspace'))
  const node: ManagedResearchRuntime = {
    kind: 'node',
    executable: join(root, 'node'),
    version: '24.1.0',
    sha256: sha('node'),
    platform: process.platform as 'darwin' | 'linux' | 'win32',
    arch: process.arch,
    readOnlyRoots: [join(root, 'runtime')]
  }
  const runtime: ManagedExecutionServiceDependencies['runtime'] = {
    executeManagedShell: vi.fn(async (request, capability) => {
      const policy = resolveManagedShellExecutionCapability(capability, {
        ...scope,
        executionInvocationId: request.executionInvocationId!
      })
      await writeFile(
        join(policy.environment.OPEN_SCIENCE_OUTPUT_DIR, 'result.json'),
        '{"value":42}'
      )
      return { stdout: '42', stderr: '', exitCode: 0 }
    }),
    confirmManagedShellCleanup: vi.fn<
      ManagedExecutionServiceDependencies['runtime']['confirmManagedShellCleanup']
    >(async (request) => ({
      scope: request,
      state: 'verified',
      reaped: true,
      runId: 'notebook-run',
      proof: 'process-owner'
    }))
  }
  const environments = new ManagedResearchEnvironmentOwner({
    dataRoot: root,
    socketRoot: await realpath(tmpdir()),
    verifyRuntime: async () => undefined,
    stopExecution: async (request) => ({
      verified: (await runtime.confirmManagedShellCleanup(request, { retry: true })).reaped
    })
  })
  const content = 'export const input = 42'
  const materials: ResearchMaterialAuthority = {
    source: { projectId: scope.projectId, sessionId: 'source', identity: 'source-checksum' },
    versions: [
      {
        versionId: 'version-1',
        sourceIdentity: 'source-checksum',
        filename: 'input.mjs',
        sha256: sha(content),
        sizeBytes: Buffer.byteLength(content)
      }
    ],
    readVersion: async () => Buffer.from(content)
  }
  const dependencies: ManagedExecutionServiceDependencies = {
    dataRoot: root,
    environments,
    runtime,
    runtimes: {
      discover: async () => ({
        runtimes: [{ runtimeId: sha('runtime'), runtime: node }],
        unavailable: [{ candidate: '/private/node', reason: 'private' }]
      }),
      resolve: vi.fn(async () => node)
    },
    materials: vi.fn(async () => materials),
    resolvePreparedInputs: vi.fn(async () => []),
    createSession: vi.fn(async (request) => ({
      projectId: request.projectId,
      sessionId: 'created'
    })),
    withWritableSession: vi.fn(async (_scope, operation) => operation()),
    operations: { start: vi.fn(), get: vi.fn(), cancel: vi.fn(), wait: vi.fn() }
  }
  const service = new ManagedExecutionService(dependencies)
  const prepared = (await service.prepare({
    ...scope,
    requestId: 'prepare',
    sourceSessionId: 'source',
    sourceIdentity: 'source-checksum',
    runtimeId: sha('runtime'),
    materials: { files: [{ versionId: 'version-1', restorePath: 'input.mjs' }] }
  })) as { environmentId: string }
  const published: Array<{ filename: string; content: string; producerRunId?: string }> = []
  const context: ManagedExecutionTurnContext = {
    ...scope,
    operationId: 'operation',
    workspaceCwd: join(root, 'workspace'),
    provenanceContext: { ...provenance },
    recordRun: vi.fn(async () => undefined),
    saveOutput: vi.fn(async (output) => {
      if (output.source.kind === 'localPath')
        throw new Error('Service must use an output capability')
      const content =
        output.source.kind === 'inline'
          ? output.source.content
          : await readFile(
              (
                await resolveManagedOutputAuthority(
                  output.source.authority,
                  { ...scope, operationId: 'operation' },
                  output.source.path
                )
              ).path,
              'utf8'
            )
      published.push({ filename: output.filename, content, producerRunId: output.producerRunId })
      return { versionId: 'version-' + published.length } as ArtifactVersionFile
    })
  }
  return {
    root,
    service,
    dependencies,
    environments,
    context,
    runtime,
    published,
    request: {
      ...scope,
      environmentId: prepared.environmentId,
      requestId: 'run',
      command: 'fixture',
      outputs: [{ path: 'result.json', filename: 'result.json' }]
    }
  }
}

it('freezes parsed requests before asynchronous preparation and publishes only stopped-run output', async () => {
  const h = await setup()
  const gate = deferred()
  vi.mocked(h.dependencies.resolvePreparedInputs).mockImplementation(async () => {
    await gate.promise
    return []
  })
  const pending = h.service.executeInTurn(h.request, h.context)
  await vi.waitFor(() => expect(h.dependencies.resolvePreparedInputs).toHaveBeenCalledOnce())
  h.request.command = 'changed after admission'
  h.request.outputs![0].path = '../private'
  gate.resolve()
  const result = await pending
  expect(h.runtime.executeManagedShell).toHaveBeenCalledWith(
    expect.objectContaining({
      ...scope,
      command: 'fixture',
      rootExecutionId: 'operation',
      provenanceContext: provenance
    }),
    expect.any(Object),
    expect.any(AbortSignal),
    undefined
  )
  expect(result).toMatchObject({ runId: 'notebook-run', status: 'completed' })
  expect(h.context.recordRun).toHaveBeenCalledWith('notebook-run')
  expect(h.published[0]).toEqual({
    filename: 'result.json',
    content: '{"value":42}',
    producerRunId: 'notebook-run'
  })
  const receipt = JSON.parse(h.published[1].content)
  expect(receipt).toMatchObject({
    kind: 'managed-research-execution',
    transport: 'none',
    result: { runId: 'notebook-run' }
  })
  expect(receipt.runtime).not.toHaveProperty('executable')
  expect(receipt.runtime).not.toHaveProperty('readOnlyRoots')
})

it('snapshots trusted turn identities before awaits so mutation cannot relabel a Notebook Run', async () => {
  const h = await setup()
  const gate = deferred()
  vi.mocked(h.dependencies.resolvePreparedInputs).mockImplementation(async () => {
    await gate.promise
    return []
  })
  const context = {
    ...h.context,
    executionInvocationId: 'outer-control-run',
    provenanceContext: { ...h.context.provenanceContext }
  }
  const originalCwd = context.workspaceCwd
  const pending = h.service.executeInTurn(h.request, context)
  await vi.waitFor(() => expect(h.dependencies.resolvePreparedInputs).toHaveBeenCalledOnce())
  context.operationId = 'different-operation'
  context.executionInvocationId = 'different-control-run'
  context.workspaceCwd = join(h.root, 'other-workspace')
  context.provenanceContext.promptMessageId = 'different-prompt'
  gate.resolve()
  await pending
  expect(h.runtime.executeManagedShell).toHaveBeenCalledWith(
    expect.objectContaining({
      rootExecutionId: 'operation',
      workspaceCwd: originalCwd,
      provenanceContext: provenance
    }),
    expect.any(Object),
    expect.any(AbortSignal),
    { parentControlInvocationId: 'outer-control-run' }
  )
})

it('deduplicates concurrent and restarted calls and rejects different content without rerunning', async () => {
  const h = await setup()
  const gate = deferred()
  vi.mocked(h.runtime.executeManagedShell).mockImplementation(async (request, capability) => {
    await gate.promise
    const policy = resolveManagedShellExecutionCapability(capability, {
      ...scope,
      executionInvocationId: request.executionInvocationId!
    })
    await writeFile(join(policy.environment.OPEN_SCIENCE_OUTPUT_DIR, 'result.json'), '{"value":42}')
    return { stdout: '', stderr: '', exitCode: 0 }
  })
  const first = h.service.executeInTurn(h.request, h.context)
  const second = h.service.executeInTurn(h.request, h.context)
  await vi.waitFor(() => expect(h.runtime.executeManagedShell).toHaveBeenCalledOnce())
  await expect(
    h.service.executeInTurn({ ...h.request, command: 'different' }, h.context)
  ).rejects.toThrow('conflicts')
  gate.resolve()
  expect(await first).toEqual(await second)
  expect(
    await new ManagedExecutionService(h.dependencies).executeInTurn(h.request, h.context)
  ).toEqual(await first)
  expect(h.runtime.executeManagedShell).toHaveBeenCalledOnce()
  expect(h.published).toHaveLength(2)
})

it('does not replay a failed or interrupted command after restarting its service', async () => {
  const h = await setup()
  vi.mocked(h.runtime.executeManagedShell).mockRejectedValueOnce(
    new Error('response lost after launch')
  )
  await expect(h.service.executeInTurn(h.request, h.context)).rejects.toThrow('response lost')
  await expect(
    new ManagedExecutionService(h.dependencies).executeInTurn(h.request, h.context)
  ).rejects.toThrow('interrupted or failed')
  expect(h.runtime.executeManagedShell).toHaveBeenCalledOnce()
  expect(h.published).toEqual([])
})

it('preserves optional missing outputs but propagates unexpected collection failures', async () => {
  const h = await setup()
  h.request.outputs!.push({ path: 'optional.csv', filename: 'optional.csv', optional: true })
  expect(await h.service.executeInTurn(h.request, h.context)).toMatchObject({
    missingOptionalOutputs: ['optional.csv'],
    status: 'completed'
  })
  const second = await setup()
  vi.mocked(second.context.saveOutput).mockRejectedValueOnce(
    Object.assign(new Error('permission denied'), { code: 'EACCES' })
  )
  second.request.outputs![0].optional = true
  await expect(second.service.executeInTurn(second.request, second.context)).rejects.toThrow(
    'permission denied'
  )
})

it('collects partial outputs after process cancellation and reports a cancelled result', async () => {
  const h = await setup()
  const controller = new AbortController()
  vi.mocked(h.runtime.executeManagedShell).mockImplementationOnce(async (request, capability) => {
    const policy = resolveManagedShellExecutionCapability(capability, {
      ...scope,
      executionInvocationId: request.executionInvocationId!
    })
    await writeFile(
      join(policy.environment.OPEN_SCIENCE_OUTPUT_DIR, 'result.json'),
      '{"partial":true}'
    )
    controller.abort(new Error('cancelled'))
    return { stdout: '', stderr: '', exitCode: null, cancelled: true }
  })
  expect(await h.service.executeInTurn(h.request, h.context, controller.signal)).toMatchObject({
    status: 'cancelled',
    exitCode: null
  })
  expect(h.published[0].content).toBe('{"partial":true}')
  expect(JSON.parse(h.published[1].content).result.status).toBe('cancelled')
})

it('keeps resources and publishes nothing when process cleanup is unverified', async () => {
  const h = await setup()
  vi.mocked(h.runtime.confirmManagedShellCleanup).mockImplementation(async (scope) => ({
    scope,
    state: 'cleanup-pending',
    reaped: false,
    runId: 'notebook-run'
  }))
  await expect(h.service.executeInTurn(h.request, h.context)).rejects.toThrow('cleanup')
  expect(h.published).toEqual([])
  expect(h.context.recordRun).not.toHaveBeenCalled()
  expect(await h.environments.get(h.request)).toMatchObject({
    state: 'cleanup-pending',
    activeExecution: { executionInvocationId: expect.any(String) }
  })
  expect(
    await readFile(
      join(h.root, 'research-environments', h.request.environmentId, 'inputs/input.mjs'),
      'utf8'
    )
  ).toContain('42')
})

it('rejects a cleanup proof for another invocation before publishing outputs', async () => {
  const h = await setup()
  vi.mocked(h.runtime.confirmManagedShellCleanup).mockImplementation(async (scope) => ({
    scope: { ...scope, executionInvocationId: 'another-run' },
    state: 'verified',
    reaped: true,
    runId: 'foreign-run',
    proof: 'process-owner'
  }))
  await expect(h.service.executeInTurn(h.request, h.context)).rejects.toThrow(
    /proof|verified|belong/
  )
  expect(h.published).toEqual([])
  expect(h.context.recordRun).not.toHaveBeenCalled()
})

it('rejects forged path or permission inputs before dispatch and strips private runtime details', async () => {
  const h = await setup()
  for (const payload of [
    { ...h.request, cwd: '/private' },
    { ...h.request, status: 'cancelled' },
    { ...h.request, environment: { TOKEN: 'secret' } },
    { ...h.request, capability: {} },
    { ...h.request, outputs: [{ path: '../outside', filename: 'result' }] },
    { ...h.request, sessionId: 'foreign' }
  ])
    await expect(h.service.executeInTurn(payload, h.context)).rejects.toThrow()
  expect(h.runtime.executeManagedShell).not.toHaveBeenCalled()
  const discovery = await h.service.runtimes()
  expect(JSON.stringify(discovery)).not.toContain('/private')
  expect(discovery).toMatchObject({ available: true, runtimes: [{ kind: 'node' }] })
  expect(
    await h.service.getEnvironment({ ...scope, environmentId: h.request.environmentId })
  ).not.toHaveProperty('activeExecution')
})

it('explains absent or unsuitable runtimes without publishing private discovery details', async () => {
  const h = await setup()
  for (const code of [
    'node_not_found',
    'node_version_unsupported',
    'node_host_mismatch',
    'node_not_independent',
    'node_unusable',
    'unexpected-private-code'
  ]) {
    h.dependencies.runtimes.discover = async () => ({
      runtimes: [],
      unavailable: [
        { candidate: '/private/person/node', code, reason: 'private-token-from-probe' },
        { candidate: '/another/private/path', code, reason: 'private-token-from-probe' }
      ]
    })
    const result = await h.service.runtimes()
    expect(result).toMatchObject({
      available: false,
      runtimes: [],
      diagnostics: {
        issues: expect.arrayContaining([
          {
            code: code === 'unexpected-private-code' ? 'node_unusable' : code,
            message: expect.any(String),
            action: expect.any(String)
          }
        ])
      }
    })
    expect(
      result.diagnostics!.issues.filter((issue) => issue.code !== 'native_service_unsupported')
    ).toHaveLength(1)
    expect(JSON.stringify(result)).not.toMatch(
      /\/private\/|private-token|unexpected-private-code|"candidate"/
    )
  }
  h.dependencies.runtimes.discover = async () => ({ runtimes: [] })
  expect(await h.service.runtimes()).toMatchObject({
    available: false,
    diagnostics: {
      issues: expect.arrayContaining([expect.objectContaining({ code: 'node_not_found' })])
    }
  })
  expect(h.runtime.executeManagedShell).not.toHaveBeenCalled()
  expect(h.dependencies.operations.start).not.toHaveBeenCalled()
})

it('reports unsupported native services separately from available Node and preserves internal host diagnostics', async () => {
  const h = await setup()
  const port = createManagedExecutionTurnPort({
    dataRoot: h.root,
    service: h.service,
    trackArtifactWrite: async (_sessionId, _owner, write) => write({} as never),
    artifacts: { saveVersion: vi.fn() },
    notebooks: { readSessionDocuments: vi.fn() }
  })
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
  try {
    for (const platform of ['linux', 'win32', 'darwin']) {
      Object.defineProperty(process, 'platform', { ...descriptor, value: platform })
      const result = await h.service.runtimes()
      expect(result.available).toBe(true)
      expect(result.diagnostics).toEqual({
        nativeServiceSupported: platform === 'darwin',
        issues:
          platform === 'darwin'
            ? []
            : [
                {
                  code: 'native_service_unsupported',
                  message: expect.stringContaining('native macOS'),
                  action: expect.any(String)
                }
              ]
      })
      expect(
        await port.call(
          'runtimes',
          {},
          {
            ...scope,
            ownerExecutionId: 'operation',
            artifactRunId: 'artifact-run',
            artifactStorageSessionId: scope.sessionId,
            workspaceCwd: h.root,
            invocationId: 'invocation',
            provenanceContext: provenance,
            signal: new AbortController().signal,
            assertActive: () => undefined
          }
        )
      ).toEqual(result)
      expect(JSON.stringify(result)).not.toContain('/private')
    }
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
  expect(h.runtime.executeManagedShell).not.toHaveBeenCalled()
})

it('wait timeout returns current status without cancelling or resubmitting execution', async () => {
  const h = await setup()
  const gate = deferred()
  vi.mocked(h.dependencies.operations.wait).mockImplementation(async () => {
    await gate.promise
    return undefined
  })
  const snapshot = { status: 'running' } as Awaited<
    ReturnType<typeof h.dependencies.operations.get>
  >
  vi.mocked(h.dependencies.operations.get).mockResolvedValue(snapshot)
  const request = { ...scope, requestId: 'run', timeoutMs: 1 }
  expect(await h.service.waitOperation(request)).toEqual(snapshot)
  expect(h.dependencies.operations.cancel).not.toHaveBeenCalled()
  expect(h.runtime.executeManagedShell).not.toHaveBeenCalled()
  gate.resolve()
})

it('passes a typed pre-dispatch cancellation to the external owner without treating same-text failures as cancellation', async () => {
  const h = await setup()
  await h.service.execute(h.request)
  const admitted = vi.mocked(h.dependencies.operations.start).mock.calls[0][0]
  const context = { ...h.context, notebookDataDir: join(h.root, 'notebook') }
  const signal = new AbortController().signal
  const cancelled = new ManagedEnvironmentCancelledError()
  vi.spyOn(h.service, 'executeInTurn').mockRejectedValueOnce(cancelled)
  await expect(admitted.execute(context, signal)).resolves.toMatchObject({ status: 'cancelled' })
  expect(signal.aborted).toBe(false)
  const ordinaryFailure = new Error(cancelled.message)
  vi.mocked(h.service.executeInTurn).mockRejectedValueOnce(ordinaryFailure)
  await expect(admitted.execute(context, signal)).rejects.toBe(ordinaryFailure)
})
