// @vitest-environment jsdom
import { StrictMode, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunObservationSelection } from '../../../../shared/run-observation'
import type { RunObservationViewerAccess } from '../../../../shared/run-observation-viewer'
import { RunObservationPreview } from './RunObservationPreview'
import { useRunObservationQuestion } from './use-run-observation-question'
import { useRunObservationQuestionStore } from '@/stores/run-observation-question-store'
import type { ComposerDoc } from './composer/composer-doc'
const target = { projectId: 'p', sessionId: 's', runId: 'run' }
const access = (viewerId = 'viewer', scope = target): RunObservationViewerAccess => ({
  viewerId,
  target: scope,
  expiresAt: 999999,
  url: `http://viewer-${viewerId}.localhost:56789/__open_science_viewer?grant=${'a'.repeat(64)}`
})
const selected = (): RunObservationSelection => ({
  selectionId: 'selected',
  identity: target,
  cursor: { epoch: 'e', sequence: 1 },
  stepId: 'run:run',
  selectedAt: 3000,
  snapshot: {
    identity: target,
    cursor: { epoch: 'e', sequence: 1 },
    observedAt: 2000,
    phase: 'running',
    stepId: 'run:run',
    run: {
      runId: 'run',
      status: 'running',
      kernelKind: 'bash',
      startedAt: 1000,
      logs: {
        stdout: { text: 'real log', truncated: false, redacted: false },
        stderr: { text: '', truncated: false, redacted: false },
        traceback: { text: '', truncated: false, redacted: false }
      }
    },
    artifacts: [],
    artifactsTruncated: false
  }
})
const install = (): {
  open: ReturnType<typeof vi.fn>
  selection: ReturnType<typeof vi.fn>
  revoke: ReturnType<typeof vi.fn>
} => {
  const api = {
    open: vi.fn().mockResolvedValue(access()),
    selection: vi.fn().mockResolvedValue(null),
    revoke: vi.fn().mockResolvedValue(undefined)
  }
  Object.defineProperty(window, 'api', { configurable: true, value: { observations: api } })
  return api
}
const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('desktop scoped Run observation preview', () => {
  it('acknowledges a selected step only after the current composer has accepted it', async () => {
    const api = install()
    api.selection.mockResolvedValue(selected())
    const Harness = (): React.JSX.Element => {
      const [doc, setDoc] = useState<ComposerDoc>({
        nodes: [{ type: 'text', text: 'Existing draft' }]
      })
      useRunObservationQuestion({
        projectId: 'p',
        sessionId: 's',
        draftKey: 'draft',
        editable: true,
        doc,
        changeDoc: setDoc
      })
      return (
        <>
          <div data-testid="actual-draft">{JSON.stringify(doc)}</div>
          <RunObservationPreview
            target={target}
            title="Run viewer"
            isActive
            onAskSelection={(snapshot) => {
              if (!useRunObservationQuestionStore.getState().ask(snapshot))
                throw new Error('Unavailable draft')
            }}
          />
        </>
      )
    }
    render(<Harness />)
    await screen.findByText('Selected step added to the current draft. Review it before sending.')
    expect(screen.getByTestId('actual-draft').textContent).toContain('Existing draft')
    expect(screen.getByTestId('actual-draft').textContent).toContain('real log')
  })
  it('offers guarded source navigation after a locked draft rejects a question, without silently navigating', async () => {
    const api = install(),
      openSource = vi.fn()
    api.selection.mockResolvedValue(selected())
    render(
      <RunObservationPreview
        target={target}
        title="Run viewer"
        isActive
        onAskSelection={() => {
          throw new Error('Locked')
        }}
        questionRecovery={{ label: 'Open source Session', onClick: openSource }}
      />
    )
    const button = await screen.findByRole('button', { name: 'Open source Session' })
    expect(openSource).not.toHaveBeenCalled()
    expect(
      screen.queryByText('Selected step added to the current draft. Review it before sending.')
    ).toBeNull()
    fireEvent.click(button)
    await waitFor(() => expect(openSource).toHaveBeenCalledOnce())
  })
  it('keeps its one-use iframe across equivalent target, title and active changes, then revokes on close', async () => {
    const api = install()
    const view = render(<RunObservationPreview target={target} title="Run viewer" isActive />)
    const frame = await screen.findByTitle('Run viewer')
    view.rerender(
      <RunObservationPreview target={{ ...target }} title="Changed title" isActive={false} />
    )
    expect(screen.getByTitle('Changed title')).toBe(frame)
    expect(api.open).toHaveBeenCalledTimes(1)
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms')
    view.unmount()
    expect(api.revoke).toHaveBeenCalledExactlyOnceWith({ viewerId: 'viewer' })
  })
  it('revokes a StrictMode open that arrives after cleanup without replacing the current iframe', async () => {
    const api = install(),
      first = deferred<RunObservationViewerAccess>(),
      second = deferred<RunObservationViewerAccess>()
    api.open.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const view = render(
      <StrictMode>
        <RunObservationPreview target={target} title="Run viewer" isActive />
      </StrictMode>
    )
    expect(api.open).toHaveBeenCalledTimes(2)
    await act(async () => {
      second.resolve(access('second'))
    })
    const frame = screen.getByTitle('Run viewer')
    await act(async () => {
      first.resolve(access('first'))
    })
    expect(screen.getByTitle('Run viewer')).toBe(frame)
    expect(api.revoke).toHaveBeenCalledWith({ viewerId: 'first' })
    expect(frame.getAttribute('src')).toContain('viewer-second.localhost')
    view.unmount()
    expect(api.revoke).toHaveBeenCalledWith({ viewerId: 'second' })
  })
  it('delivers only an explicitly selected server snapshot and never repeats a selection', async () => {
    const api = install(),
      onAsk = vi.fn()
    api.selection.mockResolvedValueOnce(null).mockResolvedValue(selected())
    render(
      <RunObservationPreview target={target} title="Run viewer" isActive onAskSelection={onAsk} />
    )
    await screen.findByTitle('Run viewer')
    expect(onAsk).not.toHaveBeenCalled()
    await waitFor(() => expect(onAsk).toHaveBeenCalledExactlyOnceWith(selected(), 'viewer'), {
      timeout: 2000
    })
    await waitFor(() => expect(api.selection.mock.calls.length).toBeGreaterThanOrEqual(3), {
      timeout: 2000
    })
    expect(onAsk).toHaveBeenCalledTimes(1)
    expect(api.selection.mock.calls.every(([request]) => request.viewerId === 'viewer')).toBe(true)
  })
  it('ignores a selected result after navigation to another Run and revokes the old scope', async () => {
    const api = install(),
      pending = deferred<RunObservationSelection | null>(),
      onAsk = vi.fn()
    api.selection.mockReturnValueOnce(pending.promise)
    api.open
      .mockResolvedValueOnce(access())
      .mockResolvedValueOnce(access('next', { ...target, runId: 'next' }))
    const view = render(
      <RunObservationPreview target={target} title="Run viewer" isActive onAskSelection={onAsk} />
    )
    await waitFor(() => expect(api.selection).toHaveBeenCalled())
    view.rerender(
      <RunObservationPreview
        target={{ ...target, runId: 'next' }}
        title="Next viewer"
        isActive
        onAskSelection={onAsk}
      />
    )
    await screen.findByTitle('Next viewer')
    await act(async () => {
      pending.resolve(selected())
    })
    expect(onAsk).not.toHaveBeenCalled()
    expect(api.revoke).toHaveBeenCalledWith({ viewerId: 'viewer' })
  })
  it('rejects a foreign selection and an unscoped iframe admission', async () => {
    const api = install(),
      onAsk = vi.fn(),
      foreign = { ...selected(), identity: { ...target, sessionId: 'elsewhere' } }
    api.selection.mockResolvedValue(foreign)
    const view = render(
      <RunObservationPreview target={target} title="Run viewer" isActive onAskSelection={onAsk} />
    )
    await screen.findByText('Could not reference this recorded step.')
    expect(onAsk).not.toHaveBeenCalled()
    view.unmount()
    api.open.mockResolvedValue({ ...access(), url: 'https://example.com/' })
    render(<RunObservationPreview target={target} title="Rejected" isActive />)
    await screen.findByText('Could not open the research viewer.')
    expect(screen.queryByTitle('Rejected')).toBeNull()
    expect(api.revoke).toHaveBeenCalledWith({ viewerId: 'viewer' })
  })
})

