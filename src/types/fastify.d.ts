import type { RequestContext } from '../utils/request-context.js';

/**
 * Type augmentation for the per-request correlation context.
 *
 * Declared here rather than cast at each use site so that `request.ctx` is
 * strongly typed everywhere, including inside route handlers.
 *
 * Optional on purpose: the context is attached by the first `onRequest` hook,
 * so it is genuinely absent beforehand — and the error handler can run for a
 * request that failed before ever reaching that hook. Typing it as required
 * would make every defensive `request.ctx?.` read look like dead code.
 */
declare module 'fastify' {
  interface FastifyRequest {
    ctx?: RequestContext;
  }
}
