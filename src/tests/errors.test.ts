import { describe, expect, it } from 'vitest';
import { mapHubSpotHttpError, mapHubSpotThrown } from '../clients/hubspot-error.mapper.js';
import {
  AppErrorCodes,
  AuthenticationError,
  AuthorizationError,
  HubSpotApiError,
  HubSpotRateLimitError,
  InternalError,
  NotFoundError,
  UpstreamUnavailableError,
  ValidationError,
  isAppError,
  normalizeError,
  toProblemDetails,
} from '../utils/errors.js';

describe('AppError', () => {
  it('never exposes the message of a non-exposable error', () => {
    const error = new InternalError('connection string: postgres://user:pw@host');

    // The raw message stays available for logs...
    expect(error.message).toContain('postgres://');
    // ...but the caller-facing projection must not leak it.
    expect(error.publicMessage).toBe('An internal error occurred.');
    expect(error.toJSON().message).toBe('An internal error occurred.');
  });

  it('exposes safe client errors verbatim', () => {
    const error = new ValidationError('portalId must be a number');
    expect(error.publicMessage).toBe('portalId must be a number');
  });

  it('omits details from problem details when the error is not exposable', () => {
    const error = new InternalError('secret detail');
    const problem = toProblemDetails(error, 'req-1');

    expect(problem.errors).toBeUndefined();
    expect(problem.detail).toBe('An internal error occurred.');
    expect(problem.status).toBe(500);
    expect(problem.requestId).toBe('req-1');
  });

  it('carries retryability so middleware need not inspect status codes', () => {
    expect(new UpstreamUnavailableError().retryable).toBe(true);
    expect(new HubSpotRateLimitError().retryable).toBe(true);
    expect(new ValidationError('bad').retryable).toBe(false);
    expect(new AuthenticationError().retryable).toBe(false);
  });
});

describe('normalizeError', () => {
  it('passes AppErrors through unchanged', () => {
    const original = new ValidationError('bad');
    expect(normalizeError(original)).toBe(original);
  });

  it('classifies Node network failures as retryable upstream errors', () => {
    for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'UND_ERR_SOCKET']) {
      const nodeError = Object.assign(new Error('socket failure'), { code });
      const normalized = normalizeError(nodeError);

      expect(normalized.code).toBe(AppErrorCodes.UPSTREAM_UNAVAILABLE);
      expect(normalized.retryable).toBe(true);
    }
  });

  it('treats an unknown Error as a non-retryable internal error', () => {
    const normalized = normalizeError(new Error('kaboom'));
    expect(normalized).toBeInstanceOf(InternalError);
    expect(normalized.retryable).toBe(false);
  });

  it('handles non-Error throwables', () => {
    expect(isAppError(normalizeError('a string'))).toBe(true);
    expect(isAppError(normalizeError({ weird: true }))).toBe(true);
    expect(isAppError(normalizeError(null))).toBe(true);
  });
});

describe('mapHubSpotHttpError', () => {
  const body = {
    status: 'error',
    message: 'Contact not found',
    correlationId: 'corr-123',
    category: 'OBJECT_NOT_FOUND',
  };

  it('maps 401 to a non-retryable authentication error', () => {
    const error = mapHubSpotHttpError(401, { message: 'expired token' });
    expect(error).toBeInstanceOf(AuthenticationError);
    // Retrying a rejected credential just burns quota.
    expect(error.retryable).toBe(false);
  });

  it('maps 403 to an authorization error mentioning scopes', () => {
    const error = mapHubSpotHttpError(403, { message: 'missing scope' });
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error.message).toMatch(/scope/i);
  });

  it('maps 404 to a not-found error', () => {
    expect(mapHubSpotHttpError(404, body)).toBeInstanceOf(NotFoundError);
  });

  it('maps 429 and reads Retry-After from headers', () => {
    const error = mapHubSpotHttpError(429, { message: 'too many' }, { 'retry-after': '3' });

    expect(error).toBeInstanceOf(HubSpotRateLimitError);
    expect(error.retryAfterMs).toBe(3_000);
  });

  it('falls back to HubSpot ten-second window when Retry-After is absent', () => {
    const error = mapHubSpotHttpError(429, { message: 'too many' });
    expect(error.retryAfterMs).toBe(10_000);
  });

  it('maps 5xx to a retryable upstream error', () => {
    for (const status of [502, 503, 504]) {
      const error = mapHubSpotHttpError(status, {});
      expect(error).toBeInstanceOf(UpstreamUnavailableError);
      expect(error.retryable).toBe(true);
    }
  });

  it('preserves correlation id and category for support escalation', () => {
    const error = mapHubSpotHttpError(400, body);

    expect(error).toBeInstanceOf(HubSpotApiError);
    expect((error as HubSpotApiError).correlationId).toBe('corr-123');
    expect((error as HubSpotApiError).category).toBe('OBJECT_NOT_FOUND');
  });

  it('parses a JSON string body', () => {
    const error = mapHubSpotHttpError(400, JSON.stringify(body));
    expect(error.message).toContain('Contact not found');
  });

  it('survives an unparseable body', () => {
    const error = mapHubSpotHttpError(500, '<html>gateway error</html>');
    expect(error.message).toBeTruthy();
  });

  it('truncates an oversized upstream message', () => {
    const error = mapHubSpotHttpError(400, { message: 'x'.repeat(5_000) });
    expect(error.message.length).toBeLessThan(600);
  });
});

describe('mapHubSpotThrown', () => {
  it('maps an SDK ApiException by structure, not by class identity', () => {
    // The SDK exports one ApiException per generated API from deep internal
    // paths, so duck typing is deliberate.
    const apiException = Object.assign(new Error('HTTP-Code: 401 ... full body dump ...'), {
      code: 401,
      body: { message: 'bad credentials' },
      headers: {},
    });

    const error = mapHubSpotThrown(apiException);

    expect(error).toBeInstanceOf(AuthenticationError);
    // The SDK stringifies the entire response body into `message`; we must not
    // propagate that, since it can contain record data.
    expect(error.message).not.toContain('full body dump');
  });

  it('normalizes anything else', () => {
    expect(mapHubSpotThrown(new Error('generic'))).toBeInstanceOf(InternalError);
  });
});
