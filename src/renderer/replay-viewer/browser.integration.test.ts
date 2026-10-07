import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, chmod, realpath, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { it } from 'vitest'
import { ManagedRuntimeViews } from '../../main/managed-runtime-views'
import { RunObservationOwner, type RunObservationSource } from '../../main/run-observation/owner'
import { ObservationViewers } from '../../main/run-observation/viewers'
import { ReplayViewerHttpHost } from '../../main/replay-viewer/http-host'
import { createReplayViewerAssetReader } from '../../main/replay-viewer/assets'
import { createCallerContext } from '../../main/caller-context'

// Build with npm run build:replay-viewer, then run this opt-in real-browser acceptance:
// RUN_REPLAY_VIEWER_BROWSER=1 npx vitest run src/renderer/replay-viewer/browser.integration.test.ts
it.skipIf(process.env.RUN_REPLAY_VIEWER_BROWSER !== '1' || process.platform === 'win32').each([
  { scenario: 'short log', longLogs: false },
  { scenario: 'overflowing streamed log', longLogs: true }
])(
  'production Replay observes real projections and keeps project frames stable: $scenario',
  async ({ longLogs }) => {
    const cleanups: Array<() => Promise<unknown> | void> = []
    const root = await realpath(await mkdtemp(join(tmpdir(), 'os-service-browser-run-')))
    await chmod(root, 0o700)
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const scope = {
      projectId: 'browser-project',
      sessionId: 'browser-session',
      runId: 'browser-run',
      environmentId: 'browser-environment',
      generationId: randomUUID()
    }
    const target = { projectId: scope.projectId, sessionId: scope.sessionId, runId: scope.runId }
    const proof = randomBytes(32).toString('hex'),
      proofPath = `/__open_science_proof_${randomBytes(16).toString('hex')}`
    let projectLoads = 0,
      projectViewRequests = 0,
      count = 0
    const project = createServer((req, res) => {
      if (req.url === proofPath) {
        res.end(proof)
        return
      }
      if (req.url === '/increment') {
        count++
        res.end(String(count))
        return
      }
      if (req.url === '/app.js') {
        res.setHeader('content-type', 'application/javascript')
        res.end(
          "document.querySelector('button').onclick=async()=>{document.querySelector('output').textContent=await fetch('/increment',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.text())}"
        )
        return
      }
      projectLoads++
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(
        '<!doctype html><html><body><h1>Interactive project</h1><button>Increment</button><output>0</output><script src="/app.js"></script></body></html>'
      )
    })
    const socketPath = join(root, 'service.sock')
    await new Promise<void>((done, fail) => {
      project.once('error', fail)
      project.listen(socketPath, done)
    })
    cleanups.push(
      () =>
        new Promise<void>((done) => {
          project.closeAllConnections()
          project.close(() => done())
        })
    )
    const abort = new AbortController(),
      projectViews = new ManagedRuntimeViews()
    cleanups.push(() => projectViews.close())
    projectViews.register({
      scope,
      declaration: { title: 'Interactive project' },
      socketPath,
      proof: { path: proofPath, value: proof },
      logicalPort: 4173,
      signal: abort.signal
    })
    let startupOutput = longLogs
      ? [
          'project started',
          ...Array.from(
            { length: 240 },
            (_, index) => `log line ${index}: observing the current offline run`
          )
        ].join('\n')
      : 'project started'
    let source: RunObservationSource = {
      identity: target,
      phase: 'running',
      artifacts: [],
      run: {
        runId: scope.runId,
        cellId: 'cell',
        source: 'agent',
        kernelKind: 'bash',
        script: '',
        status: 'running',
        startedAt: Date.now(),
        text: { stdout: startupOutput, stderr: '', traceback: '', plain: [] },
        outputs: [],
        workingFiles: []
      }
    }
    const observer = new RunObservationOwner({
      authorize: (requested, viewer) => viewers.assertViewer(requested, viewer),
      read: async () => source
    })
    const viewers = new ObservationViewers({
      observer,
      authorizeScope: async () => undefined,
      onRevoked: (viewerId) => host.closeViewer(viewerId)
    })
    cleanups.push(() => viewers.close())
    const host = new ReplayViewerHttpHost({
      viewers,
      projectViews,
      recordingStatus: async (target) => ({ target, state: 'not-recorded' }),
      readAsset: createReplayViewerAssetReader(resolve('out/replay-viewer'))
    })
    cleanups.push(() => host.close())
    const caller = createCallerContext({
      clientId: 'browser-fixture',
      lifecycleClientId: 'browser-fixture',
      leaseId: 'browser-fixture',
      surface: 'task',
      location: 'local',
      principalKind: 'automation',
      actionOrigin: 'automation'
    })
    const errors: string[] = []
    try {
      const browser = await chromium.launch({ headless: true })
      cleanups.push(() => browser.close())
      const page = await browser.newPage()
      const evidence = longLogs
        ? '/tmp/replay-viewer-overflow-browser-acceptance'
        : '/tmp/replay-viewer-production-browser-acceptance'
      await mkdir(evidence, { recursive: true })
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/project-view') projectViewRequests++
      })
      page.on('console', (message) => {
        if (message.type() === 'error')
          errors.push(message.text().replace(/grant=[a-f0-9]+/g, 'grant=[redacted]'))
      })
      const access = await host.open(target, caller, { allowInteraction: true })
      await page.setViewportSize({ width: 1100, height: 900 })
      await page.goto(access.url)
      const log = page.getByTestId('replay-live-record').locator('pre').first()
      await expect(log).toHaveText(startupOutput)
      if (longLogs) {
        for (let index = 0; index < 8; index++) {
          startupOutput += `\nstreamed log update ${index}`
          source = {
            ...source,
            run: { ...source.run!, text: { ...source.run!.text, stdout: startupOutput } }
          }
          await new Promise((done) => setTimeout(done, 30))
        }
        await expect(log).toHaveText(startupOutput)
        await expect
          .poll(() =>
            page
              .getByRole('region', { name: 'Execution record', exact: true })
              .evaluate((element) => element.scrollTop)
          )
          .toBeGreaterThan(1000)
      }
      expect(await page.evaluate(() => 'api' in window)).toBe(false)
      expect(await page.evaluate(() => document.cookie)).toBe('')
      expect(projectLoads).toBe(0)
      await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: 'Ask about this step', exact: true }).click()
      const reference = page.getByRole('textbox', { name: 'Recorded step reference' })
      await expect(reference).toBeVisible()
      const captured = JSON.parse(await reference.inputValue())
      expect(captured.viewerId).toBe(access.viewerId)
      const selection = await viewers.selection(access.viewerId, { caller })
      expect(selection?.selectionId).toBe(captured.selectionId)
      expect(selection?.snapshot.run?.logs.stdout.text).toBe(startupOutput)
      await page.getByRole('button', { name: 'Back to live', exact: true }).click()
      const beforeProjectClick = {
        button: await page
          .getByRole('button', { name: 'Project interface', exact: true })
          .boundingBox(),
        viewport: page.viewportSize(),
        scrollTop: await page
          .getByRole('region', { name: 'Execution record', exact: true })
          .evaluate((element) => element.scrollTop)
      }
      if (longLogs) {
        // Accessibility-driven activation may reveal a control before dispatching its click.
        // Settling that real browser scroll must not turn this mode switch into history inspection.
        await expect(page.getByRole('group', { name: 'Run view', exact: true })).toBeInViewport({
          ratio: 1
        })
        await page.screenshot({ path: join(evidence, 'replay-viewer-following-long-log.png') })
        await page
          .getByRole('button', { name: 'Project interface', exact: true })
          .scrollIntoViewIfNeeded()
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            )
        )
      }
      await page.getByRole('button', { name: 'Project interface', exact: true }).click()
      const projectFrame = page.frameLocator('iframe[title="Interactive project"]')
      await expect(projectFrame.getByRole('heading', { name: 'Interactive project' }))
        .toBeVisible()
        .catch(async (error) => {
          await page.screenshot({ path: join(evidence, 'failure.png') })
          await writeFile(
            join(evidence, 'failure.json'),
            JSON.stringify({
              beforeProjectClick,
              body: await page.locator('body').innerText(),
              errors,
              projectLoads
            })
          )
          throw error
        })
      await projectFrame.getByRole('button', { name: 'Increment' }).click()
      await expect(projectFrame.locator('output')).toHaveText('1')
      await expect(projectFrame.getByRole('button', { name: 'Increment' })).toBeInViewport()
      const frame = await page.locator('iframe[title="Interactive project"]').elementHandle()
      // Project interaction includes the surrounding viewport padding and the gap below its
      // controls. These real pointer/wheel/key events must not freeze the live timeline.
      const projectRegion = page.getByRole('region', { name: 'Execution record', exact: true })
      const projectBounds = (await projectRegion.boundingBox())!
      const margin = { x: projectBounds.x + 2, y: projectBounds.y + projectBounds.height / 2 }
      await page.mouse.click(margin.x, margin.y)
      await expect(page.getByRole('button', { name: 'Pause following', exact: true })).toBeVisible()
      await expect(projectFrame.locator('output')).toBeVisible()
      await page.mouse.move(margin.x, margin.y)
      await page.mouse.wheel(0, -120)
      await page.keyboard.press('PageDown')
      const projectControls = (await page
        .getByRole('group', { name: 'Run view', exact: true })
        .boundingBox())!
      await page.mouse.click(
        projectControls.x + projectControls.width / 2,
        projectControls.y + projectControls.height + 3
      )
      await expect(page.getByRole('button', { name: 'Pause following', exact: true })).toBeVisible()
      await expect(projectFrame.locator('output')).toHaveText('1')
      const beforeProjectUpdate = await page
        .locator('[data-observation-record]')
        .getAttribute('data-observation-record')
      startupOutput += '\nupdate while interacting with project margins'
      source = {
        ...source,
        run: { ...source.run!, text: { ...source.run!.text, stdout: startupOutput } }
      }
      await expect
        .poll(() =>
          page.locator('[data-observation-record]').getAttribute('data-observation-record')
        )
        .not.toBe(beforeProjectUpdate)
      expect(await frame?.evaluate((node) => node.isConnected)).toBe(true)
      expect(projectLoads).toBe(1)
      await page.getByRole('button', { name: 'Execution record', exact: true }).click()
      await expect(page.locator('iframe[title="Interactive project"]')).toBeHidden()
      await page.getByRole('button', { name: 'Project interface', exact: true }).click()
      await expect(projectFrame.locator('output')).toHaveText('1')
      await expect(projectFrame.getByRole('button', { name: 'Increment' })).toBeInViewport()
      if (longLogs) {
        await page.getByRole('button', { name: 'Execution record', exact: true }).click()
        await expect(page.getByRole('group', { name: 'Run view', exact: true })).toBeInViewport({
          ratio: 1
        })
        const region = page.getByRole('region', { name: 'Execution record', exact: true })
        const bounds = (await region.boundingBox())!
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height - 40)
        await page.mouse.wheel(0, -180)
        await expect(page.getByRole('button', { name: 'Back to live', exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Project interface', exact: true }).click()
        await expect(page.locator('iframe[title="Interactive project"]')).toBeHidden()
        expect(projectLoads).toBe(1)
        expect(projectViewRequests).toBe(1)
        await page.getByRole('button', { name: 'Back to live', exact: true }).click()
        await expect(projectFrame.locator('output')).toHaveText('1')
      }
      await page.getByRole('button', { name: 'Pause following', exact: true }).click()
      await expect(page.locator('iframe[title="Interactive project"]')).toBeHidden()
      expect(await frame?.evaluate((node) => node.closest('[inert]') !== null)).toBe(true)
      const frozenRecord = await page
        .locator('[data-observation-record]')
        .getAttribute('data-observation-record')
      const observedChange = page.waitForResponse(async (response) => {
        if (!response.url().endsWith('/api/changes') || response.status() !== 200) return false
        const change = await response.json()
        return change.kind === 'delta' && change.cursor.sequence > captured.cursor.sequence
      })
      source = {
        ...source,
        executionContext: { purpose: 'offline-demo', conditionChanges: [] },
        run: {
          ...source.run!,
          text: { ...source.run!.text, stdout: `${startupOutput}\nlater output` }
        }
      }
      await observedChange
      expect(
        await page.locator('[data-observation-record]').getAttribute('data-observation-record')
      ).toBe(frozenRecord)
      await page.getByRole('button', { name: 'Ask about this step', exact: true }).click()
      await expect
        .poll(
          async () =>
            (await viewers.history(access.viewerId, { caller })).snapshots.at(-1)?.run?.logs.stdout
              .text
        )
        .toContain('later output')
      expect(
        (await viewers.selection(access.viewerId, { caller }))?.snapshot.run?.logs.stdout.text
      ).toBe(startupOutput)
      await page.getByRole('button', { name: 'Back to live', exact: true }).click()
      await expect(page.getByText('Offline demo', { exact: true })).toBeVisible()
      await expect(projectFrame.locator('output')).toHaveText('1')
      await expect(projectFrame.getByRole('button', { name: 'Increment' })).toBeInViewport()
      expect(await frame?.evaluate((node) => node.isConnected)).toBe(true)
      expect(projectLoads).toBe(1)
      expect(projectViewRequests).toBe(1)
      await page.screenshot({ path: join(evidence, 'replay-viewer-wide.png') })
      await page.setViewportSize({ width: 560, height: 850 })
      await expect(projectFrame.getByRole('button', { name: 'Increment' })).toBeInViewport()
      expect(projectLoads).toBe(1)
      await page.screenshot({ path: join(evidence, 'replay-viewer-narrow.png') })
      await writeFile(
        join(evidence, 'result.json'),
        JSON.stringify(
          {
            longLogs,
            beforeProjectClick,
            projectLoads,
            projectViewRequests,
            projectMarginInteractionsPreserved: true,
            manualInspectionPreserved: longLogs,
            errors
          },
          null,
          2
        )
      )
      expect(errors).toEqual([])
    } finally {
      abort.abort()
      for (const cleanup of cleanups.reverse()) await cleanup()
    }
  },
  60000
)

