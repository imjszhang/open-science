import { createHash } from 'node:crypto'
import { isAbsolute, normalize, relative, sep } from 'node:path'

import type { NotebookSandboxInvocation } from './process-sandbox'

declare const managedShellExecutionBrand: unique symbol

/** An in-process authority, not a DTO. Serializing or copying it never preserves authority. */
export type ManagedShellExecutionCapability = Readonly<{
  [managedShellExecutionBrand]: true
}>

export type ManagedShellExecutionScope = Readonly<{
  projectId: string
  sessionId: string
  executionInvocationId: string
}>

export type ManagedShellCleanupResult = Readonly<{
  scope: ManagedShellExecutionScope
  runId?: string
  state: 'verified' | 'running' | 'cleanup-pending' | 'unknown'
  reaped: boolean
  proof?: 'never-dispatched' | 'process-owner' | 'startup-recovery'
}>

export type ManagedShellExecutionPolicy = ManagedShellExecutionScope &
  Readonly<{
    cwd: string
    /** Main-owned publication directory; observed by this Run, never inferred from write grants. */
    outputRoot?: string
    environment: Readonly<Record<string, string>>
    filesystem: NotebookSandboxInvocation['filesystem']
    fingerprint: string
    signal?: AbortSignal
    localService?: Readonly<{
      logicalPort: number
      /** The resource owner journals intent before allocation and retains cleanup authority. */
      prepareSocket(context: { runId: string; signal?: AbortSignal }): Promise<string>
    }>
  }>

type ManagedShellExecutionInput = ManagedShellExecutionScope &
  Omit<
    ManagedShellExecutionPolicy,
    keyof ManagedShellExecutionScope | 'fingerprint' | 'filesystem'
  > & {
    /** Additional immutable material/runtime identity; never replaces the canonical fingerprint. */
    fingerprint?: string
    filesystem: Pick<NotebookSandboxInvocation['filesystem'], 'readOnlyRoots' | 'readWriteRoots'> &
      Partial<Pick<NotebookSandboxInvocation['filesystem'], 'deniedReadRoots' | 'deniedWriteRoots'>>
  }

const policies = new WeakMap<ManagedShellExecutionCapability, ManagedShellExecutionPolicy>()

const absolutePath = (value: string): string => {
  if (!value || !isAbsolute(value) || normalize(value) !== value || value.includes('\0')) {
    throw new Error('Managed Shell paths must be normalized absolute paths.')
  }
  return value
}

const snapshotRoots = (roots: readonly string[] = []): readonly string[] =>
  Object.freeze([...new Set(roots.map(absolutePath))].sort())

const contains = (root: string, path: string): boolean => {
  const child = relative(root, path)
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child))
}

/** Only trusted main-process environment owners mint this capability. */
export const createManagedShellExecutionCapability = (
  input: ManagedShellExecutionInput
): ManagedShellExecutionCapability => {
  for (const key of ['projectId', 'sessionId', 'executionInvocationId'] as const) {
    if (typeof input[key] !== 'string' || !input[key].trim()) {
      throw new Error(`Managed Shell requires ${key}.`)
    }
  }
  const cwd = absolutePath(input.cwd)
  const readOnlyRoots = snapshotRoots(input.filesystem.readOnlyRoots)
  const readWriteRoots = snapshotRoots(input.filesystem.readWriteRoots)
  if (!readWriteRoots.some((root) => contains(root, cwd))) {
    throw new Error('Managed Shell working directory requires an explicit write root.')
  }
  const outputRoot = input.outputRoot === undefined ? undefined : absolutePath(input.outputRoot)
  if (
    outputRoot &&
    (!readWriteRoots.some((root) => contains(root, outputRoot)) ||
      readOnlyRoots.some((root) => contains(root, outputRoot)))
  ) {
    throw new Error('Managed Shell output directory requires an explicit writable root.')
  }
  const environment: Record<string, string> = {}
  for (const key of Object.keys(input.environment).sort()) {
    const value = input.environment[key]
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
      typeof value !== 'string' ||
      value.includes('\0')
    ) {
      throw new Error('Managed Shell environment must contain explicit string values.')
    }
    // These values are created only after durable Run admission and must never be frozen on disk.
    if (key === 'OPEN_SCIENCE_SERVICE_SOCKET' || key === 'OPEN_SCIENCE_SERVICE_PORT') {
      throw new Error('Managed Shell service environment is execution-owned.')
    }
    environment[key] = value
  }
  if (
    input.localService &&
    (!Number.isInteger(input.localService.logicalPort) ||
      input.localService.logicalPort < 1 ||
      input.localService.logicalPort > 65535 ||
      typeof input.localService.prepareSocket !== 'function')
  )
    throw new Error('Invalid managed Shell local service policy.')
  const filesystem = Object.freeze({
    readOnlyRoots,
    readWriteRoots,
    deniedReadRoots: snapshotRoots(input.filesystem.deniedReadRoots),
    // Explicit read-only inputs remain read-only even when nested below a writable workspace.
    deniedWriteRoots: snapshotRoots([
      ...readOnlyRoots,
      ...(input.filesystem.deniedWriteRoots ?? [])
    ])
  })
  const snapshot = {
    projectId: input.projectId,
    sessionId: input.sessionId,
    executionInvocationId: input.executionInvocationId,
    cwd,
    ...(outputRoot ? { outputRoot } : {}),
    environment: Object.freeze(environment),
    filesystem
  }
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        ...snapshot,
        materialIdentity: input.fingerprint ?? null,
        localService: input.localService ? { logicalPort: input.localService.logicalPort } : null
      })
    )
    .digest('hex')
  const capability = Object.freeze({}) as ManagedShellExecutionCapability
  policies.set(
    capability,
    Object.freeze({
      ...snapshot,
      fingerprint,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.localService ? { localService: Object.freeze({ ...input.localService }) } : {})
    })
  )
  return capability
}

export const resolveManagedShellExecutionCapability = (
  capability: ManagedShellExecutionCapability,
  scope: { projectId: string; sessionId: string; executionInvocationId?: string },
  allowRevoked = false
): ManagedShellExecutionPolicy => {
  const policy = policies.get(capability)
  if (
    !policy ||
    policy.projectId !== scope.projectId ||
    policy.sessionId !== scope.sessionId ||
    policy.executionInvocationId !== scope.executionInvocationId
  ) {
    throw new Error('Managed Shell capability does not belong to this execution.')
  }
  if (!allowRevoked) policy.signal?.throwIfAborted()
  return policy
}
