import { createHash } from 'node:crypto'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RecordedObservationTarget } from '../../shared/run-observation-recorded'
import type { RunObservationSnapshot } from '../../shared/run-observation'
import type { RunObservationArchive } from '../../shared/run-observation-archive'
import { createProvenanceTestFixture } from '../artifacts/provenance-test-fixtures'
import { ArtifactProvenanceRepository } from '../artifacts/provenance-repository'
import { createPngBytes } from '../artifacts/artifact-test-fixtures'
import { ImmutableInputAuthority } from '../immutable-input-authority'
import { ManagedFileVersionService } from '../managed-file-versions/service'
import { ManagedFileIndexRepository } from '../project-files/repository'
import { SessionRepository } from '../session-persistence/repository'
import { SessionPackageService } from '../session-package/service'
import { initDataRoot } from '../storage-root'
import { UploadRepository } from '../uploads/repository'
import { buildRunObservationArchive } from './archive'
import { createRecordedObservationReader, type RecordedObservationReader } from './recorded-reader'

vi.mock('electron', () => ({
  app: { getPath: () => '/home/user', isPackaged: true },
  safeStorage: { isEncryptionAvailable: () => false }
}))
type Fixture = Awaited<ReturnType<typeof createProvenanceTestFixture>>
const fixtures: Fixture[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fixture of fixtures.splice(0)) await fixture.dispose()
})
const scope = { projectId: 'project-1', sessionId: 'session-1' }
const bytes = createPngBytes('recorded-project-screen')
const checksum = createHash('sha256').update(bytes).digest('hex')
const snapshot: RunObservationSnapshot = {
  identity: { projectId: 'author-project', sessionId: 'author-session', runId: 'author-run' },
  cursor: { epoch: 'author-epoch', sequence: 0 },
  observedAt: 100,
  phase: 'completed',
  stepId: 'run:author-run',
  artifacts: [],
  artifactsTruncated: false,
  run: {
    runId: 'author-run',
    kernelKind: 'bash',
    status: 'completed',
    startedAt: 10,
    endedAt: 99,
    logs: {
      stdout: { text: 'recorded output', truncated: false, redacted: false },
      stderr: { text: '', truncated: false, redacted: false },
      traceback: { text: '', truncated: false, redacted: false }
    }
  }
}
function adapters(fixture: Fixture): {
  versions: ManagedFileVersionService
  authority: ImmutableInputAuthority
  files: ManagedFileIndexRepository
  provenance: ArtifactProvenanceRepository
} {
  const versions = new ManagedFileVersionService({
    storageRoot: fixture.storageRoot,
    getClient: async () => fixture.client
  })
  const authority = new ImmutableInputAuthority({
    storageRoot: fixture.storageRoot,
    managedFileVersions: versions
  })
  const files = new ManagedFileIndexRepository(
    async () => fixture.client,
    fixture.storageRoot,
    versions,
    new UploadRepository(fixture.storageRoot, { getClient: async () => fixture.client })
  )
  const provenance = new ArtifactProvenanceRepository({
    ...fixture.repositoryOptions,
    loadSession: (projectId, sessionId) =>
      new SessionRepository(fixture.storageRoot).loadSession(projectId, sessionId)
  })
  return { versions, authority, files, provenance }
}
async function setup(): Promise<{
  fixture: Fixture
  reader: RecordedObservationReader
  target: RecordedObservationTarget
  archive: RunObservationArchive
  media: Awaited<ReturnType<ManagedFileVersionService['adoptLegacyArtifact']>>
  versions: ManagedFileVersionService
  authority: ImmutableInputAuthority
  files: ManagedFileIndexRepository
  provenance: ArtifactProvenanceRepository
  authorize: (target: RecordedObservationTarget) => Promise<void>
  revoke(): void
}> {
  const fixture = await createProvenanceTestFixture()
  fixtures.push(fixture)
  initDataRoot(fixture.storageRoot)
  await fixture.client.project.create({ data: { id: scope.projectId, name: 'Recorded research' } })
  await new SessionRepository(fixture.storageRoot).saveSession({
    id: scope.sessionId,
    projectId: scope.projectId,
    title: 'Recorded research',
    cwd: '',
    status: 'idle',
    messages: [],
    createdAt: 1,
    updatedAt: 1
  })
  const { versions, authority, files, provenance } = adapters(fixture)
  const media = await versions.adoptLegacyArtifact({
    ...scope,
    sourceFileId: 'local-screen',
    logicalFilename: 'imported-capture.png',
    content: bytes,
    contentType: 'image/png'
  })
  const archive = buildRunObservationArchive({
    recordingId: 'recording-1',
    history: { coverage: 'process-local', truncated: false, snapshots: [snapshot] },
    capturedAt: 110,
    stopReason: 'run-ended',
    media: [
      {
        mediaKey: 'frame-0',
        name: 'capture.png',
        mimeType: 'image/png',
        checksum,
        sizeBytes: bytes.length,
        sourceVersionId: media.versionId,
        stepKeys: ['observation-0']
      }
    ]
  })
  const observation = await versions.adoptLegacyArtifact({
    ...scope,
    sourceFileId: 'local-observation',
    logicalFilename: 'observation.json',
    content: Buffer.from(JSON.stringify(archive)),
    contentType: 'application/json'
  })
  let authorized = true
  const authorize = vi.fn(async (target: RecordedObservationTarget) => {
    if (!authorized || target.projectId !== scope.projectId || target.sessionId !== scope.sessionId)
      throw new Error('private scope diagnostic')
  })
  const reader = createRecordedObservationReader({
    immutableInputAuthority: authority,
    projectFilesRepository: files,
    artifactProvenanceRepository: provenance,
    authorizeScope: authorize
  })
  return {
    fixture,
    versions,
    authority,
    files,
    provenance,
    archive,
    media,
    reader,
    authorize,
    target: { ...scope, artifactId: observation.fileId, versionId: observation.versionId },
    revoke: () => {
      authorized = false
    }
  }
}

