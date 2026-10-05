import { createHash } from 'node:crypto'
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  ManagedResearchEnvironmentOwner,
  ManagedEnvironmentCancelledError,
  type ManagedResearchEnvironment,
  type ManagedResearchEnvironmentDependencies,
  type ManagedResearchRuntime
} from './managed-research-environment'
import { resolveManagedShellExecutionCapability } from './managed-shell-execution'
import {
  resolveManagedOutputAuthority,
  type ManagedOutputAuthority
} from './managed-output-authority'
import type { ResearchMaterialAuthority } from './research-materials'
import { copyAndVerify } from '../storage/data-migration'
import { MANAGED_EXECUTION_DATA_DIRS } from '../storage/data-directories'
import { getNotebookDataRoot } from './repository'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const digest = (text: string): string => createHash('sha256').update(text).digest('hex')
const scope = { projectId: 'project', sessionId: 'receiver' }

async function setup(): Promise<{
  root: string
  owner: ManagedResearchEnvironmentOwner
  dependencies: ManagedResearchEnvironmentDependencies
  authority: ResearchMaterialAuthority
  runtime: ManagedResearchRuntime
  prepare: () => Promise<ManagedResearchEnvironment>
}> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'managed-env-')))
  roots.push(root)
  const runtime: ManagedResearchRuntime = {
    kind: 'node',
    executable: join(root, 'node'),
    version: 'v24.18.1',
    sha256: digest('node'),
    platform: process.platform as 'darwin' | 'linux' | 'win32',
    arch: process.arch,
    readOnlyRoots: [join(root, 'runtime')]
  }
  const content = 'console.log("offline")'
  const authority: ResearchMaterialAuthority = {
    source: { projectId: scope.projectId, sessionId: 'source', identity: 'source-version-1' },
    versions: [
      {
        versionId: 'script-version',
        sourceIdentity: 'source-version-1',
        filename: 'main.mjs',
        sha256: digest(content),
        sizeBytes: Buffer.byteLength(content)
      }
    ],
    readVersion: vi.fn(async () => Buffer.from(content))
  }
  const dependencies: ManagedResearchEnvironmentDependencies = {
    dataRoot: root,
    socketRoot: await realpath(tmpdir()),
    verifyRuntime: vi.fn(async () => undefined),
    stopExecution: vi.fn(async () => ({ verified: true }))
  }
  const owner = new ManagedResearchEnvironmentOwner(dependencies)
  return {
    root,
    owner,
    dependencies,
    authority,
    runtime,
    prepare: () =>
      owner.prepare({
        ...scope,
        requestId: 'prepare-1',
        authority,
        runtime,
        materials: { files: [{ versionId: 'script-version', restorePath: 'source/main.mjs' }] }
      })
  }
}

it('prepares immutable inputs without executing and preserves a restartable idempotent handle', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  expect(prepared.state).toBe('ready')
  expect(prepared.source.sessionId).toBe('source')
  expect(prepared.sessionId).toBe('receiver')
  expect(fixture.dependencies.stopExecution).not.toHaveBeenCalled()
  const root = join(fixture.root, 'research-environments', prepared.environmentId)
  expect(await readFile(join(root, 'inputs/source/main.mjs'), 'utf8')).toContain('offline')
  expect((await fixture.prepare()).environmentId).toBe(prepared.environmentId)
  expect(fixture.authority.readVersion).toHaveBeenCalledTimes(1)
  const restarted = new ManagedResearchEnvironmentOwner(fixture.dependencies)
  await restarted.recover()
  expect((await restarted.get({ ...scope, environmentId: prepared.environmentId })).state).toBe(
    'ready'
  )
})

it('rejects changed request contents and foreign Session handles', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  await expect(
    fixture.owner.prepare({
      ...scope,
      requestId: 'prepare-1',
      authority: fixture.authority,
      runtime: fixture.runtime,
      materials: { files: [{ versionId: 'script-version', restorePath: 'different.mjs' }] }
    })
  ).rejects.toThrow('conflicts')
  await expect(
    fixture.owner.release({ ...scope, sessionId: 'other', environmentId: prepared.environmentId })
  ).rejects.toThrow('does not belong')
  expect(fixture.dependencies.stopExecution).not.toHaveBeenCalled()
})

