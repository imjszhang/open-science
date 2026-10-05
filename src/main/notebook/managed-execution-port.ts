import { z } from 'zod'
import {
  executeManagedEnvironmentRequestSchema,
  inspectManagedMaterialsRequestSchema,
  managedEnvironmentReferenceSchema,
  prepareManagedEnvironmentRequestSchema,
  type ExecuteManagedEnvironmentRequest,
  type InspectManagedMaterialsRequest,
  type ManagedEnvironmentReference,
  type ManagedExecutionMethod,
  type PrepareManagedEnvironmentRequest
} from '../../shared/managed-execution'
import type { ArtifactTurnWriteScope } from '../acp/artifact-turn-owner'
import type { ArtifactProvenanceRepository } from '../artifacts/provenance-repository'
import type { NotebookRunRepository } from './repository'
import {
  createManagedExecutionOutputWriter,
  type ManagedExecutionProvenance
} from './managed-execution-output'
import type { ArtifactFile } from '../../shared/artifacts'
import type { SessionOperationContext } from './session-operation-owner'

export const managedExecutionProvenanceSchema = z.object({
  rootFrameId: z.string().min(1),
  agentFrameId: z.string().min(1),
  messageBranchId: z.string().min(1),
  runtimeSegmentId: z.string().min(1),
  promptMessageId: z.string().min(1)
})

export const managedExecutionCallSchema = z
  .object({
    method: z.enum([
      'runtimes',
      'inspectMaterials',
      'prepare',
      'execute',
      'getEnvironment',
      'releaseEnvironment'
    ]),
    payload: z.record(z.string(), z.unknown()).default({})
  })
  .strict()

export type ManagedExecutionTurnContext = Readonly<{
  projectId: string
  sessionId: string
  ownerExecutionId: string
  artifactRunId: string
  artifactStorageSessionId: string
  workspaceCwd: string
  invocationId: string
  provenanceContext: Readonly<ManagedExecutionProvenance>
  signal: AbortSignal
  assertActive(): void
}>
export type ManagedExecutionContext = Pick<
  SessionOperationContext,
  | 'operationId'
  | 'projectId'
  | 'sessionId'
  | 'workspaceCwd'
  | 'provenanceContext'
  | 'recordRun'
  | 'saveOutput'
> & {
  executionInvocationId: string
}
export type ManagedExecutionPort = {
  call(
    method: ManagedExecutionMethod,
    payload: unknown,
    context: ManagedExecutionTurnContext
  ): Promise<unknown>
}
type Service = {
  runtimes(): unknown | Promise<unknown>
  inspectMaterials(request: InspectManagedMaterialsRequest, signal?: AbortSignal): Promise<unknown>
  prepare(request: PrepareManagedEnvironmentRequest, signal?: AbortSignal): Promise<unknown>
  getEnvironment(request: ManagedEnvironmentReference): Promise<unknown>
  releaseEnvironment(request: ManagedEnvironmentReference): Promise<unknown>
  executeInTurn(
    request: ExecuteManagedEnvironmentRequest,
    context: ManagedExecutionContext,
    signal: AbortSignal
  ): Promise<unknown>
}

