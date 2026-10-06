import { describe, expect, it, vi, type Mock } from 'vitest'
import { createElectronCallerContext } from '../caller-context'
import {
  createElectronProjectCapture,
  type CaptureContents,
  type CaptureFrame,
  type ElectronProjectCaptureDependencies,
  type ElectronProjectCaptureInput
} from './electron-capture'

type MutableFrame = Omit<CaptureFrame, 'frames' | 'executeJavaScript'> & {
  frames: MutableFrame[]
  executeJavaScript: Mock<(code: string) => Promise<unknown>>
}
function setup(): {
  root: MutableFrame
  viewer: MutableFrame
  project: MutableFrame
  contents: CaptureContents
  window: ReturnType<ElectronProjectCaptureDependencies['windowFor']>
  capture: ReturnType<typeof createElectronProjectCapture>
  input: ElectronProjectCaptureInput
  capturePage: Mock
  rootQuery: Mock
  viewerQuery: Mock
  reportDiagnostic: Mock
} {
  const rootQuery = vi.fn(async () => ({
    documentUrl: 'file:///app/index.html',
    sourceUrl: 'http://127.0.0.1:3001/bootstrap',
    devicePixelRatio: 1.25,
    viewportWidth: 1000,
    viewportHeight: 800,
    rect: { x: 80, y: 60, width: 600, height: 400 }
  }))
  const viewerQuery = vi.fn(async () => ({
    documentUrl: 'http://127.0.0.1:3001/',
    sourceUrl: 'http://project.localhost:3002/bootstrap',
    devicePixelRatio: 1.25,
    viewportWidth: 600,
    viewportHeight: 400,
    rect: { x: 40, y: 70, width: 320, height: 180 }
  }))
  const root: MutableFrame = {
    url: 'file:///app/index.html',
    origin: 'file://',
    frameToken: 'root-token',
    processId: 1,
    parent: null,
    frames: [],
    detached: false,
    visibilityState: 'visible',
    isDestroyed: () => false,
    executeJavaScript: rootQuery
  }
  const viewer: MutableFrame = {
    ...root,
    url: 'http://127.0.0.1:3001/',
    origin: 'http://127.0.0.1:3001',
    frameToken: 'viewer-token',
    parent: root,
    frames: [],
    executeJavaScript: viewerQuery
  }
  const project: MutableFrame = {
    ...viewer,
    url: 'http://project.localhost:3002/',
    origin: 'http://project.localhost:3002',
    frameToken: 'project-token',
    parent: viewer,
    frames: [],
    executeJavaScript: vi.fn(async () => {
      throw new Error('must not execute project script')
    })
  }
  root.frames.push(viewer)
  viewer.frames.push(project)
  const capturePage = vi.fn(async (rect: { width: number; height: number }) => ({
    isEmpty: () => false,
    getSize: () => ({ width: rect.width, height: rect.height }),
    toPNG: () => Buffer.from('actual-native-png')
  }))
  const contents: CaptureContents = {
    id: 7,
    mainFrame: root,
    isDestroyed: () => false,
    getZoomFactor: () => 1.25,
    capturePage
  }
  const window = {
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    isFocused: () => true
  }
  const reportDiagnostic = vi.fn()
  const capture = createElectronProjectCapture({
    reportDiagnostic,
    fromId: (id) => (id === 7 ? contents : undefined),
    windowFor: () => window
  })
  const input = {
    caller: createElectronCallerContext(7),
    viewerOrigin: viewer.origin,
    projectOrigin: project.origin,
    signal: new AbortController().signal
  }
  return {
    root,
    viewer,
    project,
    contents,
    window,
    capture,
    input,
    capturePage,
    rootQuery,
    viewerQuery,
    reportDiagnostic
  }
}