it('verifies prepared bytes and rejects extra files before execution', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  const root = join(fixture.root, 'research-environments', prepared.environmentId, 'inputs')
  await writeFile(join(root, 'source/main.mjs'), 'console.log("changed")')
  const execute = vi.fn(async () => 'ran')
  await expect(
    fixture.owner.withExecution(
      { ...scope, environmentId: prepared.environmentId, executionInvocationId: 'invocation' },
      execute
    )
  ).rejects.toThrow('Prepared input')
  expect(execute).not.toHaveBeenCalled()
  await writeFile(join(root, 'source/main.mjs'), 'console.log("offline")')
  await writeFile(join(root, 'source/.env'), 'unreviewed=1')
  await expect(fixture.prepare()).rejects.toThrow('Prepared input')
})

it('rejects input symlinks and hard links before dispatch', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  const root = join(fixture.root, 'research-environments', prepared.environmentId, 'inputs')
  await symlink(fixture.root, join(root, 'extra'))
  await expect(fixture.prepare()).rejects.toThrow('symbolic link')
  await rm(join(root, 'extra'))
  await link(join(root, 'source/main.mjs'), join(fixture.root, 'linked-input'))
  await expect(fixture.prepare()).rejects.toThrow('unsupported filesystem')
})

it('issues a scope-bound per-call capability with explicit roots and no inherited credentials', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  const request = {
    ...scope,
    environmentId: prepared.environmentId,
    executionInvocationId: 'invocation'
  }
  await fixture.owner.withExecution(request, async (context) => {
    const policy = resolveManagedShellExecutionCapability(context.capability, request)
    expect(policy.cwd).toBe(context.workRoot)
    expect(policy.filesystem.readOnlyRoots).toContain(context.inputRoot)
    expect(policy.filesystem.readWriteRoots).toEqual([context.outputRoot, context.workRoot].sort())
    expect(policy.environment.OPEN_SCIENCE_OUTPUT_DIR).toBe(context.outputRoot)
    expect(policy.environment).not.toHaveProperty('OPENAI_API_KEY')
    expect((await fixture.owner.get(request)).activeExecution?.executionInvocationId).toBe(
      'invocation'
    )
    return 'done'
  })
  expect(fixture.dependencies.stopExecution).toHaveBeenCalledWith({
    ...scope,
    executionInvocationId: 'invocation'
  })
  expect((await fixture.owner.get(request)).activeExecution).toBeUndefined()
})

it('refuses runtime-control environment overrides before creating an execution intent', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  const reference = { ...scope, environmentId: prepared.environmentId }
  await expect(
    fixture.owner.withExecution(
      {
        ...reference,
        executionInvocationId: 'invocation',
        environment: { NODE_OPTIONS: '--import evil' }
      },
      async () => undefined
    )
  ).rejects.toThrow('runtime-control')
  expect((await fixture.owner.get(reference)).activeExecution).toBeUndefined()
})

it('retains an environment until the existing owner proves termination and permits retry', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  const reference = { ...scope, environmentId: prepared.environmentId }
  vi.mocked(fixture.dependencies.stopExecution).mockResolvedValue({ verified: false })
  await expect(
    fixture.owner.withExecution(
      {
        ...reference,
        executionInvocationId: 'invocation'
      },
      async () => 'done'
    )
  ).rejects.toThrow('not verified')
  expect((await fixture.owner.get(reference)).state).toBe('cleanup-pending')
  const root = join(fixture.root, 'research-environments', prepared.environmentId)
  expect((await lstat(root)).isDirectory()).toBe(true)
  expect((await fixture.owner.release(reference)).state).toBe('cleanup-pending')
  vi.mocked(fixture.dependencies.stopExecution).mockImplementation(async () => {
    expect((await lstat(root)).isDirectory()).toBe(true)
    return { verified: true }
  })
  expect((await fixture.owner.release(reference)).state).toBe('released')
  await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await fixture.owner.release(reference)).state).toBe('released')
})

it('cancels live execution before removing its directories', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  const reference = { ...scope, environmentId: prepared.environmentId }
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const running = fixture.owner.withExecution(
    { ...reference, executionInvocationId: 'invocation' },
    async ({ signal }) => {
      entered()
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true })
      )
      return 'cancelled'
    }
  )
  await started
  const released = fixture.owner.release(reference)
  expect(await running).toBe('cancelled')
  expect((await released).state).toBe('released')
})

