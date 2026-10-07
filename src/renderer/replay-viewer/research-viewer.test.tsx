// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResearchReplayViewerApp } from './ResearchReplayViewerApp'
import { researchPosition } from './research-materials'
import { ResearchReplayClient } from './research-client'
import type { ResearchReplayViewerContext } from './client'
import { ReplayViewerClient } from './client'
import { useViewerObservation } from './use-viewer-observation'
import { renderHook } from '@testing-library/react'
import {
  researchFixture,
  researchRecordingFixture,
  researchSelectionFixture
} from './research-replay.test-support'
import { createResearchReplayTimeline } from '../src/lib/replay/recorded-time'
import { useSessionReplayStore } from '../src/stores/session-replay-store'

const context: ResearchReplayViewerContext = {
  mode: 'research',
  viewerId: 'research-viewer',
  target: { projectId: 'local-project', sessionId: 'local-session' },
  expiresAt: 123456,
  canInteract: false,
  canCancel: false,
  canReadArtifacts: true,
  presentation: 'browser'
}
const json = (value: unknown): Response =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {
        /* No layout observer in jsdom. */
      }
      unobserve(): void {
        /* No layout observer in jsdom. */
      }
      disconnect(): void {
        /* No layout observer in jsdom. */
      }
    }
  )
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }))
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  sessionStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function makeClient(
  research = researchFixture(),
  recording = researchRecordingFixture()
): {
  client: ResearchReplayClient
  fetcher: ReturnType<typeof vi.fn<typeof fetch>>
} {
  const fetcher = vi.fn<typeof fetch>(async (path, options) => {
    if (path === '/api/research/document') return json(research)
    if (path === '/api/research/selection') return json(null)
    if (path === '/api/research/read') return json(recording)
    if (path === '/api/research/select')
      return json(researchSelectionFixture(research.document, JSON.parse(String(options?.body))))
    throw new Error(`Unexpected endpoint ${path}`)
  })
  return { client: new ResearchReplayClient(fetcher), fetcher }
}
const seek = (time: number): void => {
  const slider = screen.getByRole('slider', { name: 'Replay progress' })
  const track = screen.getByTestId('replay-progress-track')
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 32))
  track.setPointerCapture = vi.fn()
  track.hasPointerCapture = () => true
  track.releasePointerCapture = vi.fn()
  const clientX = (time / Number(slider.getAttribute('aria-valuemax'))) * 1000
  fireEvent.pointerDown(track, { clientX, button: 0 })
  fireEvent.pointerUp(track, { clientX, button: 0 })
}

