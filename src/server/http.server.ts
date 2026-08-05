import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import underPressure from '@fastify/under-pressure';
import { McpTransportManager } from './mcp-transport.manager.js';
import { registerHealthRoutes } from './routes/health.routes.js';
import { registerMcpRoutes } from './routes/mcp.routes.js';
import { registerPingRoutes } from './routes/ping.routes.js';
import { registerApiKeyAuth } from '../middleware/api-key-auth.middleware.js';
import { registerErrorHandler } from '../middleware/error-handler.middleware.js';
import {
  registerRequestContext,
  resolveRequestId,
} from '../middleware/request-context.middleware.js';
import { RateLimitError } from '../utils/errors.js';
import type { Container } from '../container/container.js';
import type { AppFastifyInstance } from '../types/http.types.js';

export interface HttpServer {
  readonly app: AppFastifyInstance;
  readonly transportManager: McpTransportManager;
  /** Flips to false when shutdown starts, draining the load balancer. */
  setAcceptingTraffic(accepting: boolean): void;
}

/**
 * Assembles the Fastify application.
 *
 * Registration order is behaviour, not style. Hooks run in the order added,
 * so this sequence is what makes every rejected request still carry a
 * `requestId`, and what keeps an unauthenticated caller from ever reaching the
 * MCP transport:
 *
 *   1. request context  — every later log line and error is correlated
 *   2. security headers
 *   3. rate limiting    — cheapest rejection first, before any crypto work
 *   4. API key auth     — before routing, so no handler sees an anonymous call
 *   5. routes
 *   6. error handler    — one exit point for every failure
 */
export async function createHttpServer(container: Container): Promise<HttpServer> {
  const { config, logger } = container;
  const startedAt = Date.now();
  let acceptingTraffic = true;

  const app = Fastify({
    loggerInstance: logger,
    // Azure App Service terminates TLS and forwards through a reverse proxy;
    // without this, every client IP would be logged as the proxy's.
    trustProxy: config.http.trustProxy,
    bodyLimit: config.http.bodyLimitBytes,
    requestTimeout: config.http.requestTimeoutMs,
    // Makes the inbound correlation header (if any) the id Fastify stamps on
    // `request.id` and on its own request/response log lines, so platform logs
    // and our application logs share one id.
    genReqId: resolveRequestId,
    routerOptions: {
      ignoreTrailingSlash: true,
    },
  });

  registerRequestContext(app);

  await app.register(helmet, {
    // This is a machine-to-machine JSON API with no browser surface, so the
    // CSP/COEP machinery aimed at HTML documents is off; the transport-level
    // headers that do matter stay on.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  if (config.rateLimit.inbound.enabled) {
    await app.register(rateLimit, {
      max: config.rateLimit.inbound.max,
      timeWindow: config.rateLimit.inbound.windowMs,
      // Health checks come from the platform at a fixed cadence and must never
      // be throttled — losing them would look like an unhealthy instance.
      allowList: (request) => request.url.startsWith('/health'),
      errorResponseBuilder: (_request, context) => {
        throw new RateLimitError(
          `Rate limit exceeded: at most ${context.max} requests per ${context.after}.`
        );
      },
    });
  }

  // Sheds load when the event loop is saturated, instead of accepting work the
  // process cannot complete. `exposeStatusRoute` is off because our own
  // /health routes report richer state.
  await app.register(underPressure, {
    maxEventLoopDelay: 1_000,
    maxEventLoopUtilization: 0.98,
    message: 'Server is under heavy load.',
    retryAfter: 5,
    exposeStatusRoute: false,
  });

  registerApiKeyAuth(app, config.security);
  registerErrorHandler(app);

  const transportManager = new McpTransportManager({
    config,
    toolRegistry: container.toolRegistry,
    logger,
  });

  registerHealthRoutes(app, {
    container,
    isAcceptingTraffic: () => acceptingTraffic,
    startedAt,
  });
  registerPingRoutes(app, { container });
  registerMcpRoutes(app, { config, transportManager });

  app.get('/', (_request, reply) => {
    void reply.send({
      name: config.mcp.serverName,
      version: config.mcp.serverVersion,
      protocol: 'mcp',
      transport: 'streamable-http',
      endpoints: {
        mcp: config.mcp.endpointPath,
        health: '/health',
        readiness: '/health/ready',
        hubspotPing: '/ping/hubspot',
      },
    });
  });

  await app.ready();

  return {
    app,
    transportManager,
    setAcceptingTraffic(accepting: boolean): void {
      acceptingTraffic = accepting;
    },
  };
}
