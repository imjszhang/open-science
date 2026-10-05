import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import {
  createManagedSessionRequestSchema,
  type CreateManagedSessionRequest
} from '../../shared/managed-execution'
import {
  DurableJsonRecoveryBarrierError,
  readDurableJsonFile,
  writeDurableJsonFile
} from '../storage/durable-json-file'
import {
  createLocalSessionWorkflow,
  type LocalSessionCreationDependencies
} from './create-local-session'

const receiptSchema = createManagedSessionRequestSchema
  .extend({
    schemaVersion: z.literal(1),
    requestKey: z.string().regex(/^[a-f0-9]{64}$/),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    sessionId: z.string().uuid(),
    state: z.enum(['creating', 'ready'])
  })
  .strict()
const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Retry-safe creation of an ordinary Session, including an uncertain publication response. */
export function createManagedSessionWorkflow(
  dependencies: LocalSessionCreationDependencies & { dataRoot: string }
): {
  create(request: CreateManagedSessionRequest): Promise<{ projectId: string; sessionId: string }>
} {
  const pending = new Map<string, Promise<unknown>>()
  return {
    async create(value) {
      const request = createManagedSessionRequestSchema.parse(value)
      const requestKey = hash([request.projectId, request.requestId])
      const previous = pending.get(requestKey) ?? Promise.resolve()
      const completion = previous
        .catch(() => undefined)
        .then(async () => {
          const fingerprint = hash(request)
          const path = join(dependencies.dataRoot, 'managed-session-requests', requestKey + '.json')
          const read = await readDurableJsonFile(
            path,
            (text) => {
              const receipt = receiptSchema.parse(JSON.parse(text))
              if (
                receipt.requestKey !== requestKey ||
                hash([receipt.projectId, receipt.requestId]) !== requestKey
              )
                throw new DurableJsonRecoveryBarrierError(
                  'Invalid managed Session creation receipt.'
                )
              return receipt
            },
            {},
            { maxBytes: 16384 }
          )
          if (read.status === 'found') {
            if (read.value.fingerprint !== fingerprint)
              throw new Error('Session creation requestId conflicts with its earlier contents.')
            const session = await dependencies.sessions.readSessionSnapshot(
              request.projectId,
              read.value.sessionId
            )
            if (!session)
              throw new Error(
                'Session creation is interrupted or its Session was deleted. Inspect the Project before using a new requestId.'
              )
            if (session.projectId !== request.projectId)
              throw new Error('Session creation receipt scope mismatch.')
            return { projectId: request.projectId, sessionId: session.id }
          }
          const sessionId = randomUUID()
          const receipt = receiptSchema.parse({
            ...request,
            schemaVersion: 1,
            requestKey,
            fingerprint,
            sessionId,
            state: 'creating'
          })
          await writeDurableJsonFile(path, JSON.stringify(receipt))
          const session = await createLocalSessionWorkflow({
            ...dependencies,
            createId: () => sessionId
          }).create({ projectId: request.projectId, title: request.title })
          await writeDurableJsonFile(path, JSON.stringify({ ...receipt, state: 'ready' }))
          return { projectId: session.projectId, sessionId: session.id }
        })
      pending.set(requestKey, completion)
      try {
        return await completion
      } finally {
        if (pending.get(requestKey) === completion) pending.delete(requestKey)
      }
    }
  }
}
