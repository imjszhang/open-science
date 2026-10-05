import { createHash } from 'node:crypto'
import {
  MAX_RUN_OBSERVATION_ARCHIVE_BYTES,
  parseRunObservationArchive,
  type RunObservationArchive
} from '../../shared/run-observation-archive'
import {
  recordedObservationTargetSchema,
  type RecordedObservationPayload,
  type RecordedObservationTarget,
  type ResolvedObservationMedia
} from '../../shared/run-observation-recorded'
import type { NotebookRunInputFile } from '../../shared/notebook'
import type { ImmutableInputAuthority } from '../immutable-input-authority'
import type { ArtifactProvenanceRepository } from '../artifacts/provenance-repository'
import type { ManagedFileIndexRepository } from '../project-files/repository'
import { resolveRunObservationMedia, verifyRunObservationMediaBytes } from './archive'

export type RecordedObservationReaderDependencies = {
  immutableInputAuthority: Pick<ImmutableInputAuthority, 'resolveVersion' | 'openContent'>
  projectFilesRepository: Pick<ManagedFileIndexRepository, 'readExportFiles'>
  /** Main-only bounded historical lookup. Metadata is not read authorization. */
  artifactProvenanceRepository?: Pick<
    ArtifactProvenanceRepository,
    'resolvePublishedSessionVersionsByContent'
  >
  authorizeScope(target: RecordedObservationTarget): Promise<void>
  /** Main-only retained import receipt; never supplied by archive content or a public request. */
  readSourceVersionMapping?(
    target: RecordedObservationTarget
  ): Promise<Readonly<Record<string, string>> | undefined>
}
export type RecordedObservationReader = {
  read(target: RecordedObservationTarget, signal?: AbortSignal): Promise<RecordedObservationPayload>
  readMedia(
    target: RecordedObservationTarget,
    mediaKey: string,
    signal?: AbortSignal
  ): Promise<{ body: Uint8Array; mimeType: string }>
}
export class RecordedObservationReadError extends Error {
  readonly name = 'RecordedObservationReadError'
  constructor(
    readonly code: 'unavailable' | 'invalid-archive' | 'media-unavailable' | 'unauthorized'
  ) {
    super(
      {
        unavailable: 'The recorded observation is unavailable.',
        'invalid-archive': 'The recorded observation archive is invalid.',
        'media-unavailable': 'The recorded media is unavailable.',
        unauthorized: 'The recorded observation authorization is unavailable.'
      }[code]
    )
  }
}
const MAX_MEDIA_BYTES = 16 * 1024 * 1024
const MAX_CANDIDATES = 10000
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const checksum = (body: Uint8Array): string => createHash('sha256').update(body).digest('hex')
const sameInput = (left: NotebookRunInputFile, right: NotebookRunInputFile): boolean =>
  (
    [
      'inputFileVersionId',
      'sourceKind',
      'sourceFileId',
      'sourceProjectId',
      'sourceSessionId',
      'checksum',
      'sizeBytes',
      'storageKey'
    ] as const
  ).every((key) => left[key] === right[key])

