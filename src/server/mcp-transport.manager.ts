import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from 'pino';
import { createMcpServer } from './mcp.server.js';
import type { ToolRegistry } from '../tools/tool.registry.js';
import type { AppConfig } from '../types/config.types.js';

const SESSION_HEADER = 'mcp-session-id';

interface Session {
  readonly server: McpServer;
  readonly transport: StreamableHTTPServerTransport;
  lastSeenAt: number;
}

export interface McpTransportManagerDependencies {
  readonly config: AppConfig;
  readonly toolRegistry: ToolRegistry;
  readonly logger: Logger;
}

/**
 * Owns MCP transport lifecycle for the Streamable HTTP endpoint.
 *
 * Copilot Studio speaks only Streamable HTTP (`mcp-streamable-1.0`); SSE was
 * dropped as a supported transport after August 2025, so it is not
 * implemented here.
 *
 * Two session strategies are supported, and the choice is an operational one:
 *
 * - **stateless** (default): a fresh `McpServer` + transport per request,
 *   torn down when the response completes. Nothing is remembered between
 *   requests, so any App Service instance can serve any request. This is what
 *   makes scale-out, instance recycling, and blue/green slot swaps safe
 *   without ARR session affinity.
 *
 * - **stateful**: sessions are held in process memory and keyed by
 *   `mcp-session-id`. Required only if you add tools that need continuity
 *   between calls, and it forces sticky routing — a follow-up request landing
 *   on another instance would 404.
 */
export class McpTransportManager {
  private readonly config: AppConfig;
  private readonly toolRegistry: ToolRegistry;
  private readonly logger: Logger;

  private readonly sessions = new Map<string, Session>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private closing = false;

  constructor(deps: McpTransportManagerDependencies) {
    this.config = deps.config;
    this.toolRegistry = deps.toolRegistry;
    this.logger = deps.logger.child({ component: 'mcp-transport' });

    if (this.config.mcp.sessionMode === 'stateful') {
      this.startSweeper();
    }
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Routes one HTTP request into the MCP transport.
   *
   * `parsedBody` is passed explicitly because Fastify has already consumed and
   * parsed the request stream; without it the transport would wait forever on
   * a body that can no longer be read.
   */
  async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody: unknown
  ): Promise<void> {
    if (this.config.mcp.sessionMode === 'stateless') {
      await this.handleStateless(req, res, parsedBody);
      return;
    }

    await this.handleStateful(req, res, parsedBody);
  }