describe('visible Electron project capture', () => {
  it('crops the original nested frame, applies zoom exactly once and never runs project script', async () => {
    const h = setup()
    const result = await h.capture(h.input)
    expect(result.bytes).toEqual(Uint8Array.from(Buffer.from('actual-native-png')))
    expect(h.capturePage).toHaveBeenCalledWith({ x: 150, y: 163, width: 400, height: 224 })
    expect(h.rootQuery).toHaveBeenCalledTimes(3)
    expect(h.viewerQuery).toHaveBeenCalledTimes(3)
    expect(h.project.executeJavaScript).not.toHaveBeenCalled()
    const script = h.rootQuery.mock.calls[0][0]
    expect(script).toContain("document.querySelectorAll('iframe')")
    expect(script).toContain('document.elementFromPoint')
    expect(script).toContain('style.opacity')
  })

  it('verifies Retina output dimensions without multiplying the crop by devicePixelRatio', async () => {
    const h = setup()
    h.rootQuery.mockResolvedValue({ ...(await h.rootQuery('')), devicePixelRatio: 2.5 })
    h.viewerQuery.mockResolvedValue({ ...(await h.viewerQuery('')), devicePixelRatio: 2.5 })
    h.capturePage.mockImplementation(async (rect) => ({
      isEmpty: () => false,
      getSize: () => ({ width: rect.width * 2, height: rect.height * 2 }),
      toPNG: () => Buffer.from('retina-native-png')
    }))
    await h.capture(h.input)
    expect(h.capturePage).toHaveBeenCalledWith({ x: 150, y: 163, width: 400, height: 224 })
  })

  it('rejects a full-window or empty image returned for the selected project crop', async () => {
    for (const empty of [true, false]) {
      const h = setup()
      h.capturePage.mockResolvedValue({
        isEmpty: () => empty,
        getSize: () => ({ width: 1000, height: 800 }),
        toPNG: () => Buffer.from('unrelated-pixels')
      })
      await expect(h.capture(h.input)).rejects.toThrow()
    }
  })

  it.each(['web', 'task'] as const)(
    'rejects the %s surface rather than using another window',
    async (surface) => {
      const h = setup()
      await expect(
        h.capture({ ...h.input, caller: { ...h.input.caller, surface } })
      ).rejects.toThrow()
      expect(h.capturePage).not.toHaveBeenCalled()
    }
  )

  it.each([
    'https://example.org',
    'http://127.0.0.1:3001/path',
    'http://user:secret@localhost:3001',
    'file:///tmp/page.html'
  ])('rejects unissued origin %s', async (projectOrigin) => {
    const h = setup()
    await expect(h.capture({ ...h.input, projectOrigin })).rejects.toThrow()
    expect(h.capturePage).not.toHaveBeenCalled()
  })

  it.each(['hidden', 'minimized', 'unfocused', 'destroyed', 'revoked'] as const)(
    'rejects %s windows and caller leases before any DOM query',
    async (condition) => {
      const h = setup()
      if (condition === 'hidden') h.window!.isVisible = () => false
      if (condition === 'minimized') h.window!.isMinimized = () => true
      if (condition === 'unfocused') h.window!.isFocused = () => false
      if (condition === 'destroyed') h.window!.isDestroyed = () => true
      const caller =
        condition === 'revoked'
          ? { ...h.input.caller, isAuthorizationCurrent: () => false }
          : h.input.caller
      await expect(h.capture({ ...h.input, caller })).rejects.toThrow()
      expect(h.rootQuery).not.toHaveBeenCalled()
      expect(h.capturePage).not.toHaveBeenCalled()
    }
  )

  it('rejects ambiguous origins, detached frames and URL/origin mismatches', async () => {
    for (const change of [
      (h: ReturnType<typeof setup>) => {
        h.root.frames.push({ ...h.viewer })
      },
      (h: ReturnType<typeof setup>) => {
        Object.assign(h.project, { detached: true })
      },
      (h: ReturnType<typeof setup>) => {
        Object.assign(h.project, { origin: 'null' })
      },
      (h: ReturnType<typeof setup>) => {
        Object.assign(h.project, { url: 'http://foreign.localhost:3002/' })
      }
    ]) {
      const h = setup()
      change(h)
      await expect(h.capture(h.input)).rejects.toThrow()
      expect(h.capturePage).not.toHaveBeenCalled()
    }
  })

  it('requires trusted DOM measurements for both frame origins and rejects clipped or ambiguous DOM results', async () => {
    const h = setup()
    h.viewerQuery.mockResolvedValue(null)
    await expect(h.capture(h.input)).rejects.toThrow()
    expect(h.capturePage).not.toHaveBeenCalled()
    expect(h.project.executeJavaScript).not.toHaveBeenCalled()
  })

  it.each(['layout', 'navigation', 'lease', 'zoom', 'hidden', 'frame-replaced', 'abort'] as const)(
    'discards the image if %s changes while capturePage is pending',
    async (condition) => {
      const h = setup()
      let authorized = true
      const controller = new AbortController()
      const capturePage = h.capturePage.getMockImplementation()!
      h.capturePage.mockImplementation(async (rect) => {
        const image = await capturePage(rect)
        if (condition === 'layout')
          h.viewerQuery.mockResolvedValue({
            documentUrl: h.viewer.url,
            sourceUrl: h.project.url,
            devicePixelRatio: 1.25,
            viewportWidth: 600,
            viewportHeight: 400,
            rect: { x: 41, y: 70, width: 320, height: 180 }
          })
        if (condition === 'navigation') Object.assign(h.project, { url: `${h.project.url}other` })
        if (condition === 'lease') authorized = false
        if (condition === 'zoom') Object.assign(h.contents, { getZoomFactor: () => 1.5 })
        if (condition === 'hidden') h.window!.isVisible = () => false
        if (condition === 'frame-replaced') h.viewer.frames[0] = { ...h.project }
        if (condition === 'abort') controller.abort()
        return image
      })
      await expect(
        h.capture({
          ...h.input,
          signal: controller.signal,
          caller: { ...h.input.caller, isAuthorizationCurrent: () => authorized }
        })
      ).rejects.toThrow()
      expect(h.capturePage).toHaveBeenCalledOnce()
    }
  )

  it('rejects a mismatched DOM iframe src origin even if the native frame is still present', async () => {
    const h = setup()
    h.viewerQuery.mockResolvedValue({
      documentUrl: h.viewer.url,
      sourceUrl: 'http://foreign.localhost:3002/',
      devicePixelRatio: 1.25,
      viewportWidth: 600,
      viewportHeight: 400,
      rect: { x: 40, y: 70, width: 320, height: 180 }
    })
    await expect(h.capture(h.input)).rejects.toThrow()
    expect(h.capturePage).not.toHaveBeenCalled()
  })
  it.each([
    ['root', 'ancestor-clipped-y'],
    ['viewer', 'hit-test-mismatch'],
    ['viewer', 'overlapping-element']
  ] as const)(
    'reports bounded %s measurement diagnostics for %s without changing the public error',
    async (frame, reason) => {
      const h = setup()
      const query = frame === 'root' ? h.rootQuery : h.viewerQuery
      query.mockResolvedValue({ unavailable: reason, ancestorDepth: 2, excessPx: 0.3046875 })
      await expect(h.capture(h.input)).rejects.toThrow(
        'Visible project frame is unavailable or changed during capture.'
      )
      expect(h.reportDiagnostic).toHaveBeenCalledExactlyOnceWith({
        stage: `measure-${frame}`,
        reason,
        measurement: 'initial',
        ancestorDepth: 2,
        excessPx: 0.3046875
      })
      expect(h.capturePage).not.toHaveBeenCalled()
    }
  )
  it('never includes untrusted measurement fields, URLs or exception text in private diagnostics', async () => {
    const h = setup()
    h.rootQuery.mockResolvedValue({
      unavailable: 'ancestor-clipped-y',
      url: 'https://private/?grant=secret',
      excessPx: Infinity
    })
    await expect(h.capture(h.input)).rejects.toThrow()
    expect(h.reportDiagnostic).toHaveBeenLastCalledWith({
      stage: 'measure-root',
      reason: 'measurement-invalid',
      measurement: 'initial'
    })
    h.rootQuery.mockRejectedValue(new Error('private source path and grant=secret'))
    await expect(h.capture(h.input)).rejects.toThrow(
      'Visible project frame is unavailable or changed during capture.'
    )
    expect(h.reportDiagnostic).toHaveBeenLastCalledWith({
      stage: 'measure-root',
      reason: 'host-error',
      measurement: 'initial'
    })
    expect(JSON.stringify(h.reportDiagnostic.mock.calls)).not.toMatch(/private|secret|https/)
  })
  it('distinguishes a focus failure from pixel acquisition and survives diagnostic sink failure', async () => {
    const h = setup()
    h.window!.isFocused = () => false
    h.reportDiagnostic.mockImplementation(() => {
      throw new Error('diagnostic sink failed')
    })
    await expect(h.capture(h.input)).rejects.toThrow(
      'Visible project frame is unavailable or changed during capture.'
    )
    expect(h.reportDiagnostic).toHaveBeenCalledExactlyOnceWith({
      stage: 'frame-binding',
      reason: 'window-unfocused'
    })
    expect(h.capturePage).not.toHaveBeenCalled()
  })
  it('reports image-validation failures only after the trusted frame capture succeeded', async () => {
    const h = setup()
    h.capturePage.mockResolvedValue({
      isEmpty: () => false,
      getSize: () => ({ width: 1, height: 1 }),
      toPNG: () => Buffer.from('irrelevant')
    })
    await expect(h.capture(h.input)).rejects.toThrow()
    expect(h.reportDiagnostic).toHaveBeenCalledExactlyOnceWith({
      stage: 'image-validation',
      reason: 'image-size',
      measurement: 'after'
    })
    expect(h.capturePage).toHaveBeenCalledOnce()
  })
})
