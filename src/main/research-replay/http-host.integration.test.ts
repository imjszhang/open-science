import { request, type IncomingHttpHeaders } from 'node:http'
import { afterEach, describe, it, expect } from 'vitest'
import { researchReplayHarness } from './test-support'
import { ResearchReplayHttpHost } from './http-host'
const hosts: ResearchReplayHttpHost[] = []
afterEach(() => {
  for (const host of hosts.splice(0)) host.close()
})
const call = (
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> =>
  new Promise((resolve, reject) => {
    const parsed = new URL(url),
      req = request(
        {
          hostname: '127.0.0.1',
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: options.method ?? 'GET',
          headers: { host: parsed.host, ...options.headers }
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
          res.on('end', () =>
            resolve({
              status: res.statusCode!,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8')
            })
          )
        }
      )
    req.on('error', reject)
    req.end(options.body === undefined ? undefined : JSON.stringify(options.body))
  })
async function setup(): Promise<{
  host: ResearchReplayHttpHost
  url: string
  origin: string
  cookie: string
  h: ReturnType<typeof researchReplayHarness>
}> {
  const h = researchReplayHarness(),
    host = new ResearchReplayHttpHost(h.service, async (path) =>
      path === 'index.html'
        ? { body: Buffer.from('<h1>Research</h1>'), mimeType: 'text/html' }
        : undefined
    )
  hosts.push(host)
  const view = await host.open(h.target, h.caller),
    bootstrap = await call(view.url)
  expect(bootstrap.status).toBe(303)
  return {
    host,
    url: view.url,
    origin: new URL(view.url).origin,
    cookie: bootstrap.headers['set-cookie']![0].split(';')[0],
    h
  }
}
describe('research Replay local HTTP boundary', () => {
  it('uses a one-time bootstrap, scoped HttpOnly cookie and readonly context', async () => {
    const h = await setup()
    expect((await call(h.url)).status).toBe(401)
    expect((await call(`${h.origin}/api/context`)).status).toBe(401)
    const context = await call(`${h.origin}/api/context`, { headers: { cookie: h.cookie } })
    expect(context.status).toBe(200)
    expect(JSON.parse(context.body)).toMatchObject({
      mode: 'research',
      target: h.h.target,
      canInteract: false,
      canCancel: false
    })
    const index = await call(h.origin, { headers: { cookie: h.cookie } })
    expect(index.headers['content-security-policy']).toContain("object-src 'none'")
    expect(
      (
        await call(`${h.origin}/api/research/read`, {
          method: 'POST',
          headers: {
            cookie: h.cookie,
            origin: 'http://evil.invalid',
            'content-type': 'application/json'
          },
          body: { kind: 'overview' }
        })
      ).status
    ).toBe(403)
    expect(
      (
        await call(`${h.origin}/api/context`, {
          headers: { host: 'evil.invalid', cookie: h.cookie }
        })
      ).status
    ).toBe(403)
  })
  it('enforces post origin, request bounds and avoids runtime or arbitrary routes', async () => {
    const h = await setup(),
      headers = { cookie: h.cookie, origin: h.origin, 'content-type': 'application/json' }
    expect(
      (await call(`${h.origin}/api/research/document`, { method: 'POST', headers, body: {} }))
        .status
    ).toBe(200)
    expect(
      (
        await call(`${h.origin}/api/research/read`, {
          method: 'POST',
          headers,
          body: { kind: 'steps', limit: 1000 }
        })
      ).status
    ).toBe(400)
    expect(
      (
        await call(`${h.origin}/api/research/read`, {
          method: 'POST',
          headers: { cookie: h.cookie, 'content-type': 'application/json' },
          body: { kind: 'overview' }
        })
      ).status
    ).toBe(403)
    expect(
      (await call(`${h.origin}/api/execute`, { method: 'POST', headers, body: {} })).status
    ).toBe(403)
    expect(
      (
        await call(`${h.origin}/api/research/read`, {
          method: 'POST',
          headers,
          body: { kind: 'overview', junk: 'x'.repeat(9000) }
        })
      ).status
    ).toBe(413)
    expect(
      (await call(`${h.origin}/api/research/resource?resourceId=foreign`, { headers })).status
    ).toBe(403)
  })
  it('serves exact resource byte ranges, blocks active documents and handles unsatisfiable ranges', async () => {
    const h = await setup(),
      url = `${h.origin}/api/research/resource?resourceId=artifact-version%3Aversion`
    const partial = await call(url, { headers: { cookie: h.cookie, range: 'bytes=1-4' } })
    expect(partial.status).toBe(206)
    expect(partial.body).toBe(h.h.content.subarray(1, 5).toString())
    expect(partial.headers['content-range']).toBe(`bytes 1-4/${h.h.content.length}`)
    expect(partial.headers['content-security-policy']).toBe("sandbox; default-src 'none'")
    expect(
      (await call(url, { headers: { cookie: h.cookie, range: 'bytes=999-1000' } })).status
    ).toBe(416)
    const context = JSON.parse(
      (await call(`${h.origin}/api/context`, { headers: { cookie: h.cookie } })).body
    )
    await h.host.service.revoke(context.viewerId, h.h.caller)
    expect((await call(url, { headers: { cookie: h.cookie } })).status).toBe(410)
  })
})
