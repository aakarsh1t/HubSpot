import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { AppFastifyInstance } from '../types/http.types.js';
import { AuthenticationError } from '../utils/errors.js';
import type { SecurityConfig } from '../types/config.types.js';

/**
 * Paths that must stay reachable without a key.
 *
 * Azure App Service health checks cannot present credentials, so gating
 * liveness behind the API key would make the platform recycle a perfectly
 * healthy instance.
 */
const PUBLIC_PATHS = new Set(['/health', '/health/live', '/health/ready', '/']);

/**
 * Inbound API-key authentication for the MCP endpoint.
 *
 * Copilot Studio's MCP onboarding wizard offers None / API key / OAuth 2.0.
 * API key in a header is the right fit here: this server holds its own HubSpot
 * credential and acts as a single service principal, so per-user OAuth would
 * add a consent dance without changing what the server can actually do.
 *
 * The comparison is timing-safe. A naive `===` leaks key material through
 * response-time differences, and an MCP endpoint is exactly the kind of
 * long-lived, publicly-addressable target where that attack is practical.
 */
export function registerApiKeyAuth(app: AppFastifyInstance, security: SecurityConfig): void {
  if (!security.apiKeyEnabled) {
    app.log.warn(
      'Inbound API key authentication is DISABLED. This is acceptable only for local development.'
    );
    return;
  }

  // Hash once at startup: comparing fixed-length digests keeps the comparison
  // constant-time regardless of how long the supplied key is.
  const expectedDigest = sha256(security.apiKey);
  const headerName = security.apiKeyHeader;

  app.addHook('onRequest', (request, _reply, done) => {
    if (isPublicPath(request.url)) {
      done();
      return;
    }

    const presented = extractKey(request, headerName);

    if (presented === null) {
      request.log.warn(
        { requestId: request.ctx?.requestId, path: request.url, reason: 'missing_api_key' },
        'Rejected unauthenticated request.'
      );
      done(new AuthenticationError(`Missing API key. Supply it in the "${headerName}" header.`));
      return;
    }

    if (!timingSafeEqualDigest(sha256(presented), expectedDigest)) {
      request.log.warn(
        { requestId: request.ctx?.requestId, path: request.url, reason: 'invalid_api_key' },
        'Rejected request with invalid API key.'
      );
      done(new AuthenticationError('Invalid API key.'));
      return;
    }

    done();
  });
}

/**
 * Reads the key from the configured header, falling back to
 * `Authorization: Bearer`. Copilot Studio sends the configured header; the
 * bearer fallback keeps MCP Inspector and curl usable without reconfiguration.
 */
function extractKey(request: FastifyRequest, headerName: string): string | null {
  const raw = request.headers[headerName];
  const headerValue = Array.isArray(raw) ? raw[0] : raw;

  if (typeof headerValue === 'string' && headerValue.trim() !== '') {
    return headerValue.trim();
  }

  const authorization = request.headers.authorization;
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1] !== undefined && match[1].trim() !== '') {
      return match[1].trim();
    }
  }

  return null;
}

function isPublicPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return PUBLIC_PATHS.has(path);
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function timingSafeEqualDigest(a: Buffer, b: Buffer): boolean {
  // Digests are always 32 bytes, so the length guard can never short-circuit
  // in a way that leaks information.
  return a.length === b.length && timingSafeEqual(a, b);
}
