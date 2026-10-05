import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import {
  createManagedShellExecutionCapability,
  resolveManagedShellExecutionCapability,
  type ManagedShellExecutionCapability
} from './managed-shell-execution'

const scope = { projectId: 'project', sessionId: 'session', executionInvocationId: 'invocation' }
const workspace = join(tmpdir(), 'managed-work')
const inputRoot = join(tmpdir(), 'managed-input')
const elsewhere = join(tmpdir(), 'managed-elsewhere')
const input = (): typeof scope & {
  cwd: string
  environment: { PATH: string; HOME: string }
  filesystem: { readOnlyRoots: string[]; readWriteRoots: string[] }
} => ({
  ...scope,
  cwd: workspace,
  environment: { PATH: '/usr/bin:/bin', HOME: workspace },
  filesystem: { readOnlyRoots: [inputRoot], readWriteRoots: [workspace] }
})

describe('main-owned managed Shell capability', () => {
  it('rejects copies, serialized capabilities and wrong execution owners', () => {
    const capability = createManagedShellExecutionCapability(input())
    for (const forged of [{}, { ...capability }, JSON.parse(JSON.stringify(capability))]) {
      expect(() => resolveManagedShellExecutionCapability(forged, scope)).toThrow('does not belong')
    }
    for (const key of ['projectId', 'sessionId', 'executionInvocationId'] as const) {
      expect(() =>
        resolveManagedShellExecutionCapability(capability, { ...scope, [key]: 'other' })
      ).toThrow('does not belong')
    }
    expect(() =>
      resolveManagedShellExecutionCapability(
        null as unknown as ManagedShellExecutionCapability,
        scope
      )
    ).toThrow('does not belong')
  })

  it('snapshots mutable input and includes the complete policy in a canonical fingerprint', () => {
    const source = input()
    const capability = createManagedShellExecutionCapability(source)
    const captured = resolveManagedShellExecutionCapability(capability, scope)
    source.environment.PATH = '/unexpected'
    source.filesystem.readWriteRoots.push(elsewhere)
    expect(captured.environment.PATH).toBe('/usr/bin:/bin')
    expect(captured.filesystem.readWriteRoots).toEqual([workspace])
    expect(captured.filesystem.deniedWriteRoots).toContain(inputRoot)
    const reordered = input()
    reordered.filesystem.readOnlyRoots.push(inputRoot)
    expect(
      resolveManagedShellExecutionCapability(
        createManagedShellExecutionCapability(reordered),
        scope
      ).fingerprint
    ).toBe(captured.fingerprint)
    expect(
      resolveManagedShellExecutionCapability(createManagedShellExecutionCapability(source), scope)
        .fingerprint
    ).not.toBe(captured.fingerprint)
    expect(
      resolveManagedShellExecutionCapability(
        createManagedShellExecutionCapability({ ...input(), fingerprint: 'material-v2' }),
        scope
      ).fingerprint
    ).not.toBe(captured.fingerprint)
  })

  it('requires explicit writable cwd and keeps transient service authority out of frozen env', () => {
    expect(() => createManagedShellExecutionCapability({ ...input(), cwd: elsewhere })).toThrow(
      'explicit write root'
    )
    expect(() =>
      createManagedShellExecutionCapability({ ...input(), cwd: `${workspace}${sep}..${sep}work` })
    ).toThrow('normalized absolute')
    for (const key of ['OPEN_SCIENCE_SERVICE_SOCKET', 'OPEN_SCIENCE_SERVICE_PORT']) {
      expect(() =>
        createManagedShellExecutionCapability({ ...input(), environment: { [key]: 'secret' } })
      ).toThrow('execution-owned')
    }
  })

  it('requires an explicit writable output root and binds it to the capability fingerprint', () => {
    expect(() =>
      createManagedShellExecutionCapability({ ...input(), outputRoot: elsewhere })
    ).toThrow('explicit writable root')
    expect(() =>
      createManagedShellExecutionCapability({
        ...input(),
        outputRoot: inputRoot,
        filesystem: { readOnlyRoots: [inputRoot], readWriteRoots: [workspace, inputRoot] }
      })
    ).toThrow('explicit writable root')
    const first = resolveManagedShellExecutionCapability(
      createManagedShellExecutionCapability({ ...input(), outputRoot: join(workspace, 'first') }),
      scope
    )
    const second = resolveManagedShellExecutionCapability(
      createManagedShellExecutionCapability({ ...input(), outputRoot: join(workspace, 'second') }),
      scope
    )
    expect(first.outputRoot).toBe(join(workspace, 'first'))
    expect(first.fingerprint).not.toBe(second.fingerprint)
  })

  it('revokes subsequent resolution with the environment owner lifetime', () => {
    const controller = new AbortController()
    const capability = createManagedShellExecutionCapability({
      ...input(),
      signal: controller.signal
    })
    controller.abort(new Error('environment closed'))
    expect(() => resolveManagedShellExecutionCapability(capability, scope)).toThrow(
      'environment closed'
    )
  })
})