describe('receiving-session recorded observation reader', () => {
  async function advanceMediaHead(h: Awaited<ReturnType<typeof setup>>): Promise<void> {
    const version = await h.provenance.writeAppGeneratedVersion({
      projectId: scope.projectId,
      appSessionId: scope.sessionId,
      artifactStorageSessionId: scope.sessionId,
      artifactRunId: 'newer-screen-run',
      rootFrameId: 'root-1',
      agentFrameId: 'agent-1',
      messageBranchId: 'branch-1',
      runtimeSegmentId: 'runtime-1',
      promptMessageId: 'prompt-1',
      filename: 'imported-capture.png',
      content: createPngBytes('newer-project-screen').toString('base64'),
      encoding: 'base64',
      contentType: 'image/png'
    })
    await h.fixture.client.artifactVersion.update({
      where: { id: version.versionId },
      data: { state: 'finalized', managedVisibleAt: new Date() }
    })
    await h.fixture.client.artifactLineage.update({
      where: { id: version.artifactId },
      data: { currentVersionId: version.versionId }
    })
    expect(version.artifactId).toBe(h.media.fileId)
    expect(version.versionNumber).toBe(2)
    expect(
      (await h.files.readExportFiles(scope)).find((file) => file.sourceFileId === h.media.fileId)
        ?.sourceVersionId
    ).toBe(version.versionId)
  }

  it('reads exact published bytes while preserving author identities only as evidence', async () => {
    const h = await setup()
    const list = vi.spyOn(h.files, 'readExportFiles')
    const result = await h.reader.read(h.target)
    expect(result.receiving).toEqual(h.target)
    expect(result.archive).toEqual(h.archive)
    expect(result.archive.records[0].sourceEvidence.identity.runId).toBe('author-run')
    expect(result.archive.records[0].run).not.toHaveProperty('runId')
    expect(result.media).toEqual([
      {
        mediaKey: 'frame-0',
        artifactId: h.media.fileId,
        versionId: h.media.versionId,
        checksum,
        sizeBytes: bytes.length
      }
    ])
    expect(list).toHaveBeenCalledWith(scope)
    expect(await h.reader.readMedia(h.target, 'frame-0')).toEqual({
      body: new Uint8Array(bytes),
      mimeType: 'image/png'
    })
    await expect(
      h.reader.read({ ...h.target, versionId: h.media.versionId })
    ).rejects.toMatchObject({ code: 'unavailable' })
    await expect(
      h.reader.read({ ...h.target, sessionId: 'unrelated-session' })
    ).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('excludes unpublished media and refuses an unpublished archive without producer privileges', async () => {
    const h = await setup()
    await h.fixture.client.artifactVersion.update({
      where: { id: h.media.versionId },
      data: {
        originKind: 'agent_generated',
        managedVisibleAt: null,
        artifactRunId: 'unpublished-run',
        rootFrameId: 'root-1',
        agentFrameId: 'agent-1',
        messageBranchId: 'branch-1',
        runtimeSegmentId: 'runtime-1',
        promptMessageId: 'prompt-1',
        evidenceStorageKey: 'unpublished-evidence.json',
        evidenceJson: '{}',
        evidenceChecksum: createHash('sha256').update('{}').digest('hex'),
        evidenceSchemaVersion: 1
      }
    })
    expect((await h.reader.read(h.target)).media).toEqual([])
    await expect(h.reader.readMedia(h.target, 'frame-0')).rejects.toMatchObject({
      code: 'media-unavailable'
    })
    await h.fixture.client.artifactVersion.update({
      where: { id: h.target.versionId },
      data: { state: 'pending' }
    })
    await expect(h.reader.read(h.target)).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('does not choose an ambiguous media match, and only a trusted receiving mapping can disambiguate', async () => {
    const h = await setup()
    const duplicate = await h.versions.adoptLegacyArtifact({
      ...scope,
      sourceFileId: 'duplicate',
      logicalFilename: 'duplicate.png',
      content: bytes,
      contentType: 'image/png'
    })
    expect((await h.reader.read(h.target)).media).toEqual([])
    const mapped = createRecordedObservationReader({
      immutableInputAuthority: h.authority,
      projectFilesRepository: h.files,
      authorizeScope: h.authorize,
      readSourceVersionMapping: async () => ({ [h.media.versionId]: duplicate.versionId })
    })
    expect((await mapped.read(h.target)).media[0].versionId).toBe(duplicate.versionId)
    await expect(h.reader.readMedia(h.target, 'author-run')).rejects.toMatchObject({
      code: 'media-unavailable'
    })
  })

  it('never resolves equal bytes from another Session or a repository adapter with an over-broad result', async () => {
    const h = await setup()
    const foreign = await h.versions.adoptLegacyArtifact({
      ...scope,
      sessionId: 'foreign-session',
      sourceFileId: 'foreign-screen',
      logicalFilename: 'capture.png',
      content: bytes,
      contentType: 'image/png'
    })
    const foreignRows = await h.files.readExportFiles({ ...scope, sessionId: 'foreign-session' })
    expect(foreignRows[0].sourceVersionId).toBe(foreign.versionId)
    vi.spyOn(h.files, 'readExportFiles').mockResolvedValue(foreignRows)
    vi.spyOn(h.provenance, 'resolvePublishedSessionVersionsByContent').mockResolvedValue([
      {
        ...scope,
        sessionId: 'foreign-session',
        artifactId: foreign.fileId,
        versionId: foreign.versionId,
        name: 'capture.png',
        checksum,
        size: bytes.length,
        state: 'finalized',
        isPublished: true
      }
    ])
    expect((await h.reader.read(h.target)).media).toEqual([])
  })

  it('does not use a matching archive filename to choose between equal-content historical Versions', async () => {
    const h = await setup()
    await advanceMediaHead(h)
    await h.versions.adoptLegacyArtifact({
      ...scope,
      sourceFileId: 'same-content-named-copy',
      logicalFilename: h.archive.media[0].name,
      content: bytes,
      contentType: 'image/png'
    })
    expect((await h.reader.read(h.target)).media).toEqual([])
  })

  it('reads a recorded historical published Version after the same Artifact advances', async () => {
    const h = await setup()
    await advanceMediaHead(h)
    expect((await h.reader.read(h.target)).media[0]).toMatchObject({
      artifactId: h.media.fileId,
      versionId: h.media.versionId
    })
    expect((await h.reader.readMedia(h.target, 'frame-0')).body).toEqual(new Uint8Array(bytes))
    await h.fixture.client.artifactVersion.update({
      where: { id: h.media.versionId },
      data: { state: 'pending' }
    })
    expect((await h.reader.read(h.target)).media).toEqual([])
  })

  it('finds historical media after import, working-copy export and re-import without relying on sender IDs', async () => {
    const h = await setup()
    await advanceMediaHead(h)
    let sourceFixture = h.fixture
    let sourceTarget = h.target
    let previousMediaVersion = h.media.versionId
    for (let hop = 0; hop < 2; hop++) {
      const receiving = await createProvenanceTestFixture()
      fixtures.push(receiving)
      const exporter = new SessionPackageService({
        storageRoot: sourceFixture.storageRoot,
        getClient: async () => sourceFixture.client
      })
      const importer = new SessionPackageService({
        storageRoot: receiving.storageRoot,
        getClient: async () => receiving.client
      })
      try {
        const path = join(sourceFixture.storageRoot, `historical-${hop}.science`)
        await exporter.exportTo(
          { projectId: sourceTarget.projectId, sessionId: sourceTarget.sessionId },
          path
        )
        initDataRoot(receiving.storageRoot)
        const imported = await importer.importFrom(path)
        const origin = await importer.readOrigin(imported)
        const target = {
          projectId: imported.projectId,
          sessionId: imported.sessionId,
          artifactId: origin.identities[sourceTarget.artifactId],
          versionId: origin.identities[sourceTarget.versionId]
        }
        const { authority, files, provenance } = adapters(receiving)
        expect(typeof target.artifactId, `hop ${hop} receiving Artifact`).toBe('string')
        expect(typeof target.versionId, `hop ${hop} receiving Version`).toBe('string')
        expect(
          await provenance.resolvePublishedSessionVersionsByContent({
            projectId: imported.projectId,
            appSessionId: imported.sessionId,
            contents: [{ checksum, sizeBytes: bytes.length }]
          })
        ).toHaveLength(1)
        const reader = createRecordedObservationReader({
          immutableInputAuthority: authority,
          projectFilesRepository: files,
          artifactProvenanceRepository: provenance,
          readSourceVersionMapping: async () => (await importer.readOrigin(imported)).identities,
          authorizeScope: async (request) => {
            expect(request.projectId).toBe(imported.projectId)
            expect(request.sessionId).toBe(imported.sessionId)
          }
        })
        const payload = await reader.read(target)
        expect(payload.archive).toEqual(h.archive)
        expect(payload.archive.media[0].sourceVersionId).toBe(h.media.versionId)
        const remapped = origin.identities[previousMediaVersion]
        expect(remapped).toBeDefined()
        expect(payload.media[0]?.versionId).toBe(remapped)
        if (hop === 1) expect(origin.identities[h.media.versionId]).toBeUndefined()
        expect((await reader.readMedia(target, 'frame-0')).body).toEqual(new Uint8Array(bytes))
        sourceFixture = receiving
        sourceTarget = target
        previousMediaVersion = remapped
        if (hop === 0) {
          // A read-only re-export forwards the original package. Export a receiving working copy
          // to exercise actual second-hop local IDs without rewriting immutable archive bytes.
          const copy = await importer.fork(imported)
          const copyOrigin = await importer.readOrigin(copy)
          sourceTarget = {
            ...copy,
            artifactId: copyOrigin.identities[h.target.artifactId],
            versionId: copyOrigin.identities[h.target.versionId]
          }
          previousMediaVersion = copyOrigin.identities[h.media.versionId]
        }
      } finally {
        await exporter.close()
        await importer.close()
      }
    }
  }, 60000)

  it('verifies actual media bytes again and returns no internal paths when stored content is corrupt', async () => {
    const h = await setup()
    expect((await h.reader.read(h.target)).media).toHaveLength(1)
    const path = join(h.fixture.storageRoot, h.media.storageRef)
    await chmod(path, 0o600)
    await writeFile(path, Buffer.alloc(bytes.length, 1))
    await expect(h.reader.readMedia(h.target, 'frame-0')).rejects.toMatchObject({
      code: 'unavailable',
      message: 'The recorded observation is unavailable.'
    })
  })

  it('fails strict archive parsing with a fixed error instead of returning partial or executable content', async () => {
    const h = await setup()
    const invalid = await h.versions.adoptLegacyArtifact({
      ...scope,
      sourceFileId: 'invalid-archive',
      logicalFilename: 'invalid.json',
      content: Buffer.from(
        JSON.stringify({ ...h.archive, serviceUrl: 'http://localhost/private-management' })
      ),
      contentType: 'application/json'
    })
    await expect(
      h.reader.read({ ...scope, artifactId: invalid.fileId, versionId: invalid.versionId })
    ).rejects.toMatchObject({
      code: 'invalid-archive',
      message: 'The recorded observation archive is invalid.'
    })
  })

  it('revalidates authorization after actual disk reads and always closes the content lease', async () => {
    const h = await setup()
    const open = h.authority.openContent.bind(h.authority)
    let closed = false
    vi.spyOn(h.authority, 'openContent').mockImplementationOnce(async (...args) => {
      const lease = await open(...args)
      return {
        ...lease,
        readRange: async (begin, end) => {
          const body = await lease.readRange(begin, end)
          h.revoke()
          return body
        },
        close: async () => {
          closed = true
          await lease.close()
        }
      }
    })
    await expect(h.reader.read(h.target)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(closed).toBe(true)
  })

  it('reads an actual .science import after Artifact and Version identities are remapped', async () => {
    const h = await setup()
    const receiving = await createProvenanceTestFixture()
    fixtures.push(receiving)
    const exporter = new SessionPackageService({
      storageRoot: h.fixture.storageRoot,
      getClient: async () => h.fixture.client
    })
    const importer = new SessionPackageService({
      storageRoot: receiving.storageRoot,
      getClient: async () => receiving.client
    })
    try {
      const path = join(h.fixture.storageRoot, 'recorded.science')
      await exporter.exportTo(scope, path)
      initDataRoot(receiving.storageRoot)
      const imported = await importer.importFrom(path)
      const origin = await importer.readOrigin(imported)
      const target = {
        projectId: imported.projectId,
        sessionId: imported.sessionId,
        artifactId: origin.identities[h.target.artifactId],
        versionId: origin.identities[h.target.versionId]
      }
      expect(target.artifactId).not.toBe(h.target.artifactId)
      expect(target.versionId).not.toBe(h.target.versionId)
      const { authority, files } = adapters(receiving)
      const reader = createRecordedObservationReader({
        immutableInputAuthority: authority,
        projectFilesRepository: files,
        authorizeScope: async (request) => {
          expect(request.projectId).toBe(imported.projectId)
          expect(request.sessionId).toBe(imported.sessionId)
        }
      })
      const payload = await reader.read(target)
      expect(payload.archive).toEqual(h.archive)
      expect(payload.media).toEqual([
        {
          mediaKey: 'frame-0',
          artifactId: origin.identities[h.media.fileId],
          versionId: origin.identities[h.media.versionId],
          checksum,
          sizeBytes: bytes.length
        }
      ])
      expect(await reader.readMedia(target, 'frame-0')).toEqual({
        body: new Uint8Array(bytes),
        mimeType: 'image/png'
      })
      const session = await new SessionRepository(receiving.storageRoot).loadSession(
        imported.projectId,
        imported.sessionId
      )
      expect(session?.packageOrigin).toBeDefined()
      expect(session?.activeRun).toBeUndefined()
    } finally {
      await exporter.close()
      await importer.close()
    }
  }, 60000)
})
