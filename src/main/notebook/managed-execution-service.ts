import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import {
  createManagedSessionRequestSchema,
  executeManagedEnvironmentRequestSchema,
  inspectManagedMaterialsRequestSchema,
  managedEnvironmentReferenceSchema,
  managedOperationReferenceSchema,
  prepareManagedEnvironmentRequestSchema,
  type CreateManagedSessionRequest,
  type ManagedRuntimeDiagnosticCode,
  type ManagedRuntimeDiagnostics
} from '../../shared/managed-execution'
import type { NotebookRunInputFile } from '../../shared/notebook'
import {
  DurableJsonRecoveryBarrierError,
  readDurableJsonFile,
  writeDurableJsonFile
} from '../storage/durable-json-file'
import { inspectResearchMaterials, type ResearchMaterialAuthority } from './research-materials'
import {
  ManagedEnvironmentCancelledError,
  type ManagedResearchEnvironment,
  type ManagedResearchEnvironmentOwner,
  type ManagedResearchRuntime
} from './managed-research-environment'
import type { NotebookRuntimeService } from './runtime-service'
import type { SessionOperationContext, SessionOperationOwner } from './session-operation-owner'
import { resolveManagedOutputAuthority } from './managed-output-authority'

export type ManagedExecutionTurnContext = Pick<
  SessionOperationContext,
  | 'operationId'
  | 'projectId'
  | 'sessionId'
  | 'workspaceCwd'
  | 'provenanceContext'
  | 'recordRun'
  | 'saveOutput'
>
const resultSchema = z
  .object({
    executionInvocationId: z.string(),
    runId: z.string(),
    status: z.enum(['completed', 'failed', 'cancelled']),
    exitCode: z.number().int().nullable(),
    outputs: z.array(z.object({ filename: z.string(), versionId: z.string() }).strict()).max(101),
    missingOptionalOutputs: z.array(z.string()).max(100)
  })
  .strict()
export type ManagedExecutionResult = z.infer<typeof resultSchema>
const journalSchema = z
  .object({
    schemaVersion: z.literal(1),
    key: z.string().regex(/^[a-f0-9]{64}$/),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    projectId: z.string(),
    sessionId: z.string(),
    operationId: z.string(),
    requestId: z.string(),
    state: z.enum(['running', 'completed', 'failed']),
    result: resultSchema.optional()
  })
  .strict()
type Journal = z.infer<typeof journalSchema>