describe('complete browser research Replay', () => {
  it('routes research without polling live observations or recording controls', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json(context))
    const client = new ReplayViewerClient(fetcher)
    const { result } = renderHook(() => useViewerObservation(client, 0))
    await waitFor(() => expect(result.current.connection).toBe('connected'))
    expect(result.current.context).toEqual(context)
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/context'])
  })
  it('shows conversation context, independent materials and one clock without a desktop API', async () => {
    const { client, fetcher } = makeClient()
    const oldPlayhead = useSessionReplayStore.getState().playhead
    render(<ResearchReplayViewerApp context={context} client={client} />)
    await screen.findByTestId('research-replay-viewer')
    expect(
      screen.getByRole('slider', { name: 'Replay progress' }).getAttribute('aria-valuemax')
    ).toBe('10000')
    expect(screen.getAllByText('Compare fruit collection decisions.').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: 'Project replay' }))
    await screen.findByText('The project recording has not started yet.')
    expect(screen.getAllByRole('slider')).toHaveLength(1)
    expect(screen.queryByLabelText('Recorded webpage')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Jump to recorded footage' }))
    await screen.findByLabelText('Recorded webpage')
    expect(
      screen.getByRole('slider', { name: 'Replay progress' }).getAttribute('aria-valuenow')
    ).toBe('2000')
    fireEvent.click(screen.getByRole('tab', { name: 'Results' }))
    expect(
      screen.getByRole('slider', { name: 'Replay progress' }).getAttribute('aria-valuenow')
    ).toBe('2000')
    expect(
      screen.getByRole('slider', { name: 'Replay progress' }).getAttribute('aria-valuemax')
    ).toBe('10000')
    expect(useSessionReplayStore.getState().playhead).toBe(oldPlayhead)
    expect(
      fetcher.mock.calls
        .map(([path]) => String(path))
        .every((path) => path.startsWith('/api/research/'))
    ).toBe(true)
  })
  it('preserves source-owned branch attribution and trailing duration after technical publication steps were removed', async () => {
    const research = researchFixture()
    const recording = researchRecordingFixture()
    recording.recording.startedAt = 20000
    const main = research.document.branches[0]
    const resource = {
      id: 'published-index',
      source: 'artifact' as const,
      name: 'index.json',
      ...recording.receiving,
      availability: 'recorded' as const
    }
    research.document.resources.push(resource)
    main.steps.push({
      id: 'technical-publication',
      branchId: main.id,
      kind: 'artifact',
      recordedAt: 27000,
      startMs: 0,
      endMs: 0,
      durationMs: 0,
      evidence: [],
      activities: [],
      runs: [],
      resourceIds: [resource.id],
      issues: []
    })
    research.document.branches.push({
      ...structuredClone(main),
      id: 'other',
      steps: main.steps
        .filter((step) => step.id !== 'technical-publication')
        .map((step) => ({ ...step, id: `other-${step.id}`, branchId: 'other' }))
    })
    // The service associates this exact index publication with main before suppressing it.
    const original = createResearchReplayTimeline(research.document, [recording], [resource.id])
    research.document = original.document
    research.supportingResourceIds = [...original.supportingResourceIds]
    research.timing = {
      recordedTimeOrigins: original.recordedTimeOrigins,
      coverage: original.coverage,
      timelineCoverage: original.timelineCoverage,
      unalignedBranchIds: original.unalignedBranchIds
    }
    expect(
      research.document.branches[0].steps.some((step) => step.id === 'technical-publication')
    ).toBe(false)
    expect(research.document.branches[0].durationMs).toBe(26000)
    expect(research.timing.coverage.main).toHaveLength(1)
    // Reprojection cannot recover the suppressed evidence and is deliberately non-idempotent.
    const repeated = createResearchReplayTimeline(
      research.document,
      [recording],
      research.supportingResourceIds
    )
    expect(repeated.coverage.main).toEqual([])
    expect(repeated.document.branches[0].durationMs).toBe(10000)
    const { client } = makeClient(research, recording)
    render(<ResearchReplayViewerApp context={context} client={client} />)
    await screen.findByTestId('research-replay-viewer')
    expect(
      screen.getByRole('slider', { name: 'Replay progress' }).getAttribute('aria-valuemax')
    ).toBe('26000')
    fireEvent.click(screen.getByRole('tab', { name: 'Project replay' }))
    await screen.findByText('The project recording has not started yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Jump to recorded footage' }))
    await screen.findByLabelText('Recorded webpage')
    expect(
      screen.getByRole('slider', { name: 'Replay progress' }).getAttribute('aria-valuenow')
    ).toBe('19000')
    expect(
      screen.getByRole('slider', { name: 'Replay progress' }).getAttribute('aria-valuemax')
    ).toBe('26000')
    fireEvent.click(screen.getByRole('tab', { name: 'Results' }))
    expect(
      screen.getByRole('slider', { name: 'Replay progress' }).getAttribute('aria-valuemax')
    ).toBe('26000')
  })
  it('freezes a selected step while later navigation continues and restores only this viewer', async () => {
    const { client } = makeClient()
    const view = render(<ResearchReplayViewerApp context={context} client={client} />)
    await screen.findByTestId('research-replay-viewer')
    seek(4500)
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this record' }))
    fireEvent.click(await screen.findByText('Saved reference details'))
    const reference = (await screen.findByRole('textbox', {
      name: 'Recorded step reference'
    })) as HTMLTextAreaElement
    const saved = JSON.parse(reference.value)
    expect(saved.position).toMatchObject({
      branchId: 'main',
      stepId: 'activity',
      timeMs: 4500,
      recordedAt: 5500
    })
    seek(7000)
    expect(JSON.parse(reference.value)).toEqual(saved)
    view.unmount()
    render(<ResearchReplayViewerApp context={context} client={client} />)
    await screen.findByTestId('research-replay-viewer')
    expect(
      screen.getByRole('slider', { name: 'Replay progress' }).getAttribute('aria-valuenow')
    ).toBe('7000')
    cleanup()
    render(
      <ResearchReplayViewerApp context={{ ...context, viewerId: 'other-viewer' }} client={client} />
    )
    await screen.findByTestId('research-replay-viewer')
    expect(
      screen.getByRole('slider', { name: 'Replay progress' }).getAttribute('aria-valuenow')
    ).toBe('0')
  })
  it('maps decoded footage moments using the captured branch, never a stale checkpoint', () => {
    const { document, recordedTimeOrigins } = createResearchReplayTimeline(
      researchFixture().document,
      [researchRecordingFixture()]
    )
    const playback = {
      branchId: 'main',
      positionMs: 2300,
      recordedAt: 3300,
      continuous: true,
      playing: true,
      speed: 2,
      onSeekRecordedAt: vi.fn()
    }
    expect(researchPosition(document, recordedTimeOrigins, playback, 4250)).toEqual({
      branchId: 'main',
      stepId: 'activity',
      timeMs: 3250,
      recordedAt: 4250
    })
    expect(researchPosition(document, recordedTimeOrigins, undefined, 4250)).toBeUndefined()
  })
  it('keeps source history visible when a saved recording is missing', async () => {
    const { client } = makeClient()
    vi.spyOn(client, 'researchRecording').mockRejectedValue(new Error('Missing segment index'))
    render(<ResearchReplayViewerApp context={context} client={client} />)
    await screen.findByText(
      'Some saved recordings are unavailable. Other research records remain available.'
    )
    expect(
      screen.getByRole('slider', { name: 'Replay progress' }).getAttribute('aria-valuemax')
    ).toBe('10000')
    expect(screen.getAllByText('Compare fruit collection decisions.').length).toBeGreaterThan(0)
  })
})

