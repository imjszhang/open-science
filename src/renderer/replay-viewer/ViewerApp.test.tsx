// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunObservationSnapshot } from '../../shared/run-observation'
import { ViewerApp } from './ViewerApp'
import { ReplayViewerClient } from './client'
import { staticHtml } from './static-html'
const snapshot: RunObservationSnapshot = {
  identity: { projectId: 'p', sessionId: 's', operationId: 'op', runId: 'run' },
  cursor: { epoch: 'epoch', sequence: 1 },
  observedAt: 1000,
  phase: 'running',
  stepId: 'run:run',
  run: {
    runId: 'run',
    kernelKind: 'bash',
    status: 'running',
    startedAt: 500,
    logs: {
      stdout: { text: 'actual browser host output', truncated: false, redacted: false },
      stderr: { text: '', truncated: false, redacted: false },
      traceback: { text: '', truncated: false, redacted: false }
    }
  },
  artifacts: [],
  artifactsTruncated: false
}
const context = {
  viewerId: 'viewer',
  target: { projectId: 'p', sessionId: 's', operationId: 'op' },
  expiresAt: 10000,
  canInteract: false,
  canCancel: false,
  canReadArtifacts: false
}
const makeClient = (): ReplayViewerClient => {
  const client = new ReplayViewerClient()
  vi.spyOn(client, 'context').mockResolvedValue(context)
  vi.spyOn(client, 'history').mockResolvedValue({
    coverage: 'process-local',
    truncated: false,
    snapshots: [snapshot]
  })
  vi.spyOn(client, 'changes').mockResolvedValue({
    kind: 'delta',
    from: snapshot.cursor,
    cursor: snapshot.cursor,
    changes: []
  })
  vi.spyOn(client, 'selection').mockResolvedValue(null)
  vi.spyOn(client, 'recordingStatus').mockResolvedValue({
    target: context.target,
    state: 'not-recorded'
  })
  return client
}
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {
        /* fixed viewport */
      }
      unobserve(): void {
        /* fixed viewport */
      }
      disconnect(): void {
        /* fixed viewport */
      }
    }
  )
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }))
  HTMLElement.prototype.scrollIntoView = vi.fn()
  Object.defineProperty(window, 'api', { configurable: true, value: undefined })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