it('preserves replaced or unconfirmed directories during release and recovery', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  const reference = { ...scope, environmentId: prepared.environmentId }
  const root = join(fixture.root, 'research-environments', prepared.environmentId)
  await rename(root, root + '-original')
  await mkdir(root, { mode: 0o700 })
  await writeFile(join(root, 'user-file'), 'keep')
  expect((await fixture.owner.release(reference)).state).toBe('cleanup-pending')
  await new ManagedResearchEnvironmentOwner(fixture.dependencies).recover()
  expect(await readFile(join(root, 'user-file'), 'utf8')).toBe('keep')
})

it('does not create through a replaced storage symlink', async () => {
  const fixture = await setup()
  const foreign = join(fixture.root, 'foreign')
  await mkdir(foreign)
  await symlink(foreign, join(fixture.root, 'research-environments'))
  await expect(fixture.prepare()).rejects.toThrow('private owned storage')
  await expect(lstat(join(foreign, 'receipts'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('preserves a replaced Notebook output container and permits cleanup only after its original identity returns', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  const container = join(
    getNotebookDataRoot(fixture.root, scope.projectId, scope.sessionId),
    'managed-execution',
    prepared.environmentId
  )
  await rename(container, container + '-original')
  await mkdir(container, { mode: 0o700 })
  await writeFile(join(container, 'user-file'), 'not an owned output')
  const execute = vi.fn(async () => undefined)
  await expect(
    fixture.owner.withExecution({ ...prepared, executionInvocationId: 'invocation' }, execute)
  ).rejects.toThrow()
  expect(execute).not.toHaveBeenCalled()
  expect((await fixture.owner.release(prepared)).state).toBe('cleanup-pending')
  await new ManagedResearchEnvironmentOwner(fixture.dependencies).recover()
  expect(await readFile(join(container, 'user-file'), 'utf8')).toBe('not an owned output')
  // Preserve the foreign directory rather than delete it to force the test to pass.
  await rename(container, container + '-foreign')
  await rename(container + '-original', container)
  expect((await fixture.owner.release(prepared)).state).toBe('released')
  await expect(lstat(container)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(container + '-foreign', 'user-file'), 'utf8')).toBe(
    'not an owned output'
  )
})

it('refuses redirected output storage before dispatch or allocation into unrelated directories', async () => {
  const fixture = await setup()
  const foreign = join(fixture.root, 'foreign-notebooks')
  await mkdir(foreign)
  await writeFile(join(foreign, 'keep'), 'untouched')
  await symlink(foreign, join(fixture.root, 'notebooks'))
  await expect(fixture.prepare()).rejects.toThrow('ancestor')
  expect(await readFile(join(foreign, 'keep'), 'utf8')).toBe('untouched')
  await expect(lstat(join(foreign, scope.projectId))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('removes confirmed failed preparation and never marks it ready', async () => {
  const fixture = await setup()
  vi.mocked(fixture.authority.readVersion).mockResolvedValue(Buffer.from('tampered'))
  await expect(fixture.prepare()).rejects.toThrow('verification')
  const receipts = await import('node:fs/promises').then((fs) =>
    fs.readdir(join(fixture.root, 'research-environments/receipts'))
  )
  const receipt = JSON.parse(
    await readFile(join(fixture.root, 'research-environments/receipts', receipts[0]), 'utf8')
  ) as ManagedResearchEnvironment
  expect(receipt.state).toBe('failed')
  await expect(
    lstat(join(fixture.root, 'research-environments', receipt.environmentId))
  ).rejects.toMatchObject({ code: 'ENOENT' })
})

it('recovers an admitted operation without replaying it and keeps ready material inputs', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  const receipt = { ...prepared, activeExecution: { executionInvocationId: 'interrupted' } }
  await writeFile(
    join(fixture.root, 'research-environments/receipts', prepared.environmentId + '.json'),
    JSON.stringify(receipt)
  )
  const restarted = new ManagedResearchEnvironmentOwner(fixture.dependencies)
  await restarted.recover()
  expect(fixture.dependencies.stopExecution).toHaveBeenCalledWith({
    ...scope,
    executionInvocationId: 'interrupted'
  })
  expect((await restarted.get({ ...scope, environmentId: prepared.environmentId })).state).toBe(
    'ready'
  )
  expect(
    (await restarted.get({ ...scope, environmentId: prepared.environmentId })).activeExecution
  ).toBeUndefined()
  expect(fixture.authority.readVersion).toHaveBeenCalledTimes(1)
})

it('revokes output authority when the execution lease settles', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  const request = {
    ...scope,
    environmentId: prepared.environmentId,
    executionInvocationId: 'invocation'
  }
  let authority!: ManagedOutputAuthority
  await fixture.owner.withExecution(request, async (context) => {
    authority = context.createOutputAuthority('operation')
    await writeFile(join(context.outputRoot, 'result.json'), '{}')
    expect(
      (
        await resolveManagedOutputAuthority(
          authority,
          { ...scope, operationId: 'operation' },
          'result.json'
        )
      ).root
    ).toBe(context.outputRoot)
  })
  await expect(
    resolveManagedOutputAuthority(authority, { ...scope, operationId: 'operation' }, 'result.json')
  ).rejects.toThrow('settled')
})

it.runIf(process.platform === 'darwin')(
  'journals a short exact socket directory and stops before removal',
  async () => {
    const fixture = await setup()
    const socketRoot = await realpath(await mkdtemp('/private/tmp/os-env-'))
    roots.push(socketRoot)
    fixture.dependencies.socketRoot = socketRoot
    const prepared = await fixture.prepare()
    const request = {
      ...scope,
      environmentId: prepared.environmentId,
      executionInvocationId: 'invocation'
    }
    let socket = ''
    vi.mocked(fixture.dependencies.stopExecution).mockImplementation(async () => {
      expect((await lstat(join(socket, '..'))).isDirectory()).toBe(true)
      return { verified: true }
    })
    await fixture.owner.withExecution({ ...request, localServicePort: 4173 }, async (context) => {
      const policy = resolveManagedShellExecutionCapability(context.capability, request)
      socket = await policy.localService!.prepareSocket({ runId: 'run-one' })
      expect(socket).toMatch(/os-service-run-one-[a-z0-9]{6}\/service\.sock$/)
      expect(Buffer.byteLength(socket)).toBeLessThanOrEqual(103)
      const record = await fixture.owner.get(request)
      expect(record.activeExecution?.socket?.directory?.inode).toBeGreaterThan(0)
      // The socket destination does not exist before the runtime binds it.
      await expect(lstat(socket)).rejects.toMatchObject({ code: 'ENOENT' })
    })
    await expect(lstat(join(socket, '..'))).rejects.toMatchObject({ code: 'ENOENT' })
  }
)

it('preserves a directory created in the interrupted identity-write window', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  const incomplete = { ...prepared, state: 'preparing', directory: undefined, prepared: undefined }
  await writeFile(
    join(fixture.root, 'research-environments/receipts', prepared.environmentId + '.json'),
    JSON.stringify(incomplete)
  )
  const restarted = new ManagedResearchEnvironmentOwner(fixture.dependencies)
  await restarted.recover()
  const reference = { ...scope, environmentId: prepared.environmentId }
  expect((await restarted.get(reference)).state).toBe('cleanup-pending')
  expect(
    (await lstat(join(fixture.root, 'research-environments', prepared.environmentId))).isDirectory()
  ).toBe(true)
})

it('close aborts execution but keeps prepared material storage for a subsequent process', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  const reference = { ...scope, environmentId: prepared.environmentId }
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const running = fixture.owner.withExecution(
    { ...reference, executionInvocationId: 'invocation' },
    async ({ signal }) => {
      entered()
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true })
      )
    }
  )
  await started
  await fixture.owner.close()
  await running
  expect((await fixture.owner.get(reference)).state).toBe('ready')
  await expect(
    fixture.owner.withExecution(
      { ...reference, executionInvocationId: 'later' },
      async () => undefined
    )
  ).rejects.toThrow('closed')
})