  private async handleStateless(
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody: unknown
  ): Promise<void> {
    const server = createMcpServer({
      config: this.config,
      toolRegistry: this.toolRegistry,
      logger: this.logger,
    });

    // `sessionIdGenerator: undefined` is the SDK's explicit opt-out of session
    // management — no session id is issued and none is validated.
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: this.config.mcp.enableJsonResponse,
    });

    // Tear down when the response finishes, however it finishes. Without this
    // every request would leak a server and a transport.
    res.on('close', () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });

    await connectTransport(server, transport);
    await transport.handleRequest(req, res, parsedBody);
  }

  private async handleStateful(
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody: unknown
  ): Promise<void> {
    const sessionId = readSessionId(req);
    const existing = sessionId === null ? undefined : this.sessions.get(sessionId);

    if (existing !== undefined) {
      existing.lastSeenAt = Date.now();
      await existing.transport.handleRequest(req, res, parsedBody);
      return;
    }

    // Only an `initialize` request may create a session. Anything else
    // referencing an unknown session is answered by the transport itself with
    // the protocol-correct error.
    if (!isInitializeRequest(parsedBody)) {
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: this.config.mcp.enableJsonResponse,
      });
      const server = createMcpServer({
        config: this.config,
        toolRegistry: this.toolRegistry,
        logger: this.logger,
      });

      res.on('close', () => {
        void transport.close().catch(() => undefined);
        void server.close().catch(() => undefined);
      });

      await connectTransport(server, transport);
      await transport.handleRequest(req, res, parsedBody);
      return;
    }

    this.evictIfAtCapacity();

    const server = createMcpServer({
      config: this.config,
      toolRegistry: this.toolRegistry,
      logger: this.logger,
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: this.config.mcp.enableJsonResponse,
      onsessioninitialized: (id: string) => {
        this.sessions.set(id, { server, transport, lastSeenAt: Date.now() });
        this.logger.info(
          { sessionId: id, sessionCount: this.sessions.size },
          'MCP session opened.'
        );
      },
      onsessionclosed: (id: string) => {
        this.sessions.delete(id);
        this.logger.info(
          { sessionId: id, sessionCount: this.sessions.size },
          'MCP session closed.'
        );
      },
    });

    transport.onclose = (): void => {
      const id = transport.sessionId;
      if (id !== undefined) {
        this.sessions.delete(id);
      }
    };

    await connectTransport(server, transport);
    await transport.handleRequest(req, res, parsedBody);
  }

  /** Closes every session and stops the sweeper. */
  async close(): Promise<void> {
    if (this.closing) {
      return;
    }
    this.closing = true;

    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }

    const sessions = [...this.sessions.values()];
    this.sessions.clear();

    await Promise.allSettled(
      sessions.flatMap((session) => [session.transport.close(), session.server.close()])
    );

    this.logger.info({ closed: sessions.length }, 'Closed all MCP sessions.');
  }

  /**
   * Bounds memory when clients disconnect without sending DELETE — which is
   * the common case, since a crashed or redeployed client never says goodbye.
   */
  private startSweeper(): void {
    const interval = Math.max(30_000, Math.floor(this.config.mcp.sessionTtlMs / 4));

    this.sweepTimer = setInterval(() => {
      const cutoff = Date.now() - this.config.mcp.sessionTtlMs;

      for (const [id, session] of this.sessions) {
        if (session.lastSeenAt < cutoff) {
          this.sessions.delete(id);
          void session.transport.close().catch(() => undefined);
          void session.server.close().catch(() => undefined);
          this.logger.info({ sessionId: id }, 'Expired idle MCP session.');
        }
      }
    }, interval);

    // A background sweeper must never hold the process open at shutdown.
    this.sweepTimer.unref();
  }

  /** Evicts the least-recently-used session once the cap is reached. */
  private evictIfAtCapacity(): void {
    if (this.sessions.size < this.config.mcp.maxSessions) {
      return;
    }

    let oldestId: string | null = null;
    let oldestSeenAt = Number.POSITIVE_INFINITY;

    for (const [id, session] of this.sessions) {
      if (session.lastSeenAt < oldestSeenAt) {
        oldestSeenAt = session.lastSeenAt;
        oldestId = id;
      }
    }

    if (oldestId === null) {
      return;
    }

    const victim = this.sessions.get(oldestId);
    this.sessions.delete(oldestId);
    void victim?.transport.close().catch(() => undefined);
    void victim?.server.close().catch(() => undefined);

    this.logger.warn(
      { sessionId: oldestId, maxSessions: this.config.mcp.maxSessions },
      'Evicted least-recently-used MCP session at capacity.'
    );
  }
}

/**
 * Connects a server to a transport.
 *
 * The cast exists because of a genuine mismatch in the SDK's own typings: the
 * `Transport` interface declares `onclose?: () => void`, while
 * `StreamableHTTPServerTransport` exposes it as an accessor typed
 * `(() => void) | undefined`. Under `exactOptionalPropertyTypes` those are not
 * assignable, even though they are identical at runtime — the SDK's transport
 * simply cannot be passed to the SDK's own `connect`.
 *
 * The unsoundness is quarantined in this one function rather than repeated at
 * every call site, and certainly rather than disabling
 * `exactOptionalPropertyTypes` for the whole project to accommodate one
 * third-party typing gap.
 */
async function connectTransport(
  server: McpServer,
  transport: StreamableHTTPServerTransport
): Promise<void> {
  await server.connect(transport as unknown as Parameters<McpServer['connect']>[0]);
}

function readSessionId(req: IncomingMessage): string | null {
  const raw = req.headers[SESSION_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
