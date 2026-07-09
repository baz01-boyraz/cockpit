import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { ZodError } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createHermesTools, type HermesToolContext } from './hermesTools'

/** Loopback-only: the MCP server must never be reachable off this machine. */
const HOST = '127.0.0.1'
/** Default local port; override with the HERMES_MCP_PORT env var. */
export const DEFAULT_PORT = 47615
const MCP_PATH = '/mcp'
const SERVER_NAME = 'cockpit-hermes'
const SERVER_VERSION = '0.1.0'
/** Cap request bodies — a localhost client should never post megabytes at us. */
const MAX_BODY_BYTES = 1 * 1024 * 1024

/**
 * The env var name the `hermes` CLI carries the per-session bearer token in.
 * cockpiT injects it when it spawns the chat CLI; the CLI's `hermes mcp add`
 * config references `${COCKPIT_MCP_TOKEN}` in its Authorization header, so the
 * loopback token rotates every launch with zero user configuration. Exported so
 * the spawner (HermesChatService) and the server agree on one string.
 */
export const MCP_TOKEN_ENV = 'COCKPIT_MCP_TOKEN'

type LogError = (context: string, err: unknown) => void

const defaultLogError: LogError = (context, err) => {
  // Last-resort stderr — mirrors the main process's crash-log fallback. Hermes
  // is optional, so a transport error is logged, never fatal.
  console.error(`[HermesMcpServer] ${context}:`, err)
}

/**
 * A local MCP server (Streamable HTTP transport) hosted inside cockpiT's main
 * process, bound to 127.0.0.1 only. It exposes the narrow Faz 3 tool set so the
 * Hermes agent can drive the Swarm the way a human does — every tool re-parses
 * its input with the same Zod schema the renderer's IPC handler uses and calls
 * the underlying service in-process. No raw shell, no filesystem, no capability
 * beyond the six registered tools.
 *
 * Runs for the app's lifetime (cheap when idle — Hermes may or may not be
 * connected) and is torn down on shutdown. The `hermes mcp add` step that
 * connects Hermes to `{@link url}` is a one-time user action, out of scope here.
 */
export class HermesMcpServer {
  private http: HttpServer | null = null
  private readonly transports = new Map<string, StreamableHTTPServerTransport>()
  readonly port: number
  /**
   * Per-session bearer token. The server is loopback-only, but "local" is not a
   * trust boundary — any process on the machine could otherwise drive the tool
   * set. Every request must present `Authorization: Bearer <authToken>` or get a
   * 401. Minted fresh each launch so a leaked token dies with the process.
   */
  readonly authToken: string
  private readonly logError: LogError

  constructor(
    private readonly ctx: HermesToolContext,
    opts?: { port?: number; logError?: LogError },
  ) {
    this.port = opts?.port ?? resolvePort()
    this.authToken = randomBytes(32).toString('hex')
    this.logError = opts?.logError ?? defaultLogError
  }

  /** The endpoint a client connects to (for `hermes mcp add`). */
  get url(): string {
    return `http://${HOST}:${this.port}${MCP_PATH}`
  }