it('sends the inspected Notebook run and actual master clock after an overlapping message', async () => {
  const research = researchFixture()
  const runStep = research.document.branches[0].steps[1]
  runStep.kind = 'notebook'
  runStep.message = undefined
  runStep.recordedEndAt = 7000
  runStep.endMs = 6000
  runStep.durationMs = 4500
  const run = {
    runId: 'saved-run',
    cellId: 'cell',
    source: 'agent' as const,
    kernelKind: 'python' as const,
    status: 'completed' as const,
    startedAt: 2500,
    endedAt: 7000
  }
  runStep.runs = [run]
  runStep.evidence = [
    {
      kind: 'notebook-run',
      id: run.runId,
      projectId: context.target.projectId,
      sessionId: context.target.sessionId
    }
  ]
  const later = research.document.branches[0].steps[2]
  later.recordedAt = 5000
  later.startMs = 4000
  const { client, fetcher } = makeClient(research)
  vi.spyOn(client, 'notebook').mockResolvedValue({
    status: 'ready',
    bytes: 100,
    run: {
      ...run,
      script: 'print(7)',
      outputs: [],
      text: { stdout: 'SAVED SEVEN', stderr: '', traceback: '', plain: [] },
      workingFiles: []
    }
  })
  render(<ResearchReplayViewerApp context={context} client={client} />)
  await screen.findByTestId('research-replay-viewer')
  fireEvent.click(screen.getByRole('tab', { name: 'Notebook' }))
  seek(8000)
  const cell = await waitFor(() => {
    const item = document.querySelector('[data-replay-run-item="saved-run"]')
    expect(item).toBeTruthy()
    expect(item?.textContent).toContain('SAVED SEVEN')
    return item!
  })
  fireEvent.pointerDown(cell)
  fireEvent.click(screen.getByRole('button', { name: 'Ask about this run' }))
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([path]) => path === '/api/research/select')).toBe(true)
  )
  const request = fetcher.mock.calls.find(([path]) => path === '/api/research/select')!
  expect(JSON.parse(String(request[1]?.body))).toMatchObject({
    stepId: runStep.id,
    notebookRunId: run.runId,
    timeMs: 8000,
    recordedAt: 9000
  })
  expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('8000')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ask about this run' })).not.toHaveProperty(
      'disabled',
      true
    )
  )
  fireEvent.click(screen.getByRole('tab', { name: 'Original conversation' }))
  fireEvent.pointerDown(document.querySelector('[data-replay-step="request"]')!)
  fireEvent.click(screen.getByRole('button', { name: 'Ask about this record' }))
  await waitFor(() =>
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/research/select')).toHaveLength(2)
  )
  const inspectedRecord = fetcher.mock.calls.filter(([path]) => path === '/api/research/select')[1]
  expect(JSON.parse(String(inspectedRecord[1]?.body))).toMatchObject({
    stepId: 'request',
    inspectStep: 'visible',
    timeMs: 8000,
    recordedAt: 9000
  })
})
