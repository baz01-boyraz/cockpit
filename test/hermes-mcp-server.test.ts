import { createServer } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  HermesMcpServer,
  MCP_TOKEN_ENV,
} from '../electron/main/services/hermes/HermesMcpServer'
import type { HermesToolContext } from '../electron/main/services/hermes/hermesTools'

// --------------------------------------------------------------------------
// D3 — the loopback MCP server authenticates every request with a per-session
// bearer token. These tests exercise the auth gate only; they never complete an
// MCP initialize handshake (the tool context is a stub), so `createHermesTools`
// is never reached — the auth check runs strictly before any transport work.
// --------------------------------------------------------------------------

/** Grab a free ephemeral port so parallel test files never collide. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address()
      if (addr && typeof addr === 'object') {
        const { port } = addr
        probe.close(() => resolve(port))
      } else {
        probe.close(() => reject(new Error('no port assigned')))
      }
    })
  })
}

// The auth gate never touches the tool context — a stub is enough.
const stubCtx = {} as unknown as HermesToolContext
const silentLog = (): void => {}

const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.0' },
  },
})

const NON_INITIALIZE_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
  params: {},
})

describe('HermesMcpServer auth token', () => {
  let server: HermesMcpServer

  beforeEach(async () => {
    const port = await freePort()
    server = new HermesMcpServer(stubCtx, { port, logError: silentLog })
    await server.start()
  })

  afterEach(async () => {
    await server.stop()
  })

  const post = (headers: Record<string, string>, body: string): Promise<Response> =>
    fetch(`${server.url}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body,
    })

  it('exposes a 64-char hex bearer token (crypto.randomBytes(32))', () => {
    expect(server.authToken).toMatch(/^[0-9a-f]{64}$/)
  })

  it('mints a distinct token per instance', async () => {
    const port = await freePort()
    const other = new HermesMcpServer(stubCtx, { port, logError: silentLog })
    expect(other.authToken).not.toBe(server.authToken)
    expect(other.authToken).toMatch(/^[0-9a-f]{64}$/)
  })

  it('names the env var the CLI carries the token in', () => {
    expect(MCP_TOKEN_ENV).toBe('COCKPIT_MCP_TOKEN')
  })

  it('rejects a POST with no Authorization header (401)', async () => {
    const res = await post({}, INITIALIZE_BODY)
    expect(res.status).toBe(401)
    await res.body?.cancel()
  })

  it('rejects a POST with a wrong bearer token (401)', async () => {
    const res = await post({ authorization: 'Bearer not-the-real-token' }, INITIALIZE_BODY)
    expect(res.status).toBe(401)
    await res.body?.cancel()
  })

  it('rejects a POST whose token is a prefix of the real one (constant-time, length-guarded)', async () => {
    const res = await post(
      { authorization: `Bearer ${server.authToken.slice(0, 32)}` },
      INITIALIZE_BODY,
    )
    expect(res.status).toBe(401)
    await res.body?.cancel()
  })

  it('lets an authorized request past the gate (no 401)', async () => {
    // Correct token + a non-initialize, session-less body: the auth gate passes,
    // so the MCP layer answers "No valid session" (400), never 401. That proves
    // the request cleared authentication.
    const res = await post(
      { authorization: `Bearer ${server.authToken}` },
      NON_INITIALIZE_BODY,
    )
    expect(res.status).not.toBe(401)
    expect(res.status).toBe(400)
    await res.body?.cancel()
  })

  it('rejects an unauthenticated GET (401)', async () => {
    const res = await fetch(`${server.url}`, {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
    })
    expect(res.status).toBe(401)
    await res.body?.cancel()
  })

  it('rejects an unauthenticated DELETE (401)', async () => {
    const res = await fetch(`${server.url}`, { method: 'DELETE' })
    expect(res.status).toBe(401)
    await res.body?.cancel()
  })

  it('still 404s an unknown path without leaking the auth requirement', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/nope`, { method: 'GET' })
    expect(res.status).toBe(404)
    await res.body?.cancel()
  })
})
