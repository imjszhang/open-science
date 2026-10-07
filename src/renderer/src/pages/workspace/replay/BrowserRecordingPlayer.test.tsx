// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { browserRecordingFixture } from './BrowserRecording.test-support'
import { BrowserRecordingPlayer } from './BrowserRecordingPlayer'
import { segmentAt } from './browser-recording-playback'

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
const mediaUrl = (key: string): string => `/api/recording/media?mediaKey=${key}`
it('seeks into exact segments and asks at the selected time without any runtime', async () => {
  const ask = vi.fn()
  render(
    <BrowserRecordingPlayer
      recording={browserRecordingFixture()}
      mediaUrl={mediaUrl}
      onAskMoment={ask}
    />
  )
  fireEvent.change(screen.getByRole('slider'), { target: { value: '3200' } })
  const video = screen.getByLabelText('Recorded webpage') as HTMLVideoElement
  expect(video.getAttribute('src')).toBe('/api/recording/media?mediaKey=media-1')
  fireEvent.loadedMetadata(video)
  expect(video.currentTime).toBe(1.2)
  fireEvent.click(screen.getByRole('button', { name: 'Ask about this moment' }))
  await act(async () => {})
  expect(ask).toHaveBeenCalledWith(3200)
  expect(document.querySelector('iframe')).toBeNull()
})
it('does not retain an earlier image over an unrecorded interval or allow citing a gap', () => {
  render(
    <BrowserRecordingPlayer
      recording={browserRecordingFixture()}
      mediaUrl={mediaUrl}
      onAskMoment={vi.fn()}
    />
  )
  fireEvent.change(screen.getByRole('slider'), { target: { value: '4500' } })
  expect(screen.getByText('Recording was paused at this time.')).toBeTruthy()
  expect(screen.queryByLabelText('Recorded webpage')).toBeNull()
  expect(
    screen.getByRole('button', { name: 'Ask about this moment' }).hasAttribute('disabled')
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Go to next recorded moment' }))
  expect(screen.getByRole('slider').getAttribute('value')).toBe('5000')
})
it('advances contiguous media but stops at a recording gap', async () => {
  render(<BrowserRecordingPlayer recording={browserRecordingFixture()} mediaUrl={mediaUrl} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play replay' }))
  await act(async () => {})
  fireEvent.ended(screen.getByLabelText('Recorded webpage'))
  expect(screen.getByLabelText('Recorded webpage').getAttribute('src')).toContain('media-1')
  expect(screen.getByRole('button', { name: 'Pause replay' })).toBeTruthy()
  fireEvent.ended(screen.getByLabelText('Recorded webpage'))
  expect(screen.getByText('Recording was paused at this time.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Play replay' })).toBeTruthy()
})
it('unloads media when inactive and returns paused at the same time', async () => {
  const recording = browserRecordingFixture()
  const { rerender } = render(<BrowserRecordingPlayer recording={recording} mediaUrl={mediaUrl} />)
  fireEvent.change(screen.getByRole('slider'), { target: { value: '1500' } })
  fireEvent.click(screen.getByRole('button', { name: 'Play replay' }))
  await act(async () => {})
  const element = screen.getByLabelText('Recorded webpage')
  rerender(<BrowserRecordingPlayer recording={recording} mediaUrl={mediaUrl} active={false} />)
  expect(element.hasAttribute('src')).toBe(false)
  expect(screen.queryByLabelText('Recorded webpage')).toBeNull()
  rerender(<BrowserRecordingPlayer recording={recording} mediaUrl={mediaUrl} active />)
  expect(screen.getByRole('slider').getAttribute('value')).toBe('1500')
  expect(screen.getByRole('button', { name: 'Play replay' })).toBeTruthy()
})
it('keeps exact end-exclusive segment boundaries and resets when source identity changes', () => {
  const recording = browserRecordingFixture()
  expect(segmentAt(recording, 2000)?.segmentId).toBe('segment-1')
  expect(segmentAt(recording, 4000)).toBeUndefined()
  const { rerender } = render(<BrowserRecordingPlayer recording={recording} mediaUrl={mediaUrl} />)
  fireEvent.change(screen.getByRole('slider'), { target: { value: '3200' } })
  rerender(
    <BrowserRecordingPlayer
      recording={{ ...recording, recordingId: 'another' }}
      mediaUrl={mediaUrl}
    />
  )
  expect(screen.getByRole('slider').getAttribute('value')).toBe('0')
})
it('advances over a small encoder boundary without inventing frames, but preserves explicit gaps', () => {
  const recording = browserRecordingFixture()
  recording.segments[1].startMs += 4
  render(<BrowserRecordingPlayer recording={recording} mediaUrl={mediaUrl} />)
  fireEvent.ended(screen.getByLabelText('Recorded webpage'))
  expect(screen.getByRole('slider').getAttribute('value')).toBe('2004')
  expect(screen.getByLabelText('Recorded webpage').getAttribute('src')).toContain('media-1')
})
it('starts at the first captured timestamp and releases media when the browser tab is hidden', () => {
  const recording = browserRecordingFixture()
  recording.segments[0].startMs = 24
  render(<BrowserRecordingPlayer recording={recording} mediaUrl={mediaUrl} />)
  expect(screen.getByRole('slider').getAttribute('value')).toBe('24')
  const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  fireEvent(document, new Event('visibilitychange'))
  expect(screen.queryByLabelText('Recorded webpage')).toBeNull()
  visible.mockReturnValue('visible')
  fireEvent(document, new Event('visibilitychange'))
  expect(screen.getByLabelText('Recorded webpage')).toBeTruthy()
  expect(screen.getByRole('slider').getAttribute('value')).toBe('24')
  expect(screen.getByRole('button', { name: 'Play replay' })).toBeTruthy()
})
it('distinguishes unavailable receiving media from activity that was never recorded', () => {
  render(<BrowserRecordingPlayer recording={browserRecordingFixture()} mediaUrl={() => null} />)
  expect(screen.getByText('Could not read the recorded material.')).toBeTruthy()
  expect(screen.queryByText('No webpage footage was recorded at this time.')).toBeNull()
})
it('pauses before asking and cites the actual media time between sparse timeupdate events', async () => {
  const ask = vi.fn()
  render(
    <BrowserRecordingPlayer
      recording={browserRecordingFixture()}
      mediaUrl={mediaUrl}
      onAskMoment={ask}
    />
  )
  fireEvent.change(screen.getByRole('slider'), { target: { value: '3200' } })
  const video = screen.getByLabelText('Recorded webpage') as HTMLVideoElement
  Object.defineProperty(video, 'readyState', { configurable: true, value: 2 })
  fireEvent.loadedMetadata(video)
  fireEvent.click(screen.getByRole('button', { name: 'Play replay' }))
  await act(async () => {})
  video.currentTime = 1.375
  // The media has advanced 175 ms since the last React timeline update.
  expect(screen.getByRole('slider').getAttribute('value')).toBe('3200')
  const pause = vi.mocked(HTMLMediaElement.prototype.pause)
  pause.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Ask about this moment' }))
  await act(async () => {})
  expect(ask).toHaveBeenCalledWith(3375)
  expect(pause.mock.invocationCallOrder[0]).toBeLessThan(ask.mock.invocationCallOrder[0])
  expect(screen.getByRole('slider').getAttribute('value')).toBe('3375')
  expect(screen.getByRole('button', { name: 'Play replay' })).toBeTruthy()
})
it('distinguishes host observations, browser interactions and author declarations', () => {
  const recording = browserRecordingFixture()
  recording.events = [
    { eventId: 'host', offsetMs: 0, kind: 'navigation', source: 'host-observed' },
    { eventId: 'browser', offsetMs: 1000, kind: 'click', source: 'browser-observed' },
    { eventId: 'author', offsetMs: 1500, kind: 'author', source: 'author-declared' }
  ]
  render(<BrowserRecordingPlayer recording={recording} mediaUrl={mediaUrl} />)
  fireEvent.click(screen.getByText('Recorded actions and events'))
  expect(screen.getByText(/navigation · Host-observed event/)).toBeTruthy()
  expect(screen.getByText(/click · Browser-observed action/)).toBeTruthy()
  expect(screen.getByText(/author · Author-declared event/)).toBeTruthy()
})
