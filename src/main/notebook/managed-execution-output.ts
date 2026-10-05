import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type {
  ArtifactVersionFile,
  ArtifactWriteSourceScope
} from '../../shared/artifact-provenance'
import type { NotebookRunProvenanceContext } from '../../shared/notebook'
import type { ArtifactProvenanceRepository } from '../artifacts/provenance-repository'
import { createNotebookArtifactSourceScopeProvider } from './artifact-source-scope'
import {
  resolveManagedOutputAuthority,
  type ManagedOutputAuthority
} from './managed-output-authority'
import type { NotebookRunRepository } from './repository'

export type ManagedExecutionOutput = {
  filename: string
  contentType?: string
  source:
    | { kind: 'inline'; content: string }
    | { kind: 'localPath'; path: string; root?: 'workspace' | 'notebook' }
    | { kind: 'managedOutput'; path: string; authority: ManagedOutputAuthority }
  producerRunId?: string
}
export type ManagedExecutionProvenance = Required<
  Pick<
    NotebookRunProvenanceContext,
    'rootFrameId' | 'agentFrameId' | 'messageBranchId' | 'runtimeSegmentId' | 'promptMessageId'
  >
>
export type ManagedExecutionOutputScope = {
  projectId: string
  sessionId: string
  operationId: string
  workspaceCwd: string
  artifactRunId: string
  writeNamespace: string
  provenanceContext: ManagedExecutionProvenance
  messageAncestry: readonly string[]
}
type Dependencies = {
  dataRoot: string
  artifacts: Pick<ArtifactProvenanceRepository, 'saveVersion'>
  notebooks: Pick<NotebookRunRepository, 'readSessionDocuments'>
}

/** Common output validation for an externally admitted request or an already running Agent turn. */
export function createManagedExecutionOutputWriter(
  dependencies: Dependencies,
  scope: ManagedExecutionOutputScope,
  signal: AbortSignal,
  observers: {
    onRun?(runId: string): Promise<void>
    onArtifact?(artifact: ArtifactVersionFile): Promise<void>
  } = {}
): {
  notebookDataDir: string
  recordRun(runId: string): Promise<void>
  saveOutput(output: ManagedExecutionOutput): Promise<ArtifactVersionFile>
} {
  const source = createNotebookArtifactSourceScopeProvider(dependencies.dataRoot)({
    projectId: scope.projectId,
    appSessionId: scope.sessionId,
    ...scope.provenanceContext
  })
  const sourceScope: ArtifactWriteSourceScope = {
    allowedImportRoots: [
      source.notebookSessionRoot,
      ...(scope.workspaceCwd ? [scope.workspaceCwd] : [])
    ],
    workspaceCwd: scope.workspaceCwd,
    notebookDataDir: source.notebookDataDir,
    notebookSessionRoot: source.notebookSessionRoot
  }
  const recorded = new Set<string>()
  const findRun = async (
    runId: string
  ): Promise<import('../../shared/notebook').NotebookRunRecord> => {
    const runs = (
      await dependencies.notebooks.readSessionDocuments(scope.projectId, scope.sessionId)
    ).flatMap(({ runs }) => runs)
    const run = runs.find((item) => item.runId === runId)
    if (
      !run ||
      Object.entries(scope.provenanceContext).some(
        ([key, value]) => run[key as keyof ManagedExecutionProvenance] !== value
      )
    )
      throw new Error('Notebook Run does not belong to this Session operation.')
    return run
  }
  return {
    notebookDataDir: source.notebookDataDir,
    async recordRun(runId) {
      await findRun(runId)
      await observers.onRun?.(runId)
      recorded.add(runId)
    },
    async saveOutput(output) {
      signal.throwIfAborted()
      if (output.producerRunId) {
        const run = await findRun(output.producerRunId)
        if (!recorded.has(run.runId) || run.status === 'queued' || run.status === 'running')
          throw new Error('Artifact producer must be a terminal recorded Run of this operation.')
      }
      let writeScope = sourceScope
      let writeSignal = signal
      let artifactSource:
        | { kind: 'inline'; content: string; encoding: 'base64' }
        | { kind: 'localPath'; path: string }
      if (output.source.kind === 'inline')
        artifactSource = {
          kind: 'inline',
          content: Buffer.from(output.source.content, 'utf8').toString('base64'),
          encoding: 'base64'
        }
      else if (output.source.kind === 'managedOutput') {
        const managed = await resolveManagedOutputAuthority(
          output.source.authority,
          scope,
          output.source.path
        )
        artifactSource = { kind: 'localPath', path: managed.path }
        writeScope = {
          ...sourceScope,
          allowedImportRoots: [...(sourceScope.allowedImportRoots ?? []), managed.root]
        }
        writeSignal = AbortSignal.any([signal, managed.signal])
      } else {
        const path = output.source.path
        if (
          !path ||
          isAbsolute(path) ||
          path.includes('\\') ||
          path.includes(':') ||
          [...path].some((character) => character.charCodeAt(0) < 32) ||
          path.split('/').some((part) => !part || part === '.' || part === '..')
        )
          throw new Error('Artifact output must use a managed relative path.')
        const root =
          output.source.root === 'workspace' ? scope.workspaceCwd : source.notebookDataDir
        if (!root) throw new Error('Session has no managed output root.')
        const [actualRoot, actualFile] = await Promise.all([
          realpath(root),
          realpath(join(root, path))
        ])
        const rel = relative(actualRoot, actualFile)
        if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
          throw new Error('Artifact output escapes its managed root.')
        artifactSource = { kind: 'localPath', path: actualFile }
      }
      const writeIdentity = createHash('sha256')
        .update(JSON.stringify([scope.operationId, scope.writeNamespace, output.filename]))
        .digest('hex')
      const artifact = await dependencies.artifacts.saveVersion(
        {
          projectId: scope.projectId,
          appSessionId: scope.sessionId,
          artifactStorageSessionId: scope.sessionId,
          artifactRunId: scope.artifactRunId,
          writeOperationId: `operation-write-${writeIdentity}`,
          ...scope.provenanceContext,
          messageAncestry: [...scope.messageAncestry],
          notebookSessionId: scope.sessionId,
          producerRunId: output.producerRunId,
          filename: output.filename,
          contentType: output.contentType,
          source: artifactSource
        },
        writeScope,
        writeSignal
      )
      await observers.onArtifact?.(artifact)
      return artifact
    }
  }
}
