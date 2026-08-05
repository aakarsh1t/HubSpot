import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppFastifyInstance } from '../../types/http.types.js';
import type { Container } from '../../container/container.js';

export interface HealthRouteDependencies {
  readonly container: Container;
  /** False once graceful shutdown begins, so the load balancer drains us. */
  readonly isAcceptingTraffic: () => boolean;
  readonly startedAt: number;
}

/**
 * Liveness and readiness endpoints.
 *
 * The split matters on Azure App Service:
 *
 * - **`/health` and `/health/live`** answer from process state only — no
 *   HubSpot call, no I/O. This is the path to configure as the App Service
 *   health check. Pointing that at a probe that calls HubSpot would let a
 *   HubSpot outage make every instance "unhealthy", so the platform would
 *   recycle perfectly good workers and turn a partial degradation into a full
 *   outage.
 *
 * - **`/health/ready`** reports whether this instance should receive traffic,
 *   and includes resilience state (circuit breaker, limiter, sessions) for
 *   operators. It flips to 503 during graceful shutdown so in-flight requests
 *   drain before the process exits.
 *
 * The live HubSpot probe lives at `/ping/hubspot` instead — see ping.routes.ts.
 */
export function registerHealthRoutes(app: AppFastifyInstance, deps: HealthRouteDependencies): void {
  const { container, isAcceptingTraffic, startedAt } = deps;
  const { service } = container.config;

  const liveness = (_request: FastifyRequest, reply: FastifyReply): void => {
    void reply.status(200).send({
      status: 'ok',
      service: service.name,
      version: service.version,
      environment: service.environment,
      instanceId: service.instanceId,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    });
  };

  app.get('/health', liveness);
  app.get('/health/live', liveness);

  app.get('/health/ready', (_request: FastifyRequest, reply: FastifyReply) => {
    const accepting = isAcceptingTraffic();
    const clientHealth = container.hubspotClient.health();

    // An open breaker means HubSpot is failing, not that this instance is
    // broken — reported as "degraded" with a 200 so the instance stays in
    // rotation and can recover on its own.
    const status = !accepting
      ? 'shutting_down'
      : clientHealth.circuitBreaker.state === 'open'
        ? 'degraded'
        : 'ready';

    void reply.status(accepting ? 200 : 503).send({
      status,
      service: service.name,
      version: service.version,
      environment: service.environment,
      instanceId: service.instanceId,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
      dependencies: {
        hubspot: {
          authMode: container.config.hubspot.auth.mode,
          baseUrl: container.config.hubspot.baseUrl,
          circuitBreaker: clientHealth.circuitBreaker,
          rateLimiter: clientHealth.rateLimiter,
        },
      },
      mcp: {
        endpoint: container.config.mcp.endpointPath,
        transport: 'streamable-http',
        sessionMode: container.config.mcp.sessionMode,
        toolCount: container.toolRegistry.size,
      },
    });
  });
}