describe('standalone browser viewer', () => {
  it('shows only images explicitly associated with the inspected viewer cursor and keeps multiple capture times distinct', async () => {
    const client = makeClient()
    vi.mocked(client.context).mockResolvedValue({
      ...context,
      canCapture: true,
      canReadArtifacts: true
    })
    vi.spyOn(client, 'captureOptions').mockResolvedValue({ hostView: false, projectExports: [] })
    const frame = {
      captureId: 'first',
      recordingId: 'recording',
      stepKey: 'different-durable-observer-step',
      artifactId: 'a',
      versionId: 'v',
      checksum: 'a'.repeat(64),
      sizeBytes: 5,
      mimeType: 'image/png' as const,
      publication: 'awaiting-publication' as const,
      capture: {
        source: 'project-export' as const,
        association: 'current-observation' as const,
        startedAt: 2000,
        finishedAt: 2100,
        observedAt: 900,
        width: 1,
        height: 1
      },
      viewerEvidence: {
        cursor: snapshot.cursor,
        observedAt: snapshot.observedAt,
        stepId: snapshot.stepId
      }
    }
    vi.spyOn(client, 'captures').mockResolvedValue([
      { ...frame, captureId: 'unassociated', viewerEvidence: undefined },
      {
        ...frame,
        captureId: 'wrong-epoch',
        viewerEvidence: {
          ...frame.viewerEvidence,
          cursor: { ...snapshot.cursor, epoch: 'durable-epoch' }
        }
      },
      frame,
      {
        ...frame,
        captureId: 'second',
        capture: { ...frame.capture, startedAt: 3000, finishedAt: 3100 }
      }
    ])
    const read = vi
      .spyOn(client, 'captureImage')
      .mockResolvedValue('data:image/png;base64,cGl4ZWw=')
    render(<ViewerApp client={client} />)
    await screen.findByText('actual browser host output')
    fireEvent.click(screen.getByRole('button', { name: 'Pause following' }))
    fireEvent.click(screen.getByRole('button', { name: 'Project interface' }))
    await screen.findByRole('img', { name: 'Recorded project image' })
    expect(screen.getByText('Recorded project image 1 of 2')).toBeTruthy()
    expect(
      screen.getByText('Captured from 1970-01-01T00:00:02.000Z to 1970-01-01T00:00:02.100Z.')
    ).toBeTruthy()
    expect(screen.getByText('This captured image is awaiting archive publication.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
    await screen.findByRole('img', { name: 'Recorded project image' })
    expect(
      screen.getByText('Captured from 1970-01-01T00:00:03.000Z to 1970-01-01T00:00:03.100Z.')
    ).toBeTruthy()
    expect(read.mock.calls.map(([capture]) => capture.captureId)).toEqual(['first', 'second'])
    expect(document.querySelector('iframe')).toBeNull()
  })
  it('keeps capture controls out of inspect and history instead of capturing an apparent past frame', async () => {
    const client = makeClient()
    vi.mocked(client.context).mockResolvedValue({ ...context, canCapture: true })
    vi.spyOn(client, 'captureOptions').mockResolvedValue({
      hostView: false,
      projectExports: ['frame']
    })
    const capture = vi.spyOn(client, 'capture')
    render(<ViewerApp client={client} />)
    await screen.findByRole('button', { name: 'Save project image: frame' })
    fireEvent.click(screen.getByRole('button', { name: 'Pause following' }))
    expect(screen.queryByRole('button', { name: 'Save project image: frame' })).toBeNull()
    expect(capture).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Back to live' }))
    await screen.findByRole('button', { name: 'Save project image: frame' })
    expect(capture).not.toHaveBeenCalled()
  })
  it('shows actual evidence without a preload bridge and does not turn read access into project interaction or stopping', async () => {
    const client = makeClient(),
      project = vi.spyOn(client, 'projectView'),
      cancel = vi.spyOn(client, 'cancel')
    render(<ViewerApp client={client} />)
    await screen.findByText('actual browser host output')
    expect(screen.queryByRole('button', { name: 'Open project interface' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop run' })).toBeNull()
    expect(screen.getByText('Project interaction is not enabled for this viewer.')).toBeTruthy()
    expect(project).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
  })
  it('captures an exact selection and offers a copyable SDK reference without messaging an unknown parent', async () => {
    const client = makeClient(),
      selected = {
        selectionId: 'selection',
        identity: snapshot.identity,
        cursor: snapshot.cursor,
        stepId: snapshot.stepId,
        selectedAt: 2000,
        snapshot
      }
    const select = vi.spyOn(client, 'select').mockResolvedValue(selected),
      notify = vi.spyOn(window, 'postMessage')
    const captured = vi.fn()
    render(<ViewerApp client={client} onSelectionCaptured={captured} />)
    await screen.findByText('actual browser host output')
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this step' }))
    const reference = await screen.findByRole('textbox', { name: 'Recorded step reference' })
    expect(JSON.parse((reference as HTMLTextAreaElement).value)).toMatchObject({
      viewerId: 'viewer',
      selectionId: 'selection',
      runId: 'run'
    })
    expect(select).toHaveBeenCalledWith(snapshot)
    expect(captured).toHaveBeenCalledWith(selected)
    expect(notify).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Discuss the entire research' })).toBeNull()
  })
  it('opens the authorized project exactly on a click and reveals the common Replay project pane', async () => {
    const client = makeClient()
    vi.mocked(client.context).mockResolvedValue({ ...context, canInteract: true })
    const access = {
      url: `http://rv-view.localhost:1234/__open_science_view?grant=${'a'.repeat(64)}`,
      view: {
        viewId: 'view',
        scope: {
          projectId: 'p',
          sessionId: 's',
          runId: 'run',
          environmentId: 'env',
          generationId: 'generation'
        },
        title: 'Live project',
        state: 'ready' as const,
        createdAt: '2026-10-06T00:00:00Z',
        expiresAt: '2026-10-06T01:00:00Z',
        embeddingAdapted: true
      }
    }
    const open = vi.spyOn(client, 'projectView').mockResolvedValue(access)
    render(<ViewerApp client={client} />)
    await screen.findByText('actual browser host output')
    expect(open).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open project interface' }))
    const frame = await screen.findByTitle('Live project')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-same-origin')
    expect(open).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('button', { name: 'Project interface' }).getAttribute('aria-pressed')
    ).toBe('true')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reopen project interface' })).toHaveProperty(
        'disabled',
        false
      )
    )
  })
  it('static HTML retains saved content while removing scripts, external URLs, navigation and forms actions', () => {
    const html = staticHtml(
      '<meta http-equiv="refresh" content="0;url=https://elsewhere.test"><script>steal()</script><iframe src="http://localhost"></iframe><a href="https://example.com" onclick="steal()">Result</a><img src="https://tracker.test/pixel"><form action="http://localhost"><button>submit</button></form><p>Saved result</p>'
    )
    expect(html).toContain('Saved result')
    expect(html).toContain('Result')
    expect(html).toContain("default-src 'none'")
    expect(html).not.toContain('steal')
    expect(html).not.toContain('refresh')
    expect(html).not.toContain('https://')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('action=')
  })
})
