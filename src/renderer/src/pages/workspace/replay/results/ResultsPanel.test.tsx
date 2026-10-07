// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResultsPanel, type ReplayResultEntry } from './ResultsPanel'
import { RecordedResourcePreview } from './RecordedResourcePreview'
import { createArtifactVersionLocator } from '../../../../../../shared/artifact-provenance'
import { readRecordedResource } from './recorded-resource-reader'
const entry = (name = 'final-result.html'): ReplayResultEntry => ({
  source: { kind: 'project-recording', id: 'recording' },
  scope: { kind: 'recording' },
  stage: 'unspecified',
  mediaKey: 'report',
  resource: {
    source: 'artifact',
    id: 'file-v1',
    name,
    projectId: 'p',
    sessionId: 's',
    artifactId: 'file',
    versionId: 'file-v1',
    availability: 'recorded',
    locator: createArtifactVersionLocator({
      projectId: 'p',
      appSessionId: 's',
      artifactId: 'file',
      versionId: 'file-v1'
    }),
    mimeType: 'text/html',
    checksum: 'a'.repeat(64),
    size: 10
  }
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('independent immutable Results', () => {
  it('opens static HTML without a Notebook or project page and asks about the exact file, not a step', async () => {
    const selected = entry()
    const read = vi.fn().mockResolvedValue({
      content:
        '<h1>Saved report</h1><script>fetch("https://evil.test")</script><a href="https://evil.test">Link</a>',
      mimeType: 'text/html',
      truncated: false
    })
    const ask = vi.fn()
    render(<ResultsPanel entries={[selected]} read={read} onAskFile={ask} />)
    expect(read).not.toHaveBeenCalled()
    expect(screen.getByText(/Stage not specified/)).toBeTruthy()
    expect(screen.queryByText('Final result')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /final-result.html/ }))
    const frame = await screen.findByTitle('final-result.html')
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('src')).toBeNull()
    expect(frame.getAttribute('srcdoc')).toContain('Saved report')
    expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'")
    expect(frame.getAttribute('srcdoc')).not.toMatch(/<script|https:\/\/evil/)
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this file' }))
    expect(ask).toHaveBeenCalledExactlyOnceWith(selected)
    expect(ask.mock.calls[0][0]).not.toHaveProperty('stepId')
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: 'file-v1' }),
      expect.any(AbortSignal)
    )
  })
  it('cannot read unavailable versions or a locator that contradicts the declared scope', () => {
    const a = entry(),
      b = entry('wrong-scope.html')
    a.resource.availability = 'unavailable'
    b.resource.locator = createArtifactVersionLocator({
      projectId: 'other',
      appSessionId: 's',
      artifactId: 'file',
      versionId: 'file-v1'
    })
    const read = vi.fn()
    render(<ResultsPanel entries={[a, b]} read={read} />)
    expect(screen.getByText('No recorded results are available.')).toBeTruthy()
    expect(read).not.toHaveBeenCalled()
  })
  it('only labels stages explicitly and preserves JSON/CSV as inert readable text', async () => {
    const selected = { ...entry('measurements.csv'), stage: 'intermediate' as const }
    selected.resource.mimeType = 'text/csv'
    const read = vi
      .fn()
      .mockResolvedValue({ content: 'trial,score\n1,9', mimeType: 'text/csv', truncated: true })
    render(<ResultsPanel entries={[selected]} read={read} />)
    fireEvent.click(screen.getByRole('button', { name: /measurements.csv/ }))
    expect(await screen.findByText('trial,score 1,9')).toBeTruthy()
    expect(screen.getByText(/Intermediate result/)).toBeTruthy()
    expect(
      screen.getByText('Preview is truncated. Open the evidence for the complete file.')
    ).toBeTruthy()
  })
  it('ignores old bytes after the selected immutable Version changes', async () => {
    let finish!: (result: { content: string; mimeType: string; truncated: boolean }) => void
    const read = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValue({ content: 'new content', mimeType: 'text/plain', truncated: false })
    const first = entry('one.txt').resource,
      second = {
        ...entry('two.txt').resource,
        id: 'two',
        versionId: 'two-v1',
        locator: createArtifactVersionLocator({
          projectId: 'p',
          appSessionId: 's',
          artifactId: 'file',
          versionId: 'two-v1'
        })
      }
    const view = render(<RecordedResourcePreview resource={first} read={read} />)
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    view.rerender(<RecordedResourcePreview resource={second} read={read} />)
    await screen.findByText('new content')
    await act(async () =>
      finish({ content: 'stale content', mimeType: 'text/plain', truncated: false })
    )
    expect(screen.queryByText('stale content')).toBeNull()
    expect(read.mock.calls[0][1].aborted).toBe(true)
  })
  it('uses only the exact desktop Version reader and refuses mutable paths before IPC', async () => {
    const readPreview = vi
      .fn()
      .mockResolvedValue({ content: '<h1>old</h1>', encoding: 'utf8', truncated: false, size: 12 })
    vi.stubGlobal('api', { artifacts: { readPreview }, uploads: { readPreview: vi.fn() } })
    await expect(readRecordedResource(entry().resource)).resolves.toMatchObject({
      content: '<h1>old</h1>'
    })
    expect(readPreview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ versionId: 'file-v1', fileId: 'file', maxBytes: 192 * 1024 })
    )
    await expect(
      readRecordedResource({ ...entry().resource, locator: '/mutable/latest.html' })
    ).rejects.toThrow()
    expect(readPreview).toHaveBeenCalledTimes(1)
  })
})
