import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { createRequestContext, runWithContext } from '../utils/request-context.js';
import type { AppFastifyInstance } from '../types/http.types.js';

/**
 * Headers we accept as an inbound correlation id, in priority order.
 *
 * Honouring an upstream id (Copilot Studio, Azure Front Door, API Management)
 * is what makes a single trace id span the whole call chain instead of
 * restarting at our front door.
 */
const CORRELATION_HEADERS = ['x-request-id', 'x-correlation-id', 'x-ms-client-request-id'] as const;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._@:/+=-]{1,200}$/u;

/**
 * Derives the correlation id for a request.
 *
 * Wired into Fastify as `genReqId`, which makes it the single source of the
 * id: Fastify stamps it on `request.id` and on its own request/response log
 * lines, and the hook below propagates that same value into async context.
 * Nothing generates a competing id.
 *
 * A caller-supplied value is accepted only if it matches a strict pattern.
 * Echoing an arbitrary header into every downstream log record would be both a
 * log-injection vector and a cardinality explosion in Log Analytics.
 */
export function resolveRequestId(req: IncomingMessage): string {
  for (const header of CORRELATION_HEADERS) {
    const raw = req.headers[header];
    const value = Array.isArray(raw) ? raw[0] : raw;

    if (typeof value === 'string' && REQUEST_ID_PATTERN.test(value)) {
      return value;
    }
  }

  return randomUUID();
}

/**
 * Establishes a request-scoped `AsyncLocalStorage` context and echoes the
 * request id back to the caller.
 *
 * Calling `done()` *inside* `runWithContext` is the load-bearing detail: the
 * remainder of the Fastify lifecycle continues from within that call stack, so
 * every downstream hook, handler, and awaited HubSpot call inherits the same
 * async context and logs the same id — without threading a parameter through
 * every function signature.
 */
export function registerRequestContext(app: AppFastifyInstance): void {
  // Fastify 5 no longer shares decorator references across requests, so the
  // context is attached per request in the hook rather than via
  // `decorateRequest`.
  app.addHook('onRequest', (request, reply, done) => {
    const context = createRequestContext({ requestId: request.id });

    request.ctx = context;
    void reply.header('x-request-id', context.requestId);

    runWithContext(context, done);
  });
}
