import { z } from 'zod'
import {
  validateRunObservationArchive,
  type RunObservationArchive
} from './run-observation-archive'

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/)
/** Receiving Artifact identity, never an author-machine Run or service locator. */
export const recordedObservationTargetSchema = z
  .object({ projectId: id, sessionId: id, artifactId: id, versionId: id })
  .strict()
export type RecordedObservationTarget = z.infer<typeof recordedObservationTargetSchema>
export type RecordedObservationReceivingScope = RecordedObservationTarget
export const resolvedObservationMediaSchema = z
  .object({
    mediaKey: id,
    artifactId: id,
    versionId: id,
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  })
  .strict()
export type ResolvedObservationMedia = z.infer<typeof resolvedObservationMediaSchema>
export type RecordedObservationPayload = Readonly<{
  receiving: RecordedObservationTarget
  archive: RunObservationArchive
  media: readonly ResolvedObservationMedia[]
}>
export type RecordedRunObservationSelection = Readonly<{
  kind: 'recorded-run-observation'
  /** Present on a server-captured selection; identifies each explicit Ask action. */
  selectionId?: string
  selectedAt?: number
  recordingId: string
  receiving: RecordedObservationTarget
  stepKey: string
  record: RunObservationArchive['records'][number]
  mediaKeys: readonly string[]
}>

export const recordedObservationPayloadSchema = z
  .object({
    receiving: recordedObservationTargetSchema,
    archive: z.unknown().transform((value, context) => {
      try {
        return validateRunObservationArchive(value)
      } catch {
        context.addIssue({ code: 'custom', message: 'Invalid recorded observation archive.' })
        return z.NEVER
      }
    }),
    media: z.array(resolvedObservationMediaSchema).max(2000)
  })
  .strict()