it('releases only the deleted Project environments and leaves unrelated Sessions reusable', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  const anotherSession = await fixture.owner.prepare({
    ...scope,
    sessionId: 'another-receiver',
    requestId: 'prepare-2',
    authority: fixture.authority,
    runtime: fixture.runtime,
    materials: { files: [{ versionId: 'script-version', restorePath: 'main.mjs' }] }
  })
  const anotherProject = await fixture.owner.prepare({
    projectId: 'another-project',
    sessionId: scope.sessionId,
    requestId: 'prepare-3',
    authority: {
      ...fixture.authority,
      source: { ...fixture.authority.source, projectId: 'another-project' }
    },
    runtime: fixture.runtime,
    materials: { files: [{ versionId: 'script-version', restorePath: 'main.mjs' }] }
  })
  await fixture.owner.releaseSession(scope)
  expect((await fixture.owner.get(prepared)).state).toBe('released')
  expect((await fixture.owner.get(anotherSession)).state).toBe('ready')
  await fixture.owner.releaseProject(scope.projectId)
  expect((await fixture.owner.get(anotherSession)).state).toBe('released')
  expect((await fixture.owner.get(anotherProject)).state).toBe('ready')
  await fixture.owner.releaseProject(scope.projectId)
  expect((await fixture.owner.get(anotherProject)).state).toBe('ready')
})

