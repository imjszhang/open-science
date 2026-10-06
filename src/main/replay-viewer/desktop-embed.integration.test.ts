import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { _electron, type ElectronApplication } from '@playwright/test'
import { expect, it } from 'vitest'

const enabled = process.env.RUN_OBSERVATION_DESKTOP_EMBED === '1' && process.platform === 'darwin'

/** Uses the production root CSP, production navigation guard, real registry and both actual HTTP
 * owners. A bare file:// iframe fixture cannot detect privileged desktop embedding regressions. */
it.skipIf(!enabled).each(['production', 'legacy-upgrade-absolute-redirect'] as const)(
  'checks real owner-bound desktop embedding: %s',
  async (policy) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'os-service-run-')))
    let electron: ElectronApplication | undefined
    try {
      const source = await readFile(resolve('src/renderer/index.html'), 'utf8')
      const productionCsp = source.match(
        /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/
      )?.[1]
      expect(productionCsp).toBeDefined()
      // Reproduce the removed policy too: even an absolute HTTP Location is rewritten, so
      // changing redirect spelling cannot exempt the scoped local viewer from global upgrades.
      const csp =
        productionCsp +
        (policy === 'legacy-upgrade-absolute-redirect' ? '; upgrade-insecure-requests' : '')
      const html = join(directory, 'index.html')
      await writeFile(
        html,
        `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body style="margin:0"><iframe id="viewer" title="Replay" sandbox="allow-scripts allow-same-origin allow-forms" style="border:0;width:100vw;height:100vh"></iframe></body></html>`
      )
      const main = join(directory, 'main.cjs')
      await build({
        stdin: {
          resolveDir: process.cwd(),
          sourcefile: 'desktop-embed-fixture.ts',
          loader: 'ts',
          contents: `
import { app, BrowserWindow, webFrameMain, protocol } from 'electron'
import { createServer, ServerResponse } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { createFrameNavigationGuard } from './src/main/navigation-policy'
import { installPreviewContextMenuBridge } from './src/main/preview-context-menu'
import { desktopObservationFrameRegistry } from './src/main/replay-viewer/desktop-frame-registry'
import { ReplayViewerHttpHost } from './src/main/replay-viewer/http-host'
import { createReplayViewerAssetReader } from './src/main/replay-viewer/assets'
import { ManagedRuntimeViews } from './src/main/managed-runtime-views'
import { RunObservationOwner } from './src/main/run-observation/owner'
import { ObservationViewers } from './src/main/run-observation/viewers'
import { createCallerContext } from './src/main/caller-context'
const entry = ${JSON.stringify(html)}
const directory = ${JSON.stringify(directory)}
const root = ${JSON.stringify(process.cwd())}
const decisions = []
const diagnostics = []
const menus = []
const nativeMenus = []
if (${JSON.stringify(policy)} === 'legacy-upgrade-absolute-redirect') {
  const writeHead = ServerResponse.prototype.writeHead
  ServerResponse.prototype.writeHead = function(status,headers) {
    if (status === 303 && headers?.location?.startsWith('/')) {
      headers = {...headers,location:'http://'+this.req.headers.host+headers.location}
      diagnostics.push({absoluteRedirectOrigin:new URL(headers.location).origin})
    }
    return writeHead.call(this,status,headers)
  }
}
const windows = []
let unauthorizedRequests = 0
protocol.registerSchemesAsPrivileged(['open-science-preview','open-science-office-preview'].map(scheme=>({scheme,privileges:{standard:true,secure:true,supportFetchAPI:true}})))
function windowWithProductionNavigation() {
  const window = new BrowserWindow({show:false,width:1200,height:1000,
    webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}})
  windows.push(window)
  window.webContents.on('console-message', details=>diagnostics.push(String(details.message).replace(/grant=[a-f0-9]+/g,'grant=REDACTED')))
  window.webContents.on('did-fail-load',(_event,code,description,url)=>diagnostics.push({code,description,url:url.split('?')[0]}))
  const guard = createFrameNavigationGuard((url,frame) => desktopObservationFrameRegistry.allows({
    url,frame,webContentsId:window.webContents.id,mainFrame:window.webContents.mainFrame
  }))
  const enforce = (details,processId,routingId) => {
    const frame = details.frame && typeof details.frame.frameTreeNodeId === 'number'
      ? details.frame : webFrameMain.fromId(details.processId ?? processId, details.routingId ?? routingId)
    const allowed = guard(details.url,details.isMainFrame,window.webContents.getURL(),frame)
    const url = new URL(details.url)
    decisions.push({allowed,origin:url.origin,path:url.pathname,windowId:window.webContents.id})
    if (!allowed) details.preventDefault()
  }
  window.webContents.on('will-frame-navigate', details => enforce(details))
  window.webContents.on('will-redirect',(details,_url,_inPlace,_main,processId,routingId)=>enforce(details,processId,routingId))
  const contents = window.webContents
  contents.on('context-menu',(_event,params)=>nativeMenus.push({url:params.frame?.url.split('?')[0],editable:params.isEditable}))
  const disposeMenuBridge = installPreviewContextMenuBridge({
    get mainFrame(){return contents.mainFrame},getZoomFactor:()=>contents.getZoomFactor(),
    on:(event,listener)=>contents.on(event,listener),removeListener:(event,listener)=>contents.removeListener(event,listener),
    send:(channel,payload)=>{menus.push(payload);contents.send(channel,payload)}
  })
  window.on('closed',disposeMenuBridge)
  return window
}
app.whenReady().then(async () => {
  for (const scheme of ['open-science-preview','open-science-office-preview'])
    protocol.handle(scheme,()=>new Response('<!doctype html><p id="legacy-preview">Existing managed preview</p><p id="passthrough" data-preview-context-menu-passthrough>Native menu area</p><input id="editable" value="Editable area">',{headers:{'Content-Type':'text/html'}}))
  const owner = windowWithProductionNavigation()
  await owner.loadFile(entry)
  const caller = createCallerContext({clientId:String(owner.webContents.id),
    lifecycleClientId:'electron:'+owner.webContents.id,leaseId:'electron:'+owner.webContents.id,
    surface:'electron',location:'local',principalKind:'human',actionOrigin:'human',
    isAuthorizationCurrent:()=>!owner.isDestroyed()})
  const scope = {projectId:'desktop-project',sessionId:'desktop-session',runId:'run',
    environmentId:'desktop-environment',generationId:randomUUID()}
  const proof = randomBytes(32).toString('hex')
  const proofPath = '/__proof_'+randomBytes(16).toString('hex')
  const socketPath = join(directory,'service.sock')
  const project = createServer((request,response) => {
    if (request.url === proofPath) {response.end(proof);return}
    response.setHeader('Content-Type','text/html; charset=utf-8')
    response.setHeader('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'")
    response.end('<!doctype html><html><body><h1 id="project-ready">Real bound project</h1><a id="project-next" href="/next">Next page</a></body></html>')
  })
  await new Promise(resolve=>project.listen(socketPath,resolve))
  const rogue = createServer((_request,response)=>{unauthorizedRequests++;response.end('unauthorized')})
  await new Promise(resolve=>rogue.listen(0,'127.0.0.1',resolve))
  const rogueOrigin = 'http://unregistered.localhost:'+rogue.address().port
  const lifetime = new AbortController()
  const projectViews = new ManagedRuntimeViews()
  const openProject = projectViews.open.bind(projectViews)
  projectViews.open = async (...args) => {try {return await openProject(...args)} catch(error) {diagnostics.push(String(error));throw error}}
  projectViews.register({scope,declaration:{title:'Bound project',entryPath:'/',adaptFrameAncestors:true},
    socketPath,proof:{path:proofPath,value:proof},logicalPort:4173,signal:lifetime.signal})
  const target = {projectId:scope.projectId,sessionId:scope.sessionId,runId:scope.runId}
  const observation = new RunObservationOwner({
    authorize:(target,viewer)=>viewers.assertViewer(target,viewer),
    read:async()=>({identity:target,phase:'running',artifacts:[],run:{
      runId:scope.runId,cellId:'cell',source:'agent',kernelKind:'bash',script:'printf observed',
      status:'running',startedAt:1,text:{stdout:'project ready',stderr:'',traceback:'',plain:[]},outputs:[],workingFiles:[]}})
  })
  const viewers = new ObservationViewers({observer:observation,authorizeScope:async()=>undefined,
    onRevoked:viewerId=>host.closeViewer(viewerId)})
  const host = new ReplayViewerHttpHost({viewers,projectViews,
    readAsset:createReplayViewerAssetReader(join(root,'out/replay-viewer'))})
  const access = await host.open(target,caller,{allowInteraction:true,desktopParent:'file:'})
  await owner.webContents.executeJavaScript('document.getElementById("viewer").src='+JSON.stringify(access.url))
  globalThis.fixture = {
    ownerId:owner.webContents.id,viewerOrigin:new URL(access.url).origin,rogueOrigin,
    decisions,diagnostics,menus,nativeMenus,requests:()=>unauthorizedRequests,
    zoom:value=>owner.webContents.setZoomFactor(value),
    other:async()=>{const other=windowWithProductionNavigation();await other.loadFile(entry);
      await other.webContents.executeJavaScript('document.getElementById("viewer").src='+JSON.stringify(new URL(access.url).origin+'/'));return other.webContents.id},
    endRun:()=>lifetime.abort(),
    revoke:()=>viewers.revoke(access.viewerId,{caller}),
    close:async()=>{await viewers.close();await host.close();await projectViews.close();observation.close();
      rogue.closeAllConnections();rogue.close();project.closeAllConnections();project.close();for(const window of windows)if(!window.isDestroyed())window.destroy()}
  }
}).catch(error=>{console.error(error);app.exit(1)})
app.on('window-all-closed',()=>app.quit())
`
        },
        outfile: main,
        platform: 'node',
        format: 'cjs',
        bundle: true,
        external: ['electron'],
        logLevel: 'silent'
      })
      electron = await _electron.launch({ args: [main], cwd: process.cwd() })
      const page = await electron.firstWindow()
      if (policy === 'legacy-upgrade-absolute-redirect') {
        await expect
          .poll(() =>
            electron!.evaluate(() => {
              const fixture = (
                globalThis as unknown as {
                  fixture?: {
                    decisions: Array<{ allowed: boolean; origin: string }>
                    diagnostics: Array<unknown>
                  }
                }
              ).fixture
              return (
                fixture && {
                  bootstrapAllowed: fixture.decisions.some(
                    (item) => item.allowed && item.origin.startsWith('http://viewer-')
                  ),
                  upgradedRejected: fixture.decisions.some(
                    (item) => !item.allowed && item.origin.startsWith('https://viewer-')
                  ),
                  absoluteRedirect: fixture.diagnostics.some(
                    (item) =>
                      typeof item === 'object' && item !== null && 'absoluteRedirectOrigin' in item
                  )
                }
              )
            })
          )
          .toEqual({ bootstrapAllowed: true, upgradedRejected: true, absoluteRedirect: true })
        return
      }
      const failures: string[] = []
      page.on('pageerror', (error) => failures.push(error.message))
      const redirects: string[] = []
      page.on('response', (response) => {
        if (response.status() === 303) redirects.push(new URL(response.url()).pathname)
      })
      const viewer = page.frameLocator('#viewer')
      await viewer.getByTestId('open-project-interface').click({ timeout: 20_000 })
      const project = viewer.frameLocator('iframe[title="Bound project"]')
      await project.locator('#project-ready').waitFor({ state: 'visible', timeout: 8000 })
      await project.locator('#project-next').click()
      await project.locator('#project-ready').waitFor({ state: 'visible' })
      expect(page.url()).toMatch(/^file:/)
      const viewerFrame = page.frames().find((frame) => /^http:\/\/viewer-/.test(frame.url()))!
      const projectFrame = page.frames().find((frame) => /^http:\/\/rv-/.test(frame.url()))!
      expect(new URL(viewerFrame.url()).pathname).toBe('/')
      await expect.poll(() => new URL(projectFrame.url()).pathname).toBe('/next')
      const viewerOrigin = new URL(viewerFrame.url()).origin
      const projectOrigin = new URL(projectFrame.url()).origin
      expect(redirects).toContain('/__open_science_view')
      expect(await viewerFrame.evaluate(() => document.cookie)).toBe('')
      expect(await projectFrame.evaluate(() => document.cookie)).toBe('')
      expect(failures).toEqual([])

      type Fixture = {
        ownerId: number
        rogueOrigin: string
        decisions: Array<{ allowed: boolean; origin: string; path: string; windowId: number }>
        menus: Array<{ x: number; y: number; frameUrl: string }>
        nativeMenus: Array<{ url: string; editable: boolean }>
        zoom(value: number): void
        requests(): number
        other(): Promise<number>
        endRun(): void
        revoke(): Promise<void>
        close(): Promise<void>
      }
      const state = (): Promise<{ decisions: Fixture['decisions']; requests: number }> =>
        electron!.evaluate(() => {
          const fixture = (globalThis as unknown as { fixture: Fixture }).fixture
          return { decisions: fixture.decisions, requests: fixture.requests() }
        })
      await expect
        .poll(async () =>
          (await state()).decisions.some(
            (decision) =>
              decision.allowed && decision.origin === viewerOrigin && decision.path === '/'
          )
        )
        .toBe(true)
      const rogueOrigin = await electron.evaluate(
        () => (globalThis as unknown as { fixture: Fixture }).fixture.rogueOrigin
      )
      const menus = (): Promise<{ sent: Fixture['menus']; native: Fixture['nativeMenus'] }> =>
        electron!.evaluate(() => {
          const fixture = (globalThis as unknown as { fixture: Fixture }).fixture
          return { sent: fixture.menus, native: fixture.nativeMenus }
        })
      await electron.evaluate(() =>
        (globalThis as unknown as { fixture: Fixture }).fixture.zoom(1.25)
      )
      await project.locator('#project-ready').click({ button: 'right' })
      await viewer.getByTestId('open-project-interface').click({ button: 'right' })
      await expect.poll(async () => (await menus()).native.length).toBe(2)
      expect((await menus()).native.map((item) => new URL(item.url).origin)).toEqual([
        projectOrigin,
        viewerOrigin
      ])
      // The unchanged production bridge rejects both HTTP surfaces before its async DOM check.
      expect((await menus()).sent).toEqual([])
      // This URL passes the CSP localhost namespace, but has no owner registry entry.
      await page.evaluate((url) => {
        const frame = document.createElement('iframe')
        frame.src = url
        document.body.appendChild(frame)
      }, rogueOrigin + '/')
      await expect
        .poll(async () =>
          (await state()).decisions.some(
            (decision) => !decision.allowed && decision.origin === rogueOrigin
          )
        )
        .toBe(true)
      expect((await state()).requests).toBe(0)
      const blockedResources = await page.evaluate(async (origin) => {
        const element = (tag: 'script' | 'img'): Promise<string> =>
          new Promise((resolve) => {
            const item = document.createElement(tag)
            item.onload = () => resolve('loaded')
            item.onerror = () => resolve('blocked')
            item.src = origin + '/' + tag
            document.body.appendChild(item)
          })
        return Promise.all([
          fetch(origin + '/fetch').then(
            () => 'loaded',
            () => 'blocked'
          ),
          element('script'),
          element('img')
        ])
      }, rogueOrigin)
      expect(blockedResources).toEqual(['blocked', 'blocked', 'blocked'])
      expect((await state()).requests).toBe(0)
      await page.evaluate((url) => {
        window.location.href = url
      }, rogueOrigin + '/top-navigation')
      await expect
        .poll(async () =>
          (await state()).decisions.some(
            (decision) =>
              !decision.allowed &&
              decision.origin === rogueOrigin &&
              decision.path === '/top-navigation'
          )
        )
        .toBe(true)
      expect(page.url()).toMatch(/^file:/)
      for (const [index, scheme] of [
        'open-science-preview',
        'open-science-office-preview'
      ].entries()) {
        await page.evaluate(
          ({ index, scheme }) => {
            const frame = document.createElement('iframe')
            frame.id = 'legacy-' + index
            frame.style.cssText =
              'position:fixed;left:50px;top:100px;width:500px;height:400px;border:0'
            frame.src = scheme + '://fixture/preview.html'
            document.body.appendChild(frame)
          },
          { index, scheme }
        )
        // Electron's custom-protocol navigation does not always emit the CDP lifecycle event
        // Playwright's locator waits for. Verify the loaded DOM in its actual frame instead.
        await expect
          .poll(async () => {
            const frame = page
              .frames()
              .find((item) => item.url() === scheme + '://fixture/preview.html')
            return frame?.evaluate(() => document.getElementById('legacy-preview')?.textContent)
          })
          .toBe('Existing managed preview')
        const frame = page
          .frames()
          .find((item) => item.url() === scheme + '://fixture/preview.html')!
        const clickLegacy = async (id: string): Promise<{ x: number; y: number }> => {
          const point = await frame.evaluate((id) => {
            const bounds = document.getElementById(id)!.getBoundingClientRect()
            return { x: bounds.left + 10, y: bounds.top + 8 }
          }, id)
          const rootPoint = { x: 50 + point.x, y: 100 + point.y }
          await page.mouse.click(rootPoint.x, rootPoint.y, { button: 'right' })
          return rootPoint
        }
        const before = await menus()
        const point = await clickLegacy('legacy-preview')
        await expect.poll(async () => (await menus()).sent.length).toBe(before.sent.length + 1)
        const request = (await menus()).sent.at(-1)!
        expect(request.frameUrl).toBe(scheme + '://fixture/preview.html')
        expect(Math.abs(request.x - point.x)).toBeLessThanOrEqual(1)
        expect(Math.abs(request.y - point.y)).toBeLessThanOrEqual(1)
        await clickLegacy('passthrough')
        await clickLegacy('editable')
        await expect.poll(async () => (await menus()).native.length).toBe(before.native.length + 3)
        // Wait for the real bridge's frame-query promises before asserting no dispatch.
        await electron.evaluate(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
        })
        expect((await menus()).sent.length).toBe(before.sent.length + 1)
        expect((await menus()).native.at(-1)?.editable).toBe(true)
        await page.evaluate((index) => document.getElementById('legacy-' + index)?.remove(), index)
      }
      await electron.evaluate(() => (globalThis as unknown as { fixture: Fixture }).fixture.zoom(1))

      // A registered project origin is still forbidden as a direct child of the privileged root.
      await page.evaluate((url) => {
        const frame = document.createElement('iframe')
        frame.src = url
        document.body.appendChild(frame)
      }, projectOrigin + '/wrong-parent')
      await expect
        .poll(async () =>
          (await state()).decisions.some(
            (decision) =>
              !decision.allowed &&
              decision.origin === projectOrigin &&
              decision.path === '/wrong-parent'
          )
        )
        .toBe(true)
      const otherId = await electron.evaluate(() =>
        (globalThis as unknown as { fixture: Fixture }).fixture.other()
      )
      await expect
        .poll(async () =>
          (await state()).decisions.some(
            (decision) =>
              !decision.allowed && decision.windowId === otherId && decision.origin === viewerOrigin
          )
        )
        .toBe(true)

      await electron.evaluate(() =>
        (globalThis as unknown as { fixture: Fixture }).fixture.endRun()
      )
      await viewerFrame.evaluate((url) => {
        document.querySelector('iframe')!.src = url
      }, projectOrigin + '/after-run')
      await expect
        .poll(async () =>
          (await state()).decisions.some(
            (decision) =>
              !decision.allowed &&
              decision.origin === projectOrigin &&
              decision.path === '/after-run'
          )
        )
        .toBe(true)
      await electron.evaluate(() =>
        (globalThis as unknown as { fixture: Fixture }).fixture.revoke()
      )
      await page.evaluate((url) => {
        ;(document.getElementById('viewer') as HTMLIFrameElement).src = url
      }, viewerOrigin + '/revoked')
      await expect
        .poll(async () =>
          (await state()).decisions.some(
            (decision) =>
              !decision.allowed && decision.origin === viewerOrigin && decision.path === '/revoked'
          )
        )
        .toBe(true)
    } catch (error) {
      const diagnostics = await electron
        ?.evaluate(() => {
          const fixture = (
            globalThis as unknown as { fixture?: { decisions: unknown; diagnostics: unknown } }
          ).fixture
          return fixture
            ? { decisions: fixture.decisions, diagnostics: fixture.diagnostics }
            : undefined
        })
        .catch(() => undefined)
      console.error('Desktop embedding diagnostics:', JSON.stringify(diagnostics))
      const frames = electron
        ? await Promise.all(
            (await electron.firstWindow()).frames().map(async (frame) => ({
              url: frame.url().split('?')[0],
              text: await frame
                .locator('body')
                .innerText({ timeout: 1000 })
                .catch(() => '')
            }))
          )
        : []
      console.error('Desktop embedding frames:', JSON.stringify(frames))
      throw error
    } finally {
      await electron?.close()
      await rm(directory, { recursive: true, force: true })
    }
  },
  60_000
)