export type ManagedExecutionServiceDependencies = {
  dataRoot: string
  environments: Pick<
    ManagedResearchEnvironmentOwner,
    'prepare' | 'get' | 'release' | 'withExecution'
  >
  operations: Pick<SessionOperationOwner, 'start' | 'get' | 'wait' | 'cancel'>
  runtime: Pick<NotebookRuntimeService, 'executeManagedShell' | 'confirmManagedShellCleanup'>
  runtimes: {
    discover(): Promise<{
      runtimes: Array<{ runtimeId: string; runtime: ManagedResearchRuntime }>
      unavailable?: unknown[]
    }>
    resolve(runtimeId: string): Promise<ManagedResearchRuntime>
  }
  materials(request: {
    projectId: string
    sourceSessionId: string
    targetSessionId: string
    versionIds?: string[]
    expectedSourceIdentity?: string
    signal?: AbortSignal
  }): Promise<ResearchMaterialAuthority>
  // Resolve exact immutable Versions and recheck receipt hashes. Return honest turn-attached input
  // identities; restoration does not pretend that the runtime directly read an original archive.
  resolvePreparedInputs(receipt: ManagedResearchEnvironment): Promise<NotebookRunInputFile[]>
  createSession(
    request: CreateManagedSessionRequest
  ): Promise<{ projectId: string; sessionId: string }>
  withWritableSession<T>(
    scope: { projectId: string; sessionId: string },
    operation: () => Promise<T>
  ): Promise<T>
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const publicRuntime = (
  runtime: ManagedResearchRuntime
): Omit<ManagedResearchRuntime, 'executable' | 'readOnlyRoots'> => {
  const { executable, readOnlyRoots, ...publicValue } = runtime
  void executable
  void readOnlyRoots
  return publicValue
}
const runtimeDiagnosticGuidance: Record<
  ManagedRuntimeDiagnosticCode,
  { message: string; action: string }
> = {
  node_not_found: {
    message:
      'No compatible independent Node runtime was found in the application search locations.',
    action:
      'Make an existing Node 22 or newer installation visible to the application, then restart Open Science and check again.'
  },
  node_version_unsupported: {
    message: 'A discovered Node runtime is older than the required version 22.',
    action:
      'Make an existing Node 22 or newer installation visible to the application, then restart Open Science and check again.'
  },
  node_host_mismatch: {
    message: 'A discovered Node runtime does not match this machine’s platform or architecture.',
    action: 'Select an independent Node 22 or newer installation built for this machine.'
  },
  node_not_independent: {
    message: 'A discovered executable is Electron, not an independent Node runtime.',
    action:
      'Make an independent Node 22 or newer installation visible to the application; Electron cannot substitute for it.'
  },
  node_unusable: {
    message: 'A discovered Node candidate could not be verified or probed successfully.',
    action:
      'Check that an independent Node 22 or newer native binary is executable and works on this machine, then restart Open Science and check again.'
  },
  native_service_unsupported: {
    message: 'Managed local HTTP services currently require native macOS.',
    action:
      'Use a native macOS host for plans requiring a local service. A discovered Node runtime alone does not establish service support.'
  }
}
const publicRuntimeDiagnostics = (
  available: boolean,
  unavailable: readonly unknown[]
): ManagedRuntimeDiagnostics => {
  const codes = new Set<ManagedRuntimeDiagnosticCode>()
  if (!available) {
    for (const item of unavailable) {
      const code = item && typeof item === 'object' && 'code' in item ? item.code : undefined
      codes.add(
        typeof code === 'string' &&
          code !== 'native_service_unsupported' &&
          Object.hasOwn(runtimeDiagnosticGuidance, code)
          ? (code as ManagedRuntimeDiagnosticCode)
          : 'node_unusable'
      )
    }
    if (codes.size === 0) codes.add('node_not_found')
    // Missing conventional locations add no useful diagnosis when an actual candidate failed.
    if (codes.size > 1) codes.delete('node_not_found')
  }
  const nativeServiceSupported = process.platform === 'darwin'
  if (!nativeServiceSupported) codes.add('native_service_unsupported')
  return {
    nativeServiceSupported,
    issues: [...codes].map((code) => ({ code, ...runtimeDiagnosticGuidance[code] }))
  }
}
const publicEnvironment = (receipt: ManagedResearchEnvironment): unknown => ({
  environmentId: receipt.environmentId,
  projectId: receipt.projectId,
  sessionId: receipt.sessionId,
  source: receipt.source,
  state: receipt.state,
  runtime: publicRuntime(receipt.runtime),
  inputs: receipt.prepared?.inputs ?? [],
  error: receipt.error
})

/** Shared execution core. Internal tools supply their current turn; external calls admit one. */
export class ManagedExecutionService {
  private readonly active = new Map<
    string,
    { fingerprint: string; completion: Promise<ManagedExecutionResult> }
  >()

  constructor(private readonly dependencies: ManagedExecutionServiceDependencies) {}

  async runtimes(): Promise<{
    available: boolean
    runtimes: Array<ReturnType<typeof publicRuntime> & { runtimeId: string }>
    diagnostics?: ManagedRuntimeDiagnostics
  }> {
    const discovered = await this.dependencies.runtimes.discover()
    const available = discovered.runtimes.length > 0
    return {
      runtimes: discovered.runtimes.map(({ runtimeId, runtime }) => ({
        runtimeId,
        ...publicRuntime(runtime)
      })),
      available,
      diagnostics: publicRuntimeDiagnostics(available, discovered.unavailable ?? [])
    }
  }

  async createSession(value: unknown): Promise<{ projectId: string; sessionId: string }> {
    return this.dependencies.createSession(createManagedSessionRequestSchema.parse(value))
  }

  async inspectMaterials(value: unknown, signal?: AbortSignal): Promise<unknown> {
    const request = inspectManagedMaterialsRequestSchema.parse(value)
    return this.dependencies.withWritableSession(request, async () => {
      const authority = await this.dependencies.materials({
        projectId: request.projectId,
        sourceSessionId: request.sourceSessionId,
        targetSessionId: request.sessionId,
        versionIds: request.versionIds,
        expectedSourceIdentity: request.sourceIdentity,
        signal
      })
      return {
        ...(await inspectResearchMaterials(authority, {
          descriptorVersionId: request.descriptorVersionId,
          signal
        })),
        versions: authority.versions
      }
    })
  }

  async prepare(value: unknown, signal?: AbortSignal): Promise<unknown> {
    const request = prepareManagedEnvironmentRequestSchema.parse(value)
    return this.dependencies.withWritableSession(request, async () => {
      const authority = await this.dependencies.materials({
        projectId: request.projectId,
        sourceSessionId: request.sourceSessionId,
        targetSessionId: request.sessionId,
        versionIds: request.versionIds,
        expectedSourceIdentity: request.sourceIdentity,
        signal
      })
      const runtime = await this.dependencies.runtimes.resolve(request.runtimeId)
      return publicEnvironment(
        await this.dependencies.environments.prepare({
          projectId: request.projectId,
          sessionId: request.sessionId,
          requestId: request.requestId,
          authority,
          materials: request.materials,
          runtime,
          signal
        })
      )
    })
  }

  async getEnvironment(value: unknown): Promise<unknown> {
    return publicEnvironment(
      await this.dependencies.environments.get(managedEnvironmentReferenceSchema.parse(value))
    )
  }

  async releaseEnvironment(value: unknown): Promise<unknown> {
    return publicEnvironment(
      await this.dependencies.environments.release(managedEnvironmentReferenceSchema.parse(value))
    )
  }

  async execute(value: unknown): ReturnType<SessionOperationOwner['start']> {
    const request = executeManagedEnvironmentRequestSchema.parse(value)
    return this.dependencies.operations.start({
      projectId: request.projectId,
      sessionId: request.sessionId,
      requestId: request.requestId,
      requestFingerprint: digest(JSON.stringify(request)),
      requestText: request.description ?? 'Run the selected prepared research materials.',
      execute: async (context, signal) => {
        let result: ManagedExecutionResult
        try {
          result = await this.executeInTurn(request, context, signal)
        } catch (error) {
          if (!(error instanceof ManagedEnvironmentCancelledError)) throw error
          return { status: 'cancelled', text: error.message }
        }
        return {
          status: result.status,
          text:
            'Prepared execution ' +
            result.status +
            '. Notebook Run: ' +
            result.runId +
            '. Saved outputs: ' +
            result.outputs.length +
            '.'
        }
      }
    })
  }

  getOperation(value: unknown): ReturnType<SessionOperationOwner['get']> {
    return this.dependencies.operations.get(managedOperationReferenceSchema.parse(value))
  }

  cancelOperation(value: unknown): ReturnType<SessionOperationOwner['cancel']> {
    return this.dependencies.operations.cancel(managedOperationReferenceSchema.parse(value))
  }

  async waitOperation(value: unknown): ReturnType<SessionOperationOwner['get']> {
    const request = managedOperationReferenceSchema
      .extend({
        timeoutMs: z.number().int().min(1).max(60_000).default(30_000)
      })
      .parse(value)
    const scope = {
      projectId: request.projectId,
      sessionId: request.sessionId,
      requestId: request.requestId
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.dependencies.operations.wait(scope),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, request.timeoutMs)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
    return this.dependencies.operations.get(scope)
  }

  async executeInTurn(
    value: unknown,
    admittedContext: ManagedExecutionTurnContext,
    signal?: AbortSignal
  ): Promise<ManagedExecutionResult> {
    const request = executeManagedEnvironmentRequestSchema.parse(value)
    const context: ManagedExecutionTurnContext = Object.freeze({
      operationId: admittedContext.operationId,
      projectId: admittedContext.projectId,
      sessionId: admittedContext.sessionId,
      workspaceCwd: admittedContext.workspaceCwd,
      provenanceContext: Object.freeze({ ...admittedContext.provenanceContext }),
      recordRun: admittedContext.recordRun.bind(admittedContext),
      saveOutput: admittedContext.saveOutput.bind(admittedContext)
    })
    if (request.projectId !== context.projectId || request.sessionId !== context.sessionId) {
      throw new Error('Prepared execution does not belong to the admitted Session.')
    }
    if (
      !context.provenanceContext.rootFrameId ||
      context.provenanceContext.agentFrameId !== context.provenanceContext.rootFrameId
    )
      throw new Error('Prepared execution is currently available in the Main Agent context.')
    const key = digest(
      JSON.stringify([context.projectId, context.sessionId, context.operationId, request.requestId])
    )
    const fingerprint = digest(JSON.stringify(request))
    const existing = this.active.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new Error('Prepared execution request conflicts with its earlier contents.')
      return existing.completion
    }
    const completion = this.executeOnce(request, context, signal, key, fingerprint)
    this.active.set(key, { fingerprint, completion })
    try {
      return await completion
    } finally {
      if (this.active.get(key)?.completion === completion) this.active.delete(key)
    }
  }

  private async executeOnce(
    request: z.output<typeof executeManagedEnvironmentRequestSchema>,
    context: ManagedExecutionTurnContext,
    signal: AbortSignal | undefined,
    key: string,
    fingerprint: string
  ): Promise<ManagedExecutionResult> {
    const path = join(this.dependencies.dataRoot, 'managed-execution-requests', key + '.json')
    const existing = await readDurableJsonFile(
      path,
      (text) => {
        const parsed = journalSchema.safeParse(JSON.parse(text))
        if (!parsed.success || parsed.data.key !== key)
          throw new DurableJsonRecoveryBarrierError('Invalid managed execution request receipt.')
        return parsed.data
      },
      {},
      { maxBytes: 256 * 1024 }
    )
    if (existing.status === 'found') {
      if (existing.value.fingerprint !== fingerprint)
        throw new Error('Prepared execution request conflicts with its earlier contents.')
      if (existing.value.result) return existing.value.result
      // A crash can happen after command dispatch but before its reply. Never replay the command.
      throw new Error(
        'Prepared execution was interrupted or failed. Inspect its Notebook history before submitting a new request.'
      )
    }
    signal?.throwIfAborted()
    const journal: Journal = {
      schemaVersion: 1,
      key,
      fingerprint,
      projectId: request.projectId,
      sessionId: request.sessionId,
      operationId: context.operationId,
      requestId: request.requestId,
      state: 'running'
    }
    await writeDurableJsonFile(path, JSON.stringify(journal))
    try {
      const result = await this.dependencies.withWritableSession(request, () =>
        this.dependencies.environments.withExecution(
          {
            ...request,
            executionInvocationId: 'managed-' + key,
            signal
          },
          async (environment) => {
            const inputs = await this.dependencies.resolvePreparedInputs(environment.receipt)
            const executionInvocationId = 'managed-' + key
            const shell = await this.dependencies.runtime.executeManagedShell(
              {
                projectId: request.projectId,
                sessionId: request.sessionId,
                workspaceCwd: context.workspaceCwd,
                command: request.command,
                timeoutMs: request.timeoutMs,
                executionInvocationId,
                rootExecutionId: context.operationId,
                provenanceContext: context.provenanceContext,
                registeredInputFiles: inputs
              },
              environment.capability,
              environment.signal
            )
            const cleanup = await this.dependencies.runtime.confirmManagedShellCleanup(
              {
                projectId: request.projectId,
                sessionId: request.sessionId,
                executionInvocationId
              },
              { retry: true }
            )
            if (
              !cleanup.reaped ||
              !cleanup.runId ||
              cleanup.scope.projectId !== request.projectId ||
              cleanup.scope.sessionId !== request.sessionId ||
              cleanup.scope.executionInvocationId !== executionInvocationId
            ) {
              throw new Error('Prepared execution has no verified stopped Notebook Run.')
            }
            await context.recordRun(cleanup.runId)
            const authority = environment.createOutputAuthority(context.operationId)
            const outputs: ManagedExecutionResult['outputs'] = []
            const missingOptionalOutputs: string[] = []
            for (const output of request.outputs) {
              // An optional absent file is not a failed Artifact write. Check before admitting a
              // tracked write; once admitted, every publication failure must still fail the turn.
              if (output.optional) {
                try {
                  await resolveManagedOutputAuthority(
                    authority,
                    {
                      projectId: request.projectId,
                      sessionId: request.sessionId,
                      operationId: context.operationId
                    },
                    output.path
                  )
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                    missingOptionalOutputs.push(output.path)
                    continue
                  }
                  throw error
                }
              }
              const saved = await context.saveOutput({
                filename: output.filename,
                contentType: output.contentType,
                producerRunId: cleanup.runId,
                source: { kind: 'managedOutput', authority, path: output.path }
              })
              outputs.push({ filename: output.filename, versionId: saved.versionId })
            }
            const result: ManagedExecutionResult = {
              executionInvocationId,
              runId: cleanup.runId,
              status: shell.cancelled ? 'cancelled' : shell.exitCode === 0 ? 'completed' : 'failed',
              exitCode: shell.exitCode,
              outputs,
              missingOptionalOutputs
            }
            const receiptName = 'execution-' + cleanup.runId + '.json'
            const receipt = await context.saveOutput({
              filename: receiptName,
              contentType: 'application/json',
              // This is an application collection receipt, not an assertion of a sealed recipe.
              source: {
                kind: 'inline',
                content: JSON.stringify(
                  {
                    kind: 'managed-research-execution',
                    version: 1,
                    source: environment.receipt.source,
                    materials: environment.receipt.prepared?.inputs,
                    runtime: publicRuntime(environment.runtime),
                    environmentFingerprint: environment.receipt.fingerprint,
                    transport:
                      request.localServicePort === undefined ? 'none' : 'private-unix-socket',
                    result
                  },
                  null,
                  2
                )
              }
            })
            outputs.push({ filename: receiptName, versionId: receipt.versionId })
            return result
          }
        )
      )
      journal.state = 'completed'
      journal.result = resultSchema.parse(result)
      await writeDurableJsonFile(path, JSON.stringify(journal))
      return journal.result
    } catch (error) {
      journal.state = 'failed'
      await writeDurableJsonFile(path, JSON.stringify(journal))
      throw error
    }
  }
}
