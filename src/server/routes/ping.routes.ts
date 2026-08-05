import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppFastifyInstance } from '../../types/http.types.js';
import type { Container } from '../../container/container.js';

export interface PingRouteDependencies {
  readonly container: Container;
}

/**
 * Live HubSpot connectivity endpoints.
 *
 * Kept separate from `/health` on purpose: these make a real outbound call, so
 * they must never be wired to a platform health probe (see health.routes.ts).
 * They exist for humans and synthetic monitors — the fastest way to answer
 * "can this deployment actually reach HubSpot?" without opening an MCP client.
 *
 * Both are protected by the API key, since they reveal portal identity.
 */
export function registerPingRoutes(app: AppFastifyInstance, deps: PingRouteDependencies): void {
  const { container } = deps;

  app.get('/ping/hubspot', async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await container.healthService.ping();

    // 503 on failure so a synthetic monitor can alert on status code alone.
    await reply.status(result.ok ? 200 : 503).send({
      ...result,
      requestId: request.ctx?.requestId ?? null,
    });
  });

  app.get('/ping/hubspot/details', async (request: FastifyRequest, reply: FastifyReply) => {
    const report = await container.healthService.testConnection();

    await reply.status(report.status === 'connected' ? 200 : 503).send({
      ...report,
      requestId: request.ctx?.requestId ?? null,
    });
  });
}
