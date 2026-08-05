import { parseRetryAfter } from '../utils/async.js';
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  HubSpotApiError,
  HubSpotRateLimitError,
  NotFoundError,
  UpstreamUnavailableError,
  normalizeError,
} from '../utils/errors.js';

/** The error envelope HubSpot returns on failures. */
interface HubSpotErrorBody {
  readonly status?: string;
  readonly message?: string;
  readonly correlationId?: string;
  readonly category?: string;
  readonly subCategory?: string;
  readonly errors?: readonly { readonly message?: string; readonly in?: string }[];
}

/**
 * Translates a HubSpot HTTP failure into our typed error hierarchy.
 *
 * The status-to-error mapping is what makes the retry middleware and circuit
 * breaker behave correctly without either of them knowing anything about
 * HubSpot: a 401 becomes a non-retryable `AuthenticationError` (retrying a bad
 * token is pointless and burns quota), while a 429 becomes a retryable error
 * carrying HubSpot's own `Retry-After`.
 */
export function mapHubSpotHttpError(
  status: number,
  rawBody: unknown,
  headers?: Headers | Record<string, string>
): AppError {
  const body = asErrorBody(rawBody);
  const correlationId = body?.correlationId ?? null;
  const category = body?.category ?? null;
  const message = extractMessage(body, status);

  const details: Record<string, unknown> = {};
  if (correlationId !== null) details.correlationId = correlationId;
  if (category !== null) details.category = category;
  if (body?.errors !== undefined && body.errors.length > 0) {
    details.errors = body.errors.slice(0, 10);
  }

  switch (status) {
    case 401:
      return new AuthenticationError(
        `HubSpot rejected the credentials: ${message}`,
        withCorrelation(details)
      );

    case 403:
      return new AuthorizationError(
        `HubSpot denied the request, most likely a missing scope: ${message}`,
        withCorrelation(details)
      );

    case 404:
      return new NotFoundError(`HubSpot resource not found: ${message}`, withCorrelation(details));

    case 429: {
      const retryAfterMs = parseRetryAfter(readHeader(headers, 'retry-after'));
      return new HubSpotRateLimitError(
        `HubSpot rate limit exceeded: ${message}`,
        // HubSpot does not always send Retry-After on 429; 10s matches its
        // documented ten-second rolling window.
        retryAfterMs ?? 10_000
      );
    }

    case 502:
    case 503:
    case 504:
      return new UpstreamUnavailableError(`HubSpot is temporarily unavailable: ${message}`);

    default:
      return new HubSpotApiError(message, {
        status,
        correlationId,
        category,
        ...(Object.keys(details).length === 0 ? {} : { details }),
      });
  }
}

/**
 * Normalises anything thrown by the HubSpot SDK.
 *
 * The SDK's `ApiException` stringifies the entire response body into
 * `error.message`. That message is deliberately *not* reused: it can contain
 * record data, and it would end up in logs and in tool output. We re-derive a
 * clean message from the structured body instead.
 */
export function mapHubSpotThrown(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (isApiException(error)) {
    return mapHubSpotHttpError(error.code, error.body, error.headers);
  }

  return normalizeError(error);
}

interface ApiExceptionLike {
  readonly code: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

/**
 * Structural check rather than `instanceof`.
 *
 * The SDK exports `ApiException` only from deep internal paths, and there is
 * one class per generated API — duck typing keeps us off those private paths.
 */
function isApiException(error: unknown): error is ApiExceptionLike {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; body?: unknown };
  return typeof candidate.code === 'number' && 'body' in candidate;
}

function asErrorBody(rawBody: unknown): HubSpotErrorBody | null {
  if (typeof rawBody === 'string') {
    try {
      return asErrorBody(JSON.parse(rawBody));
    } catch {
      return rawBody.trim() === '' ? null : { message: truncate(rawBody, 500) };
    }
  }

  if (typeof rawBody === 'object' && rawBody !== null) {
    return rawBody;
  }

  return null;
}

function extractMessage(body: HubSpotErrorBody | null, status: number): string {
  const message = body?.message?.trim();
  if (message !== undefined && message !== '') {
    return truncate(message, 500);
  }

  const first = body?.errors?.[0]?.message?.trim();
  if (first !== undefined && first !== '') {
    return truncate(first, 500);
  }

  return `HubSpot returned HTTP ${status}.`;
}

function withCorrelation(details: Record<string, unknown>): Record<string, unknown> | undefined {
  return Object.keys(details).length === 0 ? undefined : details;
}

function readHeader(
  headers: Headers | Record<string, string> | undefined,
  name: string
): string | null {
  if (headers === undefined) {
    return null;
  }

  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name);
  }

  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()] ?? null;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
