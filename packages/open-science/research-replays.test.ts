import { describe, it, expect, vi } from 'vitest'
import { OpenScienceClient } from './index.mjs'
describe('research Replay SDK', () => {
  it('offers only read and view methods and preserves exact bounded selection requests', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: null }), {
          headers: { 'content-type': 'application/json' }
        })
    )
    const client = new OpenScienceClient({
      baseUrl: 'http://127.0.0.1:44100',
      token: 'test',
      fetch
    })
    const inputs = {
      open: { target: { projectId: 'p', sessionId: 's' } },
      read: { viewerId: 'v', query: { kind: 'steps', offset: 20, limit: 10 } },
      select: { viewerId: 'v', position: { branchId: 'b', stepId: 's', timeMs: 25 } },
      selection: { viewerId: 'v', selectionId: 'saved' },
      revoke: { viewerId: 'v' }
    }
    expect(Object.isFrozen(client.replays)).toBe(true)
    expect(Object.keys(client.replays)).toEqual(Object.keys(inputs))
    for (const [method, input] of Object.entries(inputs)) {
      await expect(client.replays[method](input)).resolves.toBeNull()
      expect(fetch).toHaveBeenLastCalledWith(
        `http://127.0.0.1:44100/api/v1/replays/${method}`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(input),
          headers: expect.objectContaining({ authorization: 'Bearer test' })
        })
      )
    }
  })
  it('rejects missing receiver scope and unbound reads before transport', () => {
    const fetch = vi.fn(),
      client = new OpenScienceClient({ baseUrl: 'http://127.0.0.1:44100', token: 'test', fetch })
    expect(() => client.replays.open({ target: { projectId: 'p' } })).toThrow(
      'receiving Project and Session'
    )
    expect(() => client.replays.selection({})).toThrow('viewer ID')
    expect(() => client.replays.read(null)).toThrow('object request')
    expect(fetch).not.toHaveBeenCalled()
  })
})