  async start(): Promise<void> {
    if (this.http) return
    const server = createServer((req, res) => {
      void this.handle(req, res)
    })
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        server.off('listening', onListening)
        reject(err)
      }
      const onListening = (): void => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.port, HOST)
    })
    // Late errors (e.g. a client socket reset) must not crash the process.
    server.on('error', (err) => this.logError('http server error', err))
    this.http = server
  }

  async stop(): Promise<void> {
    const server = this.http
    this.http = null
    for (const transport of this.transports.values()) {
      try {
        await transport.close()
      } catch (err) {
        this.logError('transport close failed', err)
      }
    }
    this.transports.clear()
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  private buildServer(): McpServer {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })
    for (const tool of createHermesTools(this.ctx)) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputShape },
        async (args: unknown): Promise<CallToolResult> => {
          try {
            const result = await tool.run(args)
            return { content: [{ type: 'text', text: JSON.stringify(result) }] }
          } catch (err) {
            // Surface a model-readable message, never a raw stack trace.
            return { content: [{ type: 'text', text: toToolError(err) }], isError: true }
          }
        },
      )
    }
    return server
  }

  private async createTransport(): Promise<StreamableHTTPServerTransport> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      // Reject requests whose Host header isn't loopback — defence against DNS
      // rebinding from a browser tab even though we already bind to 127.0.0.1.
      enableDnsRebindingProtection: true,
      allowedHosts: [`${HOST}:${this.port}`, `localhost:${this.port}`],
      onsessioninitialized: (id) => {
        this.transports.set(id, transport)
      },
    })
    transport.onclose = () => {
      const id = transport.sessionId
      if (id) this.transports.delete(id)
    }
    // A fresh McpServer per session (the SDK's multi-session pattern); wire the
    // transport up before any request reaches it.
    await this.buildServer().connect(transport)
    return transport
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!(req.url ?? '').startsWith(MCP_PATH)) {
        res.writeHead(404).end()
        return
      }
      // Auth gate: enforced before session lookup, body reading, or any MCP
      // transport work, so an unauthenticated caller can neither drive a tool
      // nor probe session state.
      if (!this.isAuthorized(req)) {
        respondUnauthorized(res)
        return
      }
      const header = req.headers['mcp-session-id']
      const sessionId = typeof header === 'string' ? header : undefined

      if (req.method === 'POST') {
        const body = await this.readBody(req)
        let transport = sessionId ? this.transports.get(sessionId) : undefined
        if (!transport) {
          if (sessionId || !isInitializeRequest(body)) {
            respondJsonRpcError(res, 400, 'No valid session for this request')
            return
          }
          transport = await this.createTransport()
        }
        await transport.handleRequest(req, res, body)
        return
      }

      if (req.method === 'GET' || req.method === 'DELETE') {
        const transport = sessionId ? this.transports.get(sessionId) : undefined
        if (!transport) {
          respondJsonRpcError(res, 400, 'Unknown or missing session id')
          return
        }
        await transport.handleRequest(req, res)
        return
      }

      res.writeHead(405).end()
    } catch (err) {
      this.logError('request handling failed', err)
      if (!res.headersSent) respondJsonRpcError(res, 500, 'Internal error')
    }
  }

  /**
   * Constant-time check of the `Authorization: Bearer <token>` header against
   * {@link authToken}. Length is guarded first (timingSafeEqual requires equal
   * buffers); an equal-length mismatch is compared without early-out so a
   * localhost attacker can't time-probe the token byte by byte.
   */
  private isAuthorized(req: IncomingMessage): boolean {
    const header = req.headers['authorization']
    if (typeof header !== 'string') return false
    const presented = Buffer.from(header)
    const expected = Buffer.from(`Bearer ${this.authToken}`)
    if (presented.length !== expected.length) return false
    return timingSafeEqual(presented, expected)
  }

  private async readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      const buf = chunk as Buffer
      size += buf.length
      if (size > MAX_BODY_BYTES) throw new Error('Request body exceeds size limit')
      chunks.push(buf)
    }
    const raw = Buffer.concat(chunks).toString('utf8')
    if (!raw) return undefined
    return JSON.parse(raw)
  }
}

function resolvePort(): number {
  const raw = process.env.HERMES_MCP_PORT
  if (raw) {
    const parsed = Number(raw)
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 65_536) return parsed
  }
  return DEFAULT_PORT
}

function toToolError(err: unknown): string {
  if (err instanceof ZodError) {
    const detail = err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    return `Invalid input: ${detail}`
  }
  return err instanceof Error ? err.message : 'Unknown error'
}

function respondJsonRpcError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }),
  )
}

/** 401 for a missing/invalid bearer token; advertises the required scheme. */
function respondUnauthorized(res: ServerResponse): void {
  res
    .writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' })
    .end(
      JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }),
    )
}
