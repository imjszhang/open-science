// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunObservationSnapshot } from '../../../../../shared/run-observation'
import { useSessionReplayStore } from '@/stores/session-replay-store'
import { LiveReplayView, type LiveReplayViewProps } from './LiveReplayView'
import { requestReplaySeek } from './replay-context'

const snapshot = (sequence: number, stdout = `output ${sequence}`): RunObservationSnapshot => ({
  identity: { projectId: 'p', sessionId: 's', operationId: 'operation', runId: 'run' },
  cursor: { epoch: 'epoch', sequence },
  observedAt: 1000 + sequence * 100,
  phase: 'running',
  stepId: 'run:run',
  run: {
    runId: 'run',
    kernelKind: 'bash',
    status: 'running',
    startedAt: 1000,
    logs: {
      stdout: { text: stdout, truncated: false, redacted: false },
      stderr: { text: '', truncated: false, redacted: false },
      traceback: { text: '', truncated: false, redacted: false }
    }
  },
  artifacts: [],
  artifactsTruncated: false
})
const props = (record = snapshot(1)): LiveReplayViewProps => ({
  title: 'Observed study',
  sourceIdentity: 'operation:operation',
  snapshot: record,
  connection: 'connected',
  readResource: vi.fn().mockResolvedValue({ status: 'unavailable' }),
  onAskSelection: vi.fn(),
  onStop: vi.fn()
})

beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {
        /* The unit viewport is fixed. */
      }
      unobserve(): void {
        /* The unit viewport is fixed. */
      }
      disconnect(): void {
        /* No external observer survives. */
      }
    }
  )
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }))
  // This host has no Electron preload. Readers and actions must come from props.
  Object.defineProperty(window, 'api', { configurable: true, value: undefined })
  useSessionReplayStore.setState({ playhead: undefined })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('shared live Replay viewer', () => {
  it('keeps legacy purpose unknown even when a completed run or title suggests reproduction', () => {
    render(
      <LiveReplayView
        {...props({ ...snapshot(1), phase: 'completed' })}
        title="Successful scientific reproduction"
      />
    )
    expect(screen.getByText('Execution purpose not recorded')).toBeTruthy()
    expect(screen.queryByText('Research execution')).toBeNull()
  })

  it('shows verified demo purpose and declared conditions without interpreting them as success', () => {
    render(
      <LiveReplayView
        {...props({
          ...snapshot(1),
          executionContext: {
            purpose: 'offline-demo',
            conditionChanges: ['Recorded provider answers']
          }
        })}
      />
    )
    expect(screen.getByText('Offline demo')).toBeTruthy()
    expect(
      screen.getByText(
        'Offline project demonstration. This does not reproduce the original experiment.'
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByText('Execution conditions'))
    expect(screen.getByText('Recorded provider answers')).toBeTruthy()
  })

  it('distinguishes research intent from successful reproduction and names the recorded configuration', () => {
    render(
      <LiveReplayView
        {...props({
          ...snapshot(1),
          phase: 'completed',
          executionContext: {
            purpose: 'research',
            profileName: 'Recipient account',
            conditionChanges: ['Different model version']
          }
        })}
      />
    )
    expect(screen.getByText('Research execution')).toBeTruthy()
    expect(
      screen.getByText(
        'A research execution is not, by itself, evidence of successful reproduction.'
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByText('Execution conditions'))
    expect(screen.getByText('Recorded configuration: Recipient account')).toBeTruthy()
    expect(screen.getByText('Different model version')).toBeTruthy()
  })

  it('follows real revisions without replacing its viewport and never exposes a simulated clock', async () => {
    const first = props()
    const view = render(<LiveReplayView {...first} />)
    expect(screen.getByText('output 1')).toBeTruthy()
    const viewport = screen.getByRole('region', { name: 'Execution record' })
    view.rerender(
      <LiveReplayView {...first} snapshot={snapshot(2)} history={[first.snapshot, snapshot(2)]} />
    )
    expect(screen.getByText('output 2')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Execution record' })).toBe(viewport)
    expect(screen.queryByRole('slider', { name: 'Replay progress' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Playback speed' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Play replay' })).toBeNull()
    expect(first.onStop).not.toHaveBeenCalled()
  })

  it('freezes logs and exact cursor on inspection while later records arrive, then resumes explicitly', async () => {
    const first = props()
    const view = render(<LiveReplayView {...first} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause following' }))
    const paused = screen.getByRole('button', { name: 'Back to live' })
    paused.focus()
    view.rerender(
      <LiveReplayView {...first} snapshot={snapshot(2)} history={[first.snapshot, snapshot(2)]} />
    )
    expect(screen.getByText('output 1')).toBeTruthy()
    expect(screen.queryByText('output 2')).toBeNull()
    expect(document.activeElement).toBe(paused)
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this step' }))
    expect(first.onAskSelection).toHaveBeenCalledWith(first.snapshot)
    expect(first.onStop).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Back to live' }))
    expect(screen.getByText('output 2')).toBeTruthy()
  })

  it('manual wheel inspection freezes output without cancelling or moving a focused control', () => {
    const first = props()
    const view = render(<LiveReplayView {...first} />)
    const viewport = screen.getByRole('region', { name: 'Execution record' })
    fireEvent.wheel(viewport, { deltaY: -10 })
    view.rerender(<LiveReplayView {...first} snapshot={snapshot(2)} />)
    expect(screen.getByText('output 1')).toBeTruthy()
    expect(
      screen.getByText('Viewing is paused. The experiment continues independently.')
    ).toBeTruthy()
    expect(first.onStop).not.toHaveBeenCalled()
  })

  it('keeps a live project page mounted across revisions and blocks it during inspection, disconnect and completion', () => {
    const first = props()
    const surface = { runId: 'run', content: <iframe title="Current project" src="about:blank" /> }
    const view = render(<LiveReplayView {...first} runtimeSurface={surface} />)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Project interface' }))
    fireEvent.click(screen.getByRole('button', { name: 'Project interface' }))
    const frame = screen.getByTitle('Current project')
    view.rerender(<LiveReplayView {...first} snapshot={snapshot(2)} runtimeSurface={surface} />)
    expect(screen.getByTitle('Current project')).toBe(frame)
    fireEvent.click(screen.getByRole('button', { name: 'Pause following' }))
    expect(screen.getByTitle('Current project')).toBe(frame)
    expect(frame.closest('[inert]')).not.toBeNull()
    expect(
      screen.getByText(
        'No project screen was recorded for this step. The current live page is not historical evidence.'
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to live' }))
    expect(screen.getByTitle('Current project')).toBe(frame)
    fireEvent.click(screen.getByRole('button', { name: 'Execution record' }))
    expect(screen.getByTitle('Current project')).toBe(frame)
    expect(frame.closest('[hidden]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Project interface' }))
    expect(screen.getByTitle('Current project')).toBe(frame)
    view.rerender(
      <LiveReplayView
        {...first}
        snapshot={snapshot(3)}
        runtimeSurface={surface}
        connection="reconnecting"
      />
    )
    expect(screen.queryByTitle('Current project')).toBeNull()
    view.rerender(
      <LiveReplayView
        {...first}
        snapshot={{ ...snapshot(4), phase: 'completed' }}
        runtimeSurface={surface}
      />
    )
    expect(screen.queryByTitle('Current project')).toBeNull()
    expect(screen.getByText('Run history')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pause following' })).toBeNull()
  })

  it('never mounts a page belonging to another run', () => {
    render(
      <LiveReplayView
        {...props()}
        runtimeSurface={{ runId: 'wrong-run', content: <iframe title="Wrong project" /> }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Project interface' }))
    expect(screen.queryByTitle('Wrong project')).toBeNull()
  })

  it.each(['reconnecting', 'disconnected', 'recorded', 'history'] as const)(
    'never activates a current project lease from a %s surface',
    (mode) => {
      const onOpen = vi.fn()
      const first = props(snapshot(2))
      render(
        <LiveReplayView
          {...first}
          history={[snapshot(1), snapshot(2)]}
          recorded={mode === 'recorded'}
          connection={mode === 'reconnecting' || mode === 'disconnected' ? mode : 'connected'}
          projectActivation={{ opening: false, onOpen }}
        />
      )
      if (mode === 'history') fireEvent.click(screen.getByRole('button', { name: 'Previous step' }))
      fireEvent.click(screen.getByRole('button', { name: 'Project interface' }))
      expect(onOpen).not.toHaveBeenCalled()
    }
  )

  it('history selection reads only the selected actual snapshot, including after that revision leaves the incoming buffer', async () => {
    const one = snapshot(1),
      two = snapshot(2)
    const first = props(two)
    const view = render(<LiveReplayView {...first} history={[one, two]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Previous step' }))
    expect(screen.getByText('output 1')).toBeTruthy()
    view.rerender(
      <LiveReplayView {...first} snapshot={snapshot(4)} history={[snapshot(3), snapshot(4)]} />
    )
    expect(screen.getByText('output 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this step' }))
    expect(first.onAskSelection).toHaveBeenCalledWith(one)
  })

  it('isolates two viewers and ignores historical-session global seek events', () => {
    const first = props(),
      second = props()
    render(
      <>
        <LiveReplayView {...first} />
        <LiveReplayView {...second} />
      </>
    )
    const viewers = screen.getAllByTestId('live-replay-view')
    fireEvent.click(within(viewers[0]).getByRole('button', { name: 'Pause following' }))
    expect(within(viewers[1]).getByRole('button', { name: 'Pause following' })).toBeTruthy()
    act(() =>
      requestReplaySeek({
        projectId: 'p',
        sourceSessionId: 's',
        branchId: 'historical',
        stepId: 'old'
      })
    )
    expect(screen.queryByText('The referenced step is no longer available.')).toBeNull()
    expect(useSessionReplayStore.getState().playhead).toBeUndefined()
    fireEvent.click(within(viewers[0]).getByRole('button', { name: 'Ask about this step' }))
    expect(first.onAskSelection).toHaveBeenCalledTimes(1)
    expect(second.onAskSelection).not.toHaveBeenCalled()
  })

  it('stop requests are explicit, deduplicated and do not claim termination until actual evidence arrives', async () => {
    const first = props()
    const view = render(<LiveReplayView {...first} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop run' }))
    await waitFor(() => expect(first.onStop).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Waiting for the run to stop…' })).toHaveProperty(
      'disabled',
      true
    )
    expect(screen.getByTestId('observation-phase').textContent).toBe('Running')
    view.rerender(<LiveReplayView {...first} snapshot={{ ...snapshot(2), phase: 'cancelled' }} />)
    expect(screen.getByTestId('observation-phase').textContent).toBe('Cancelled')
    expect(screen.queryByRole('button', { name: 'Waiting for the run to stop…' })).toBeNull()
    view.unmount()
    expect(first.onStop).toHaveBeenCalledTimes(1)
  })

  it('shows failed selection feedback without silently selecting a newer snapshot', async () => {
    const first = props()
    first.onAskSelection = vi.fn().mockRejectedValue(new Error('expired'))
    render(<LiveReplayView {...first} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this step' }))
    await screen.findByText('Could not reference this recorded step.')
    expect(first.onAskSelection).toHaveBeenCalledTimes(1)
    expect(screen.getByText('output 1')).toBeTruthy()
  })

  it('rejects mixed-run history before rendering or requesting resources', () => {
    const first = props()
    render(
      <LiveReplayView
        {...first}
        history={[{ ...snapshot(0), identity: { ...snapshot(0).identity, runId: 'foreign' } }]}
      />
    )
    expect(
      screen.getByText('Observation records do not match this run. Reconnect to load a fresh view.')
    ).toBeTruthy()
    expect(first.readResource).not.toHaveBeenCalled()
    expect(first.onAskSelection).not.toHaveBeenCalled()
  })
  it('scrollbar movement pauses following and later logs preserve the viewport position', () => {
    const first = props()
    const view = render(<LiveReplayView {...first} />)
    const viewport = screen.getByRole('region', { name: 'Execution record' })
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 100 }
    })
    viewport.scrollTop = 900
    fireEvent.scroll(viewport)
    viewport.scrollTop = 200
    fireEvent.scroll(viewport)
    view.rerender(<LiveReplayView {...first} snapshot={snapshot(2)} />)
    expect(screen.getByText('output 1')).toBeTruthy()
    expect(viewport.scrollTop).toBe(200)
    expect(first.onStop).not.toHaveBeenCalled()
  })

  it('keeps an inspected file at its exact Version while newer results are published', async () => {
    const one = {
      ...snapshot(1),
      artifacts: [{ versionId: 'version-1', name: 'first.txt', producerRunId: 'run' }]
    }
    const two = {
      ...snapshot(2),
      artifacts: [
        ...one.artifacts,
        { versionId: 'version-2', name: 'second.txt', producerRunId: 'run' }
      ]
    }
    const first = props(one)
    first.readResource = vi.fn(async (resource) => ({
      status: 'ready' as const,
      kind: 'text' as const,
      content: `exact bytes ${resource.versionId}`,
      mimeType: 'text/plain',
      truncated: false
    }))
    const view = render(<LiveReplayView {...first} />)
    fireEvent.click(screen.getByRole('button', { name: 'View files' }))
    fireEvent.click(screen.getByRole('button', { name: 'first.txt' }))
    await screen.findByText('exact bytes version-1')
    view.rerender(<LiveReplayView {...first} snapshot={two} history={[one, two]} />)
    expect(screen.getByText('exact bytes version-1')).toBeTruthy()
    expect(screen.queryByText('exact bytes version-2')).toBeNull()
    expect(first.readResource).not.toHaveBeenCalledWith(
      expect.objectContaining({ versionId: 'version-2' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this step' }))
    expect(first.onAskSelection).toHaveBeenCalledWith(one)
  })

  it('a source replacement resets private inspection and a former run cannot supply the project page', () => {
    const first = props()
    const view = render(
      <LiveReplayView
        {...first}
        runtimeSurface={{ runId: 'run', content: <iframe title="Original project" /> }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Pause following' }))
    const changed = {
      ...snapshot(1, 'new source'),
      identity: { projectId: 'p', sessionId: 's', operationId: 'new-operation', runId: 'new-run' },
      run: { ...snapshot(1, 'new source').run!, runId: 'new-run' }
    }
    view.rerender(
      <LiveReplayView
        {...first}
        sourceIdentity="operation:new-operation"
        snapshot={changed}
        runtimeSurface={{ runId: 'run', content: <iframe title="Original project" /> }}
      />
    )
    expect(screen.getByText('new source')).toBeTruthy()
    expect(screen.queryByText('output 1')).toBeNull()
    expect(screen.getByRole('button', { name: 'Pause following' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Project interface' }))
    expect(screen.queryByTitle('Original project')).toBeNull()
  })

  it('a failed stop request is retryable and never changes the actual status', async () => {
    const first = props()
    first.onStop = vi.fn().mockRejectedValue(new Error('offline'))
    render(<LiveReplayView {...first} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop run' }))
    await screen.findByText('Could not request the run to stop.')
    expect(screen.getByTestId('observation-phase').textContent).toBe('Running')
    expect(screen.getByRole('button', { name: 'Stop run' })).toHaveProperty('disabled', false)
    expect(first.onStop).toHaveBeenCalledTimes(1)
  })

  it('does not repeat an asynchronous question while its exact selection is being saved', async () => {
    let finish: (() => void) | undefined
    const first = props()
    first.onAskSelection = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    render(<LiveReplayView {...first} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this step' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this step' }))
    expect(first.onAskSelection).toHaveBeenCalledTimes(1)
    await act(async () => finish?.())
    expect(screen.getByRole('button', { name: 'Ask about this step' })).toHaveProperty(
      'disabled',
      false
    )
  })
  it('archived running snapshots are history and cannot resume a live project or request a stop', () => {
    const first = props()
    render(
      <LiveReplayView
        {...first}
        recorded
        connection="disconnected"
        historyTruncated
        runtimeSurface={{ runId: 'run', content: <iframe title="Live project" /> }}
      />
    )
    expect(screen.getByText('Run history')).toBeTruthy()
    expect(screen.queryByText('Live connection unavailable')).toBeNull()
    expect(screen.getByText('Recorded run: Running')).toBeTruthy()
    expect(
      screen.getByText('Earlier observed records are no longer available in this view.')
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop run' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pause following' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Project interface' }))
    expect(screen.queryByTitle('Live project')).toBeNull()
    expect(first.onStop).not.toHaveBeenCalled()
  })
  it('saving a question never blocks the independent stop action', async () => {
    const first = props()
    let finish: (() => void) | undefined
    first.onAskSelection = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    render(<LiveReplayView {...first} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this step' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop run' }))
    await waitFor(() => expect(first.onStop).toHaveBeenCalledTimes(1))
    await act(async () => finish?.())
  })
})