it('releases inode-bound directories before copying receipts and permits fresh preparation afterwards', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  await fixture.owner.prepareForDataRootHandoff()
  expect((await fixture.owner.get(prepared)).state).toBe('released')
  await expect(
    lstat(join(fixture.root, 'research-environments', prepared.environmentId))
  ).rejects.toMatchObject({ code: 'ENOENT' })
  const target = await realpath(await mkdtemp(join(tmpdir(), 'managed-env-moved-')))
  roots.push(target)
  expect(
    await copyAndVerify({
      from: fixture.root,
      to: target,
      dirs: [...MANAGED_EXECUTION_DATA_DIRS],
      signal: new AbortController().signal,
      onProgress: () => undefined
    })
  ).toEqual({ ok: true })
  const restarted = new ManagedResearchEnvironmentOwner({
    ...fixture.dependencies,
    dataRoot: target
  })
  await restarted.recover()
  expect((await restarted.get(prepared)).state).toBe('released')
  // A cancelled migration also leaves the original owner usable; only the old request is spent.
  const replacement = await fixture.owner.prepare({
    ...scope,
    requestId: 'prepare-after-cancel',
    authority: fixture.authority,
    runtime: fixture.runtime,
    materials: { files: [{ versionId: 'script-version', restorePath: 'main.mjs' }] }
  })
  expect(replacement.state).toBe('ready')
})

it('blocks Project deletion and data handoff when directory ownership cannot be proved', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  const directory = join(fixture.root, 'research-environments', prepared.environmentId)
  await rename(directory, directory + '-retained')
  await mkdir(directory, { mode: 0o700 })
  await writeFile(join(directory, 'foreign.txt'), 'preserve')
  await expect(fixture.owner.releaseProject(scope.projectId)).rejects.toThrow('cleanup is pending')
  await expect(fixture.owner.prepareForDataRootHandoff()).rejects.toThrow('before moving data')
  expect((await fixture.owner.get(prepared)).state).toBe('cleanup-pending')
  expect(await readFile(join(directory, 'foreign.txt'), 'utf8')).toBe('preserve')
})

it('waits for admitted material preparation before taking the handoff cleanup snapshot', async () => {
  const fixture = await setup()
  const readVersion = fixture.authority.readVersion
  let entered!: () => void
  let finish!: () => void
  const reading = new Promise<void>((resolve) => {
    entered = resolve
  })
  const blocked = new Promise<void>((resolve) => {
    finish = resolve
  })
  fixture.authority.readVersion = async (...args) => {
    entered()
    await blocked
    return readVersion(...args)
  }
  const preparation = fixture.prepare()
  await reading
  const handoff = fixture.owner.prepareForDataRootHandoff()
  finish()
  const prepared = await preparation
  await handoff
  expect((await fixture.owner.get(prepared)).state).toBe('released')
  await expect(
    lstat(join(fixture.root, 'research-environments', prepared.environmentId))
  ).rejects.toMatchObject({ code: 'ENOENT' })
})