/** Adapts a current Agent turn to the same service used by externally admitted operations. */
export function createManagedExecutionTurnPort(dependencies: {
  dataRoot: string
  service: Service
  trackArtifactWrite<Result extends ArtifactFile>(
    sessionId: string,
    ownerExecutionId: string,
    write: (scope: ArtifactTurnWriteScope) => Promise<Result>
  ): Promise<Result>
  artifacts: Pick<ArtifactProvenanceRepository, 'saveVersion'>
  notebooks: Pick<NotebookRunRepository, 'readSessionDocuments'>
}): ManagedExecutionPort {
  return {
    async call(method, payload, turn) {
      turn.assertActive()
      const input = z.record(z.string(), z.unknown()).parse(payload ?? {})
      // Project and destination Session are always application-owned. Other fields remain subject
      // to the same strict application schemas as the external entry point.
      const request = { ...input, projectId: turn.projectId, sessionId: turn.sessionId }
      switch (method) {
        case 'runtimes':
          z.object({}).strict().parse(input)
          return dependencies.service.runtimes()
        case 'inspectMaterials':
          return dependencies.service.inspectMaterials(
            inspectManagedMaterialsRequestSchema.parse(request),
            turn.signal
          )
        case 'prepare':
          return dependencies.service.prepare(
            prepareManagedEnvironmentRequestSchema.parse(request),
            turn.signal
          )
        case 'getEnvironment':
          return dependencies.service.getEnvironment(
            managedEnvironmentReferenceSchema.parse(request)
          )
        case 'releaseEnvironment':
          return dependencies.service.releaseEnvironment(
            managedEnvironmentReferenceSchema.parse(request)
          )
      }
      const parsed = executeManagedEnvironmentRequestSchema.parse(request)
      const scope = {
        projectId: turn.projectId,
        sessionId: turn.sessionId,
        operationId: turn.ownerExecutionId,
        workspaceCwd: turn.workspaceCwd,
        artifactRunId: turn.artifactRunId,
        artifactStorageSessionId: turn.artifactStorageSessionId,
        writeNamespace: parsed.requestId,
        provenanceContext: turn.provenanceContext,
        messageAncestry: [turn.provenanceContext.promptMessageId]
      }
      const recorded = new Set<string>()
      const reader = createManagedExecutionOutputWriter(dependencies, scope, turn.signal)
      let accepting = true
      const pending = new Set<Promise<unknown>>()
      let outputFailed = false
      let outputError: unknown
      const track = <T>(operation: () => Promise<T>): Promise<T> => {
        if (!accepting) return Promise.reject(new Error('Managed execution call has settled.'))
        turn.assertActive()
        const promise = operation()
        pending.add(promise)
        void promise.then(
          () => pending.delete(promise),
          (error) => {
            pending.delete(promise)
            outputFailed = true
            outputError = error
          }
        )
        return promise
      }
      const context: ManagedExecutionContext = Object.freeze({
        operationId: turn.ownerExecutionId,
        projectId: turn.projectId,
        sessionId: turn.sessionId,
        executionInvocationId: turn.invocationId,
        workspaceCwd: turn.workspaceCwd,
        provenanceContext: turn.provenanceContext,
        recordRun: (runId) =>
          track(async () => {
            await reader.recordRun(runId)
            recorded.add(runId)
          }),
        saveOutput: (output) =>
          track(() =>
            dependencies.trackArtifactWrite(
              turn.sessionId,
              turn.ownerExecutionId,
              async (actual) => {
                turn.assertActive()
                if (
                  actual.executionId !== turn.ownerExecutionId ||
                  actual.projectId !== turn.projectId ||
                  actual.appSessionId !== turn.sessionId ||
                  actual.artifactStorageSessionId !== turn.artifactStorageSessionId ||
                  actual.artifactRunId !== turn.artifactRunId ||
                  Object.entries(turn.provenanceContext).some(
                    ([key, value]) => actual[key as keyof ManagedExecutionProvenance] !== value
                  )
                )
                  throw new Error('Managed output does not belong to the current Artifact turn.')
                const writer = createManagedExecutionOutputWriter(
                  dependencies,
                  { ...scope, messageAncestry: actual.messageAncestry },
                  turn.signal
                )
                if (output.producerRunId) {
                  if (!recorded.has(output.producerRunId))
                    throw new Error('Managed output requires a recorded Notebook Run.')
                  await writer.recordRun(output.producerRunId)
                }
                return writer.saveOutput(output)
              }
            )
          )
      })
      let result: unknown
      let executionError: unknown
      let executionFailed = false
      try {
        result = await dependencies.service.executeInTurn(parsed, context, turn.signal)
      } catch (error) {
        executionFailed = true
        executionError = error
      } finally {
        accepting = false
        await Promise.allSettled([...pending])
      }
      if (executionFailed) throw executionError
      if (outputFailed) throw outputError
      return result
    }
  }
}
