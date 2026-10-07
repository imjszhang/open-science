// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  projectRecordingToTrack,
  type ProjectRecording
} from '../../../../../shared/project-recording'
import { ProjectReplay } from './ProjectReplay'

const fixture = (): ProjectRecording => ({
  format: 'open-science-project-recording',
  version: 1,
  recordingId: 'visual-only',
  startedAt: 10,
  endedAt: 80,
  media: [0, 1].map((n) => ({
    mediaKey: `image-${n}`,
    name: `frame-${n}.png`,
    mimeType: 'image/png',
    checksum: 'a'.repeat(64),
    sizeBytes: 20,
    sourceVersionId: `version-${n}`
  })),
  frames: [0, 1].map((n) => ({
    frameId: `frame-${n}`,
    sequence: n,
    recordedAt: 20 + n * 30,
    mediaKey: `image-${n}`,
    provenance: {
      kind: 'capture',
      source: 'project-export',
      startedAt: 10 + n * 30,
      finishedAt: 20 + n * 30,
      width: 1,
      height: 1
    }
  })),
  states: [],
  events: [],
  coverage: {
    kind: 'sampled-project-recording',
    stopReason: 'finished',
    failures: 0,
    unchangedSamples: 0,
    droppedSamples: 0,
    missingMediaKeys: []
  }
})
afterEach(cleanup)
it('renders a project-only recording without Notebook or a runtime API, keeping exact frame identity', async () => {
  const track = projectRecordingToTrack(fixture()),
    ask = vi.fn()
  const read = vi.fn(async (key: string) => `data:image/png;base64,${key}`)
  render(<ProjectReplay track={track} readImage={read} onAskFrame={ask} />)
  fireEvent.load(await screen.findByAltText('Recorded project image'))
  fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
  await act(async () => {})
  fireEvent.load(screen.getByAltText('Recorded project image'))
  expect(screen.getByRole('img').getAttribute('src')).toContain('image-1')
  fireEvent.click(screen.getByRole('button', { name: 'Ask about this frame' }))
  await act(async () => {})
  expect(ask).toHaveBeenCalledWith(track.frames[1])
  expect(screen.queryByText('Notebook')).toBeNull()
})
it('ignores late frames from the previous source and keeps missing media explicit', async () => {
  let finish!: (value: string) => void
  const read = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      })
  )
  const { rerender } = render(
    <ProjectReplay track={projectRecordingToTrack(fixture())} readImage={read} />
  )
  const next = fixture()
  next.recordingId = 'another'
  rerender(<ProjectReplay track={projectRecordingToTrack(next)} readImage={async () => null} />)
  await act(async () => {
    finish('data:image/png;base64,old')
  })
  expect(screen.queryByRole('img')).toBeNull()
  expect(await screen.findByText('Could not read the recorded material.')).toBeTruthy()
})
it('does not invent screenshots from declared state data', () => {
  const data = fixture()
  data.frames = []
  data.media = []
  data.states = [
    { stateId: 's', sequence: 0, recordedAt: 20, source: 'author-declared', value: { x: 1 } }
  ]
  render(<ProjectReplay track={projectRecordingToTrack(data)} readImage={vi.fn()} />)
  expect(
    screen.getByText('No project images were recorded. Other research materials remain available.')
  ).toBeTruthy()
  expect(screen.getByText('Recorded states and events')).toBeTruthy()
  expect(screen.queryByRole('img')).toBeNull()
})
it('drops the displayed image when the receiving reader changes even if recording and frame IDs match', async () => {
  const track = projectRecordingToTrack(fixture())
  const { rerender } = render(
    <ProjectReplay track={track} readImage={async () => 'data:image/png;base64,first'} />
  )
  fireEvent.load(await screen.findByAltText('Recorded project image'))
  let finish!: (value: string | null) => void
  const otherReader = (): Promise<string | null> =>
    new Promise<string | null>((resolve) => {
      finish = resolve
    })
  rerender(<ProjectReplay track={track} readImage={otherReader} />)
  expect(screen.queryByRole('img')).toBeNull()
  await act(async () => {
    finish(null)
  })
  expect(screen.queryByRole('img')).toBeNull()
  expect(await screen.findByText('Could not read the recorded material.')).toBeTruthy()
})
it('plays by recorded frame times and suspends the clock while its material pane is hidden', async () => {
  vi.useFakeTimers()
  try {
    const track = projectRecordingToTrack(fixture()),
      readImage = async (): Promise<string> => 'data:image/png;base64,image'
    const { rerender } = render(<ProjectReplay track={track} readImage={readImage} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Play replay' }))
    rerender(<ProjectReplay track={track} readImage={readImage} active={false} />)
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(screen.getByRole('slider').getAttribute('value')).toBe('0')
    rerender(<ProjectReplay track={track} readImage={readImage} active />)
    await act(async () => {
      vi.advanceTimersByTime(30)
    })
    expect(screen.getByRole('slider').getAttribute('value')).toBe('1')
    expect(screen.getByRole('button', { name: 'Play replay' })).toBeTruthy()
  } finally {
    vi.useRealTimers()
  }
})

it('follows the research timestamp without local playback controls or timer advancement', async () => {
  const track = projectRecordingToTrack(fixture())
  const readImage = vi.fn(async (key: string) => `data:image/png;base64,${key}`)
  const onSeekRecordedAt = vi.fn()
  const { rerender } = render(
    <ProjectReplay
      track={track}
      readImage={readImage}
      transport={{ recordedAt: 25, onSeekRecordedAt }}
    />
  )
  fireEvent.load(await screen.findByAltText('Recorded project image'))
  expect(screen.getByRole('img').getAttribute('src')).toContain('image-0')
  expect(screen.queryByRole('slider')).toBeNull()
  expect(screen.queryByRole('button', { name: /(?:Play|Pause) replay/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Next image' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Previous image' })).toBeNull()
  rerender(
    <ProjectReplay
      track={track}
      readImage={readImage}
      transport={{ recordedAt: 50, onSeekRecordedAt }}
    />
  )
  await act(async () => {})
  fireEvent.load(screen.getByAltText('Recorded project image'))
  expect(screen.getByRole('img').getAttribute('src')).toContain('image-1')
  expect(onSeekRecordedAt).not.toHaveBeenCalled()
})

it('drops controlled images before their first capture, outside recording coverage, and without an anchor', async () => {
  const track = projectRecordingToTrack(fixture())
  const readImage = vi.fn(async (key: string) => `data:image/png;base64,${key}`)
  const onSeekRecordedAt = vi.fn()
  const { rerender } = render(
    <ProjectReplay
      track={track}
      readImage={readImage}
      transport={{ recordedAt: 50, onSeekRecordedAt }}
    />
  )
  fireEvent.load(await screen.findByAltText('Recorded project image'))
  for (const recordedAt of [5, 15, 81, undefined]) {
    rerender(
      <ProjectReplay
        track={track}
        readImage={readImage}
        transport={{ recordedAt, onSeekRecordedAt }}
      />
    )
    expect(screen.queryByRole('img')).toBeNull()
    expect(
      screen.getByText(
        recordedAt === undefined
          ? 'This recording cannot be aligned with the research replay timeline.'
          : 'No project image was recorded at this time.'
      )
    ).toBeTruthy()
  }
  expect(readImage).toHaveBeenCalledTimes(1)
})

it('does not cite a loading or hidden controlled image and seeks the master clock before asking', async () => {
  const track = projectRecordingToTrack(fixture())
  let finish!: (value: string) => void
  const readImage = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      })
  )
  const onSeekRecordedAt = vi.fn()
  const onAskFrame = vi.fn()
  const props = { track, readImage, onAskFrame, transport: { recordedAt: 55, onSeekRecordedAt } }
  const { rerender } = render(<ProjectReplay {...props} />)
  const askButton = screen.getByRole('button', { name: 'Ask about this frame' })
  expect(askButton.hasAttribute('disabled')).toBe(true)
  await act(async () => {
    finish('data:image/png;base64,image-1')
  })
  fireEvent.load(screen.getByAltText('Recorded project image'))
  fireEvent.click(askButton)
  await act(async () => {})
  expect(onSeekRecordedAt).toHaveBeenCalledWith(50)
  expect(onAskFrame).toHaveBeenCalledWith(track.frames[1])
  expect(onSeekRecordedAt.mock.invocationCallOrder[0]).toBeLessThan(
    onAskFrame.mock.invocationCallOrder[0]
  )
  rerender(<ProjectReplay {...props} active={false} />)
  expect(screen.queryByRole('img')).toBeNull()
  expect(
    screen.getByRole('button', { name: 'Ask about this frame' }).hasAttribute('disabled')
  ).toBe(true)
})