const cancellationGate = (): { promise: Promise<void>; resolve(): void } => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it.each(['release', 'quiesce'] as const)(
  'cancels verification and earlier queued executions before dispatch during %s',
  async (action) => {
    const fixture = await setup()
    const prepared = await fixture.prepare()
    const entered = cancellationGate()
    const finish = cancellationGate()
    vi.mocked(fixture.dependencies.verifyRuntime).mockImplementationOnce(async () => {
      entered.resolve()
      await finish.promise
    })
    const execute = vi.fn(async () => 'must not dispatch')
    const first = fixture.owner.withExecution(
      { ...prepared, executionInvocationId: 'first' },
      execute
    )
    const firstResult = first.catch((error: unknown) => error)
    await entered.promise
    const queued = fixture.owner.withExecution(
      { ...prepared, executionInvocationId: 'queued' },
      execute
    )
    const queuedResult = queued.catch((error: unknown) => error)
    const stopping =
      action === 'release' ? fixture.owner.release(prepared) : fixture.owner.quiesce()
    if (action === 'release') {
      // Wait until the real async scope validation has accepted release, while verification is
      // still blocked. Observe only the cancellation marker; dispatch and cleanup remain real.
      await vi.waitFor(() =>
        expect(
          (Reflect.get(fixture.owner, 'releaseGenerations') as Map<string, number>).get(
            prepared.environmentId
          )
        ).toBe(1)
      )
    }
    expect(execute).not.toHaveBeenCalled()
    finish.resolve()
    expect(await firstResult).toBeInstanceOf(ManagedEnvironmentCancelledError)
    expect(await queuedResult).toBeInstanceOf(ManagedEnvironmentCancelledError)
    await stopping
    expect(execute).not.toHaveBeenCalled()
    expect(fixture.dependencies.stopExecution).not.toHaveBeenCalled()
    expect((await fixture.owner.get(prepared)).activeExecution).toBeUndefined()
    if (action === 'quiesce') {
      // An aborted handoff permits a genuinely new request, never the cancelled queued request.
      await expect(
        fixture.owner.withExecution(
          { ...prepared, executionInvocationId: 'fresh' },
          async () => 'new work'
        )
      ).resolves.toBe('new work')
    } else expect((await fixture.owner.get(prepared)).state).toBe('released')
  }
)

it('rejects a foreign release during verification without cancelling the owning Session', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  const entered = cancellationGate()
  const finish = cancellationGate()
  vi.mocked(fixture.dependencies.verifyRuntime).mockImplementationOnce(async () => {
    entered.resolve()
    await finish.promise
  })
  const execute = vi.fn(async () => 'owned result')
  const running = fixture.owner.withExecution(
    { ...prepared, executionInvocationId: 'owned' },
    execute
  )
  await entered.promise
  await expect(
    fixture.owner.release({ ...prepared, sessionId: 'another-session' })
  ).rejects.toThrow('does not belong')
  finish.resolve()
  await expect(running).resolves.toBe('owned result')
  expect(execute).toHaveBeenCalledOnce()
  expect((await fixture.owner.get(prepared)).state).toBe('ready')
})

it('clears a cancelled durable intent without asking Notebook to stop an execution never dispatched', async () => {
  const fixture = await setup()
  const prepared = await fixture.prepare()
  const entered = cancellationGate()
  const finish = cancellationGate()
  // Preserve the real durable write and pause its acknowledgement, reproducing cancellation in
  // the intent-to-live-registration gap without creating a fake Notebook identity.
  const journal = fixture.owner as unknown as {
    write(receipt: ManagedResearchEnvironment): Promise<void>
  }
  const write = journal.write.bind(fixture.owner)
  vi.spyOn(journal, 'write').mockImplementationOnce(async (receipt) => {
    await write(receipt)
    expect(receipt.activeExecution?.executionInvocationId).toBe('not-dispatched')
    entered.resolve()
    await finish.promise
  })
  const execute = vi.fn(async () => 'must not dispatch')
  const running = fixture.owner.withExecution(
    { ...prepared, executionInvocationId: 'not-dispatched' },
    execute
  )
  const cancelled = running.catch((error: unknown) => error)
  await entered.promise
  const stopping = fixture.owner.quiesce()
  finish.resolve()
  expect(await cancelled).toBeInstanceOf(ManagedEnvironmentCancelledError)
  await stopping
  expect(execute).not.toHaveBeenCalled()
  expect(fixture.dependencies.stopExecution).not.toHaveBeenCalled()
  expect(await fixture.owner.get(prepared)).toMatchObject({ state: 'ready' })
  expect((await fixture.owner.get(prepared)).activeExecution).toBeUndefined()
})
