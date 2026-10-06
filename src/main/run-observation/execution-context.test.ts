import { describe, expect, it } from 'vitest'
import { buildRunObservationArchive } from './archive'
import { readCollectionExecutionContext } from './execution-context'
import type { RunObservationSnapshot } from '../../shared/run-observation'

const snapshot: RunObservationSnapshot = {
  identity: { projectId: 'p', sessionId: 's', runId: 'r', executionInvocationId: 'i' },
  cursor: { epoch: 'e', sequence: 0 },
  observedAt: 20,
  phase: 'completed',
  stepId: 'run:r',
  artifacts: [],
  artifactsTruncated: false,
  executionContext: { purpose: 'research', conditionChanges: ['smaller input'] },
  run: {
    runId: 'r',
    executionInvocationId: 'i',
    kernelKind: 'bash',
    status: 'completed',
    startedAt: 10,
    logs: {
      stdout: { text: '', truncated: false, redacted: false },
      stderr: { text: '', truncated: false, redacted: false },
      traceback: { text: '', truncated: false, redacted: false }
    }
  }
}
const archive = buildRunObservationArchive({
  recordingId: 'recording',
  capturedAt: 20,
  history: { coverage: 'process-local', truncated: false, snapshots: [snapshot] },
  stopReason: 'run-ended'
})
const receipt = {
  kind: 'managed-research-execution',
  version: 1,
  purpose: 'offline-demo',
  result: {
    runId: 'r',
    executionInvocationId: 'i',
    observation: { recordingId: 'recording', versionId: 'v' }
  }
}
const read = (value: unknown): ReturnType<typeof readCollectionExecutionContext> =>
  readCollectionExecutionContext(Buffer.from(JSON.stringify(value)), archive)
describe('recorded public collection context', () => {
  it('leaves archive v1 unchanged and does not interpret process completion as research success', () => {
    expect(archive.records[0]).not.toHaveProperty('executionContext')
    expect(archive.version).toBe(1)
    expect(read(receipt)).toEqual({ purpose: 'offline-demo', conditionChanges: [] })
    expect(read({ ...receipt, purpose: undefined })).toEqual({
      purpose: 'unknown',
      conditionChanges: []
    })
  })
  it('requires exact format, source Run, invocation and recording membership', () => {
    for (const invalid of [
      { ...receipt, kind: 'other' },
      { ...receipt, version: 2 },
      { ...receipt, purpose: 'success' },
      { ...receipt, result: { ...receipt.result, runId: 'other' } },
      { ...receipt, result: { ...receipt.result, executionInvocationId: 'other' } },
      {
        ...receipt,
        result: {
          ...receipt.result,
          observation: { ...receipt.result.observation, recordingId: 'other' }
        }
      },
      { ...receipt, result: { ...receipt.result, observation: undefined } }
    ])
      expect(read(invalid)).toBeUndefined()
  })
  it('projects bounded condition differences and omits configuration and local paths', () => {
    expect(
      read({
        ...receipt,
        purpose: 'research',
        executionProfile: {
          profileId: 'not-a-live-reference',
          variables: { KEY: 'not-projected' },
          displayName: 'Small baseline',
          conditionChanges: ['half the samples', 'input /Users/alice/data']
        }
      })
    ).toEqual({
      purpose: 'research',
      profileName: 'Small baseline',
      conditionChanges: ['half the samples', 'input [local path]']
    })
    expect(
      read({
        ...receipt,
        executionProfile: { displayName: 'x', conditionChanges: Array(33).fill('x') }
      })
    ).toBeUndefined()
  })
})