it('dispatches repeated recorded Ask actions by server selection identity, never by the author Run', async () => {
  const live = install(),
    receiving = { projectId: 'p', sessionId: 'imported', artifactId: 'a', versionId: 'v' }
  const captured = {
    kind: 'recorded-run-observation' as const,
    selectionId: 'ask-1',
    selectedAt: 1000,
    receiving,
    recordingId: 'recording',
    stepKey: 'step',
    mediaKeys: [],
    record: {
      stepKey: 'step',
      observedAt: 500,
      phase: 'completed' as const,
      sourceEvidence: {
        identity: { projectId: 'author-p', sessionId: 'author-s', runId: 'author-run' },
        cursor: { epoch: 'author-e', sequence: 0 },
        stepId: 'author-step'
      },
      run: null,
      artifactEvidence: [],
      artifactsTruncated: false
    }
  }
  const openRecorded = vi
    .fn()
    .mockResolvedValue({ ...access(), target: receiving, mode: 'recorded' })
  const recordingSelection = vi.fn().mockResolvedValue(null),
    onAsk = vi.fn()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { observations: { ...live, openRecorded, recordingSelection } }
  })
  render(
    <RunObservationPreview
      mode="recorded"
      target={receiving}
      title="Archive viewer"
      isActive
      onAskArchiveSelection={onAsk}
    />
  )
  await screen.findByTitle('Archive viewer')
  expect(onAsk).not.toHaveBeenCalled()
  recordingSelection.mockResolvedValue(captured)
  await waitFor(() => expect(onAsk).toHaveBeenCalledTimes(1), { timeout: 2000 })
  recordingSelection.mockResolvedValue({ ...captured, selectionId: 'ask-2', selectedAt: 1100 })
  await waitFor(() => expect(onAsk).toHaveBeenCalledTimes(2), { timeout: 2000 })
  expect(onAsk.mock.calls.map(([value]) => value.selectionId)).toEqual(['ask-1', 'ask-2'])
  expect(live.open).not.toHaveBeenCalled()
  expect(live.selection).not.toHaveBeenCalled()
  expect(openRecorded).toHaveBeenCalledExactlyOnceWith({ target: receiving })
})