/** Reads ordinary, published Artifacts. It never creates Runs, restores packages or starts services. */
export function createRecordedObservationReader(
  dependencies: RecordedObservationReaderDependencies
): RecordedObservationReader {
  const guard = async (target: RecordedObservationTarget, signal?: AbortSignal): Promise<void> => {
    signal?.throwIfAborted()
    try {
      await dependencies.authorizeScope({ ...target })
    } catch {
      throw new RecordedObservationReadError('unauthorized')
    }
    signal?.throwIfAborted()
  }
  const resolve = async (target: RecordedObservationTarget): Promise<NotebookRunInputFile> => {
    // No producerScope: unpublished versions must never be promoted to read authority here.
    const input = await dependencies.immutableInputAuthority.resolveVersion({
      projectId: target.projectId,
      sourceKind: 'artifact-version',
      expectedSourceFileId: target.artifactId,
      inputFileVersionId: target.versionId
    })
    if (
      !input ||
      input.sourceKind !== 'artifact-version' ||
      input.inputFileVersionId !== target.versionId ||
      input.sourceFileId !== target.artifactId ||
      input.sourceProjectId !== target.projectId ||
      input.sourceSessionId !== target.sessionId ||
      !/^[a-f0-9]{64}$/.test(input.checksum) ||
      !Number.isSafeInteger(input.sizeBytes) ||
      input.sizeBytes < 0
    )
      throw new RecordedObservationReadError('unavailable')
    return input
  }
  const readVersion = async (
    target: RecordedObservationTarget,
    limit: number,
    signal?: AbortSignal
  ): Promise<Uint8Array> => {
    await guard(target, signal)
    const input = await resolve(target)
    if (input.sizeBytes > limit) throw new RecordedObservationReadError('unavailable')
    const lease = await dependencies.immutableInputAuthority.openContent(input)
    try {
      await guard(target, signal)
      const body = await lease.readRange(0, input.sizeBytes)
      if (body.byteLength !== input.sizeBytes || checksum(body) !== input.checksum)
        throw new RecordedObservationReadError('unavailable')
      await lease.verifyUnchanged()
      // Disk identity alone does not prove the Artifact stayed published or in this Session.
      if (!sameInput(input, await resolve(target)))
        throw new RecordedObservationReadError('unavailable')
      await guard(target, signal)
      return body
    } finally {
      await lease.close()
    }
  }
  const load = async (
    target: RecordedObservationTarget,
    signal?: AbortSignal
  ): Promise<RecordedObservationPayload> => {
    const bytes = await readVersion(target, MAX_RUN_OBSERVATION_ARCHIVE_BYTES, signal)
    let archive: RunObservationArchive
    try {
      archive = parseRunObservationArchive(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      throw new RecordedObservationReadError('invalid-archive')
    }
    const candidates = await dependencies.projectFilesRepository.readExportFiles({
      projectId: target.projectId,
      sessionId: target.sessionId
    })
    if (candidates.length > MAX_CANDIDATES) throw new RecordedObservationReadError('unavailable')
    // Defend against a stale or over-broad repository adapter; no path, sender ID, or filename
    // alone can select content, and ambiguous matches remain absent from the resolved media.
    const permitted = candidates
      .filter(
        (candidate) =>
          candidate.source === 'artifact' &&
          candidate.projectId === target.projectId &&
          candidate.sessionId === target.sessionId &&
          candidate.originSession?.state !== 'deleted' &&
          candidate.originSession?.state !== 'deleting' &&
          candidate.checksum &&
          /^[a-f0-9]{64}$/.test(candidate.checksum) &&
          Number.isSafeInteger(candidate.size) &&
          candidate.size >= 0 &&
          candidate.size <= MAX_MEDIA_BYTES
      )
      .map((candidate) => ({
        sourceFileId: candidate.sourceFileId,
        sourceVersionId: candidate.sourceVersionId,
        projectId: candidate.projectId,
        sessionId: candidate.sessionId,
        name: candidate.name,
        checksum: candidate.checksum!,
        size: candidate.size
      }))
    const mapping = await dependencies.readSourceVersionMapping?.({ ...target })
    const historical = dependencies.artifactProvenanceRepository
    if (historical) {
      const contents = [
        ...new Map(
          archive.media
            .filter((media) => media.sizeBytes <= MAX_MEDIA_BYTES)
            .map((media) => [
              `${media.checksum}:${media.sizeBytes}`,
              { checksum: media.checksum, sizeBytes: media.sizeBytes }
            ])
        ).values()
      ]
      // A second import remaps the first receiver's IDs, while archive bytes still contain the
      // original author's IDs. Only receiving content membership survives every import hop.
      for (let start = 0; start < contents.length; start += 100) {
        await guard(target, signal)
        const batch = contents.slice(start, start + 100)
        const descriptors = await historical.resolvePublishedSessionVersionsByContent({
          projectId: target.projectId,
          appSessionId: target.sessionId,
          contents: batch
        })
        if (descriptors.length > 1000 || permitted.length + descriptors.length > MAX_CANDIDATES)
          throw new RecordedObservationReadError('unavailable')
        for (const descriptor of descriptors) {
          if (
            descriptor.projectId !== target.projectId ||
            descriptor.sessionId !== target.sessionId ||
            descriptor.state !== 'finalized' ||
            descriptor.isPublished !== true ||
            !SAFE_ID.test(descriptor.artifactId) ||
            !SAFE_ID.test(descriptor.versionId) ||
            !batch.some(
              (content) =>
                content.checksum === descriptor.checksum && content.sizeBytes === descriptor.size
            )
          )
            continue
          if (permitted.some((candidate) => candidate.sourceVersionId === descriptor.versionId))
            continue
          let input: NotebookRunInputFile
          try {
            input = await resolve({
              ...target,
              artifactId: descriptor.artifactId,
              versionId: descriptor.versionId
            })
          } catch (error) {
            if (error instanceof RecordedObservationReadError && error.code === 'unavailable')
              continue
            throw error
          }
          if (input.checksum !== descriptor.checksum || input.sizeBytes !== descriptor.size)
            continue
          // resolve() rechecks the exact Artifact/Version's publication and receiving scope.
          // The catalog-shaped entry carries no sender path or active runtime identity.
          permitted.push({
            sourceFileId: input.sourceFileId,
            sourceVersionId: input.inputFileVersionId,
            projectId: target.projectId,
            sessionId: target.sessionId,
            name: descriptor.name,
            checksum: input.checksum,
            size: input.sizeBytes
          })
        }
      }
    }
    const resolved = resolveRunObservationMedia(
      archive,
      target,
      permitted.map((candidate) => ({
        projectId: candidate.projectId,
        sessionId: candidate.sessionId,
        versionId: candidate.sourceVersionId,
        name: candidate.name,
        checksum: candidate.checksum!,
        sizeBytes: candidate.size,
        state: 'finalized',
        isPublished: true
      })),
      mapping
    )
    const media: ResolvedObservationMedia[] = []
    for (const result of resolved) {
      if (result.status !== 'available') continue
      const declared = archive.media.find((item) => item.mediaKey === result.mediaKey)!
      const contentIds = new Set(
        permitted
          .filter(
            (candidate) =>
              candidate.checksum === declared.checksum && candidate.size === declared.sizeBytes
          )
          .map((candidate) => candidate.sourceVersionId)
      )
      // Filenames can repeat or change across imports. Only a retained Main receipt may choose
      // one of several equally matching immutable versions, never the archive's name or ID alone.
      if (
        contentIds.size > 1 &&
        (!declared.sourceVersionId || mapping?.[declared.sourceVersionId] !== result.versionId)
      )
        continue
      const matches = permitted.filter(
        (candidate) => candidate.sourceVersionId === result.versionId
      )
      if (matches.length !== 1) continue
      const candidate = matches[0]
      media.push({
        mediaKey: result.mediaKey,
        artifactId: candidate.sourceFileId,
        versionId: candidate.sourceVersionId,
        checksum: candidate.checksum!,
        sizeBytes: candidate.size
      })
    }
    await resolve(target)
    await guard(target, signal)
    return { receiving: { ...target }, archive, media }
  }
  const safe = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof RecordedObservationReadError) throw error
      throw new RecordedObservationReadError('unavailable')
    }
  }
  return {
    read: (input, signal) => safe(() => load(recordedObservationTargetSchema.parse(input), signal)),
    readMedia: (input, mediaKey, signal) =>
      safe(async () => {
        const target = recordedObservationTargetSchema.parse(input)
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(mediaKey))
          throw new RecordedObservationReadError('media-unavailable')
        const payload = await load(target, signal)
        const resolved = payload.media.find((media) => media.mediaKey === mediaKey)
        const declared = payload.archive.media.find((media) => media.mediaKey === mediaKey)
        if (!resolved || !declared) throw new RecordedObservationReadError('media-unavailable')
        const body = await readVersion(
          { ...target, artifactId: resolved.artifactId, versionId: resolved.versionId },
          MAX_MEDIA_BYTES,
          signal
        )
        if (!verifyRunObservationMediaBytes(declared, body))
          throw new RecordedObservationReadError('media-unavailable')
        await resolve(target)
        await guard(target, signal)
        return {
          body,
          mimeType: /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(declared.mimeType)
            ? declared.mimeType
            : 'application/octet-stream'
        }
      })
  }
}
