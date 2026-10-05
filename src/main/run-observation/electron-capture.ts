import { z } from 'zod'
import type { CallerContext } from '../caller-context'

export type ElectronProjectCaptureInput = Readonly<{
  caller: CallerContext
  viewerOrigin: string
  projectOrigin: string
  signal: AbortSignal
}>
export type ElectronProjectCapture = (
  input: ElectronProjectCaptureInput
) => Promise<{ bytes: Uint8Array }>
export type CaptureFrame = Readonly<{
  url: string
  origin: string
  frameToken: string
  processId: number
  parent: CaptureFrame | null
  frames: readonly CaptureFrame[]
  detached: boolean
  visibilityState: string
  isDestroyed(): boolean
  executeJavaScript(code: string): Promise<unknown>
}>
export type CaptureContents = Readonly<{
  id: number
  mainFrame: CaptureFrame
  isDestroyed(): boolean
  getZoomFactor(): number
  capturePage(rect: { x: number; y: number; width: number; height: number }): Promise<{
    isEmpty(): boolean
    getSize(): { width: number; height: number }
    toPNG(): Buffer
  }>
}>
export type ElectronProjectCaptureDependencies = Readonly<{
  fromId(id: number): CaptureContents | undefined
  windowFor(contents: CaptureContents): {
    isDestroyed(): boolean
    isVisible(): boolean
    isMinimized(): boolean
    isFocused(): boolean
  } | null
}>
const rectangleSchema = z
  .object({
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive()
  })
  .strict()
const measurementSchema = z
  .object({
    documentUrl: z.string(),
    sourceUrl: z.string(),
    devicePixelRatio: z.number().finite().positive(),
    viewportWidth: z.number().finite().positive(),
    viewportHeight: z.number().finite().positive(),
    rect: rectangleSchema
  })
  .strict()
type Measurement = z.infer<typeof measurementSchema>
const unavailable = (): Error =>
  new Error('Visible project frame is unavailable or changed during capture.')
const originOf = (url: string): string => {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}
function checkedOrigin(input: string): string {
  const url = new URL(input)
  // These are issued local service origins, never a caller-selected external browsing target.
  if (
    url.origin !== input ||
    url.protocol !== 'http:' ||
    url.username ||
    url.password ||
    !(
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.hostname.endsWith('.localhost')
    )
  )
    throw unavailable()
  return url.origin
}

/** Fixed, read-only query in the trusted app/viewer only. No caller rectangle or project script.
 * Reject effects, clipping and overlapping siblings rather than guessing a transformed crop. */
function measurementScript(origin: string): string {
  return `(() => {
    const origin = ${JSON.stringify(origin)};
    if (document.visibilityState !== 'visible') return null;
    const matches = [...document.querySelectorAll('iframe')].filter(element => {
      try { return new URL(element.src).origin === origin; } catch { return false; }
    });
    if (matches.length !== 1) return null;
    const frame = matches[0];
    const bounds = frame.getBoundingClientRect();
    const css = getComputedStyle(frame);
    const number = value => Number.parseFloat(value) || 0;
    const left = number(css.borderLeftWidth) + number(css.paddingLeft);
    const top = number(css.borderTopWidth) + number(css.paddingTop);
    const right = number(css.borderRightWidth) + number(css.paddingRight);
    const bottom = number(css.borderBottomWidth) + number(css.paddingBottom);
    const rect = { x: bounds.left + left, y: bounds.top + top,
      width: bounds.width - left - right, height: bounds.height - top - bottom };
    const endX = rect.x + rect.width, endY = rect.y + rect.height;
    if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || endX > innerWidth || endY > innerHeight) return null;
    for (let element = frame; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) !== 1 ||
          style.transform !== 'none' || style.perspective !== 'none' || style.filter !== 'none' ||
          style.clipPath !== 'none' || (style.maskImage && style.maskImage !== 'none') ||
          !['1', 'normal', ''].includes(style.zoom)) return null;
      if (element !== frame) {
        const parent = element.getBoundingClientRect();
        const x = parent.left + element.clientLeft, y = parent.top + element.clientTop;
        if (style.overflowX !== 'visible' && (rect.x < x || endX > x + element.clientWidth)) return null;
        if (style.overflowY !== 'visible' && (rect.y < y || endY > y + element.clientHeight)) return null;
      }
    }
    // Include pointer-events:none overlays, which elementFromPoint alone would miss. Trusted
    // layouts with overlapping decorative layers deliberately report unavailable instead of
    // saving a screenshot whose visible evidence is uncertain.
    const elements = document.querySelectorAll('body *');
    if (elements.length > 20000) return null;
    for (const element of elements) {
      if (element === frame || element.contains(frame) || frame.contains(element)) continue;
      const box = element.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0 || box.right <= rect.x || box.bottom <= rect.y || box.left >= endX || box.top >= endY) continue;
      const style = getComputedStyle(element);
      if (style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) !== 0) return null;
    }
    for (const x of [rect.x + 0.5, rect.x + rect.width / 2, endX - 0.5]) {
      for (const y of [rect.y + 0.5, rect.y + rect.height / 2, endY - 0.5]) {
        if (document.elementFromPoint(x, y) !== frame) return null;
      }
    }
    return { documentUrl: location.href, sourceUrl: frame.src,
      devicePixelRatio, viewportWidth: innerWidth, viewportHeight: innerHeight, rect };
  })()`
}
const fingerprint = (frame: CaptureFrame): string =>
  JSON.stringify([frame.frameToken, frame.processId, frame.url, frame.origin])