it.skipIf(process.env.RUN_REPLAY_VIEWER_BROWSER !== '1')(
  'production recorded viewer reads portable evidence and safe media without a live Run',
  async () => {
    const { recordedFixture } =
      await import('../../main/run-observation/recorded-viewer.test-support')
    const { payload: recordedPayload, bytes } = recordedFixture()
    const payload = {
      ...recordedPayload,
      executionContext: { purpose: 'offline-demo' as const, conditionChanges: [] }
    }
    const caller = createCallerContext({
      clientId: 'archive-browser',
      lifecycleClientId: 'archive-browser',
      leaseId: 'archive-browser',
      surface: 'task',
      location: 'local',
      principalKind: 'automation',
      actionOrigin: 'automation'
    })
    let liveReads = 0,
      projectRequests = 0
    const observer = new RunObservationOwner({
      authorize: async () => undefined,
      read: async () => {
        liveReads++
        throw new Error('No local Run exists')
      }
    })
    const viewers = new ObservationViewers({
      observer,
      authorizeScope: async () => {
        liveReads++
        throw new Error('No live scope exists')
      },
      recorded: { authorizeScope: async () => undefined, read: async () => payload },
      onRevoked: (viewerId) => host.closeViewer(viewerId)
    })
    const host = new ReplayViewerHttpHost({
      viewers,
      projectViews: {
        open: async () => {
          projectRequests++
          throw new Error('No live project')
        },
        closeViewer: () => undefined
      },
      readAsset: createReplayViewerAssetReader(resolve('out/replay-viewer')),
      readRecordingMedia: async (target, key) => {
        expect(target).toEqual(payload.receiving)
        expect(key).toBe('export-a')
        return { body: bytes, mimeType: 'text/html' }
      }
    })
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1000, height: 850 } })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error')
        errors.push(message.text().replace(/grant=[a-f0-9]+/g, 'grant=[redacted]'))
    })
    try {
      const access = await host.openRecorded(payload.receiving, caller)
      await page.goto(access.url)
      await expect(page.getByText('Actual author output', { exact: true })).toBeVisible()
      expect(await page.evaluate(() => 'api' in window)).toBe(false)
      expect(await page.evaluate(() => document.cookie)).toBe('')
      await expect(page.getByTestId('open-project-interface')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: 'Ask about this step', exact: true }).click()
      const reference = page.getByRole('textbox', { name: 'Recorded step reference' })
      await expect(reference).toBeVisible()
      const parsed = JSON.parse(await reference.inputValue())
      expect(parsed).toMatchObject({
        kind: 'open-science-recorded-observation',
        viewerId: access.viewerId,
        receiving: payload.receiving,
        stepKey: 'observation-0'
      })
      const selected = await viewers.recordingSelection(access.viewerId, { caller })
      expect(selected?.record.sourceEvidence.identity.runId).toBe('author-run')
      expect(selected?.executionContext).toEqual(payload.executionContext)
      await expect(page.getByText('Offline demo', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'View files', exact: true }).click()
      await page.getByRole('button', { name: 'project.html', exact: true }).click()
      await expect(
        page
          .frameLocator('iframe[title="project.html"]')
          .getByRole('heading', { name: 'Recorded project export' })
      ).toBeVisible()
      expect(await page.locator('iframe[title="project.html"]').getAttribute('sandbox')).toBe('')
      const evidence = '/tmp/replay-viewer-production-browser-acceptance'
      await mkdir(evidence, { recursive: true })
      await page.screenshot({ path: join(evidence, 'recorded-viewer.png') })
      expect(errors).toEqual([])
      expect(liveReads).toBe(0)
      expect(projectRequests).toBe(0)
    } finally {
      await browser.close()
      await host.close()
      await viewers.close()
    }
  },
  60000
)