it('ignores a delayed image read after the research clock leaves its coverage', async () => {
  const track = projectRecordingToTrack(fixture())
  let finish!: (value: string) => void
  const readImage = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      })
  )
  const onSeekRecordedAt = vi.fn()
  const { rerender } = render(
    <ProjectReplay
      track={track}
      readImage={readImage}
      transport={{ recordedAt: 50, onSeekRecordedAt }}
    />
  )
  rerender(
    <ProjectReplay
      track={track}
      readImage={readImage}
      transport={{ recordedAt: 100, onSeekRecordedAt }}
    />
  )
  expect(readImage.mock.calls[0]).toBeTruthy()
  await act(async () => {
    finish('data:image/png;base64,late')
  })
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.getByText('No project image was recorded at this time.')).toBeTruthy()
})

it('does not allow referencing image URLs that have not decoded or failed to decode', async () => {
  const ask = vi.fn()
  render(
    <ProjectReplay
      track={projectRecordingToTrack(fixture())}
      readImage={async () => 'data:image/png;base64,broken'}
      onAskFrame={ask}
      presentationMode="research"
    />
  )
  const image = await screen.findByAltText('Recorded project image')
  const button = screen.getByRole('button', { name: 'Ask about this frame' })
  expect(button.hasAttribute('disabled')).toBe(true)
  fireEvent.error(image)
  expect(screen.getByText('Could not read the recorded material.')).toBeTruthy()
  expect(button.hasAttribute('disabled')).toBe(true)
  fireEvent.click(button)
  expect(ask).not.toHaveBeenCalled()
})