function child(parent: CaptureFrame, origin: string): CaptureFrame {
  const matches = parent.frames.filter(
    (frame) => frame.parent === parent && originOf(frame.url) === origin && frame.origin === origin
  )
  if (matches.length !== 1) throw unavailable()
  return matches[0]
}
function live(frame: CaptureFrame): void {
  if (frame.detached || frame.isDestroyed() || frame.visibilityState !== 'visible')
    throw unavailable()
}
async function bounded<T>(read: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let abort!: () => void
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(unavailable())
    signal.addEventListener('abort', abort, { once: true })
    timer = setTimeout(abort, 5000)
    timer.unref()
  })
  try {
    return await Promise.race([read, cancelled])
  } finally {
    if (timer) clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

/** Uses an existing visible Electron window. It never creates a browser, navigates or weakens webSecurity. */
export function createElectronProjectCapture(
  dependencies?: ElectronProjectCaptureDependencies
): ElectronProjectCapture {
  return async (input) => {
    const { caller, signal } = input
    if (
      !caller.isAuthorizationCurrent() ||
      caller.surface !== 'electron' ||
      caller.location !== 'local' ||
      !/^[1-9]\d*$/.test(caller.clientId)
    )
      throw unavailable()
    const id = Number(caller.clientId)
    if (!Number.isSafeInteger(id)) throw unavailable()
    const viewerOrigin = checkedOrigin(input.viewerOrigin),
      projectOrigin = checkedOrigin(input.projectOrigin)
    if (viewerOrigin === projectOrigin) throw unavailable()
    const electron = dependencies ? undefined : await import('electron')
    const adapter: ElectronProjectCaptureDependencies = dependencies ?? {
      fromId: (id) => electron!.webContents.fromId(id),
      windowFor: (contents) =>
        electron!.BrowserWindow.fromWebContents(contents as Electron.WebContents)
    }
    const contents = adapter.fromId(id)
    if (!contents) throw unavailable()
    const window = adapter.windowFor(contents)
    const lease = [caller.clientId, caller.leaseId, caller.lifecycleClientId].join('\0')
    const root = contents.mainFrame,
      viewer = child(root, viewerOrigin),
      project = child(viewer, projectOrigin)
    const identities = [fingerprint(root), fingerprint(viewer), fingerprint(project)]
    const zoom = contents.getZoomFactor()
    if (!Number.isFinite(zoom) || zoom < 0.25 || zoom > 5) throw unavailable()
    const assertCurrent = (): void => {
      signal.throwIfAborted()
      if (
        !caller.isAuthorizationCurrent() ||
        lease !== [caller.clientId, caller.leaseId, caller.lifecycleClientId].join('\0') ||
        contents.isDestroyed() ||
        adapter.fromId(id) !== contents ||
        contents.id !== id ||
        !window ||
        adapter.windowFor(contents) !== window ||
        window.isDestroyed() ||
        !window.isVisible() ||
        window.isMinimized() ||
        !window.isFocused() ||
        contents.mainFrame !== root ||
        contents.getZoomFactor() !== zoom ||
        child(root, viewerOrigin) !== viewer ||
        child(viewer, projectOrigin) !== project ||
        identities.some(
          (identity, index) => identity !== fingerprint([root, viewer, project][index])
        )
      )
        throw unavailable()
      for (const frame of [root, viewer, project]) live(frame)
    }
    const measure = async (): Promise<{ outer: Measurement; inner: Measurement }> => {
      assertCurrent()
      const outer = measurementSchema.parse(
        await bounded(root.executeJavaScript(measurementScript(viewerOrigin)), signal)
      )
      assertCurrent()
      const inner = measurementSchema.parse(
        await bounded(viewer.executeJavaScript(measurementScript(projectOrigin)), signal)
      )
      assertCurrent()
      if (
        outer.documentUrl !== root.url ||
        inner.documentUrl !== viewer.url ||
        originOf(outer.sourceUrl) !== viewerOrigin ||
        originOf(inner.sourceUrl) !== projectOrigin ||
        inner.devicePixelRatio !== outer.devicePixelRatio ||
        Math.abs(outer.rect.width - inner.viewportWidth) > 1 ||
        Math.abs(outer.rect.height - inner.viewportHeight) > 1 ||
        inner.rect.x + inner.rect.width > outer.rect.width ||
        inner.rect.y + inner.rect.height > outer.rect.height
      )
        throw unavailable()
      return { outer, inner }
    }
    assertCurrent()
    const initial = await measure()
    // DOM coordinates are CSS px in their respective documents. Sum offsets first; apply the
    // Electron page zoom once to obtain root-view DIPs. Never multiply by devicePixelRatio.
    const x = Math.ceil((initial.outer.rect.x + initial.inner.rect.x) * zoom)
    const y = Math.ceil((initial.outer.rect.y + initial.inner.rect.y) * zoom)
    const rect = {
      x,
      y,
      width:
        Math.floor(
          (initial.outer.rect.x + initial.inner.rect.x + initial.inner.rect.width) * zoom
        ) - x,
      height:
        Math.floor(
          (initial.outer.rect.y + initial.inner.rect.y + initial.inner.rect.height) * zoom
        ) - y
    }
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.width > 4096 ||
      rect.height > 4096 ||
      rect.width * rect.height > 4_194_304
    )
      throw unavailable()
    // capturePage accepts DIPs but returns a physical-pixel bitmap on Retina displays. The
    // trusted root DPR contains page zoom, so divide it out only for output-size verification.
    const displayScale = initial.outer.devicePixelRatio / zoom
    if (
      displayScale < 0.5 ||
      displayScale > 4 ||
      rect.width * rect.height * displayScale ** 2 > 16_777_216
    )
      throw unavailable()
    const confirmed = await measure()
    if (JSON.stringify(initial) !== JSON.stringify(confirmed)) throw unavailable()
    assertCurrent()
    const image = await bounded(contents.capturePage(rect), signal)
    assertCurrent()
    const after = await measure()
    if (JSON.stringify(initial) !== JSON.stringify(after) || image.isEmpty()) throw unavailable()
    const size = image.getSize()
    if (
      Math.abs(size.width - rect.width * displayScale) > 1 ||
      Math.abs(size.height - rect.height * displayScale) > 1
    )
      throw unavailable()
    const bytes = image.toPNG()
    assertCurrent()
    if (!bytes.byteLength || bytes.byteLength > 16 * 1024 * 1024) throw unavailable()
    return { bytes: Uint8Array.from(bytes) }
  }
}

/** Stable production entry point; importing this module does not initialize Electron. */
export const captureElectronObservationView: ElectronProjectCapture = createElectronProjectCapture()
