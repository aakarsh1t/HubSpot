/**
 * A single typed error hierarchy for the whole service.
 *
 * Every failure — bad config, a HubSpot 429, a blown circuit — becomes an
 * `AppError` carrying the three facts the outer layers actually need:
 *
 *   1. `httpStatus`  — how the REST endpoints should answer.
 *   2. `retryable`   — whether the retry middleware may try again.
 *   3. `expose`      — whether the message is safe to show a caller, or
 *                      whether it must be replaced with a generic string
 *                      because it may contain internal detail.
 *
 * Centralising that decision here is what stops an internal stack trace from
 * leaking into a Copilot Studio conversation.
 */

export const AppErrorCodes = {
  CONFIGURATION_INVALID: 'CONFIGURATION_INVALID',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  AUTHORIZATION_FAILED: 'AUTHORIZATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  HUBSPOT_API_ERROR: 'HUBSPOT_API_ERROR',
  HUBSPOT_RATE_LIMITED: 'HUBSPOT_RATE_LIMITED',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  TIMEOUT: 'TIMEOUT',
  INTERNAL: 'INTERNAL',
} as const;

export type AppErrorCode = (typeof AppErrorCodes)[keyof typeof AppErrorCodes];

export interface AppErrorOptions {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  readonly retryable?: boolean;
  readonly expose?: boolean;
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;
  /** Honoured by the retry middleware when the upstream dictates a delay. */
  readonly retryAfterMs?: number;
}

/** Serialisable projection of an error, safe for logs and API responses. */
export interface SerializedError {
  readonly name: string;
  readonly code: AppErrorCode;
  readonly message: string;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly expose: boolean;
  readonly details: Record<string, unknown> | undefined;
  readonly retryAfterMs: number | null;
  readonly timestamp: string;

  constructor(message: string, options: AppErrorOptions) {
    // Only pass `cause` when we actually have one: with
    // `exactOptionalPropertyTypes`, `{ cause: undefined }` is not the same as
    // omitting it, and Node would otherwise attach a literal `undefined` cause.
    super(message, options.cause === undefined ? undefined : { cause: options.cause });

    this.name = new.target.name;
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.retryable = options.retryable ?? false;
    this.expose = options.expose ?? true;
    this.details = options.details;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.timestamp = new Date().toISOString();

    Error.captureStackTrace(this, new.target);
  }

  /** Message safe to return to an external caller. */
  get publicMessage(): string {
    return this.expose ? this.message : 'An internal error occurred.';
  }

  toJSON(): SerializedError {
    return {
      name: this.name,
      code: this.code,
      message: this.publicMessage,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

/** Invalid or missing configuration. Always fatal at startup — never retried. */
export class ConfigurationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      code: AppErrorCodes.CONFIGURATION_INVALID,
      httpStatus: 500,
      retryable: false,
      expose: false,
      ...(details === undefined ? {} : { details }),
    });
  }
}

/** Caller-supplied input failed schema validation. */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      code: AppErrorCodes.VALIDATION_FAILED,
      httpStatus: 400,
      retryable: false,
      expose: true,
      ...(details === undefined ? {} : { details }),
    });
  }
}

/** Missing or invalid credentials — inbound API key, or a rejected HubSpot token. */
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed.', details?: Record<string, unknown>) {
    super(message, {
      code: AppErrorCodes.AUTHENTICATION_FAILED,
      httpStatus: 401,
      retryable: false,
      expose: true,
      ...(details === undefined ? {} : { details }),
    });
  }
}

/** Authenticated, but the token lacks the required HubSpot scope. */
export class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions.', details?: Record<string, unknown>) {
    super(message, {
      code: AppErrorCodes.AUTHORIZATION_FAILED,
      httpStatus: 403,
      retryable: false,
      expose: true,
      ...(details === undefined ? {} : { details }),
    });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found.', details?: Record<string, unknown>) {
    super(message, {
      code: AppErrorCodes.NOT_FOUND,
      httpStatus: 404,
      retryable: false,
      expose: true,
      ...(details === undefined ? {} : { details }),
    });
  }
}

/** This server throttled the caller. */
export class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded.', retryAfterMs?: number) {
    super(message, {
      code: AppErrorCodes.RATE_LIMITED,
      httpStatus: 429,
      retryable: true,
      expose: true,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
}

/** HubSpot throttled us. Carries HubSpot's own Retry-After when provided. */
export class HubSpotRateLimitError extends AppError {
  constructor(message = 'HubSpot rate limit exceeded.', retryAfterMs?: number) {
    super(message, {
      code: AppErrorCodes.HUBSPOT_RATE_LIMITED,
      httpStatus: 429,
      retryable: true,
      expose: true,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
}

/** A non-2xx response from HubSpot that is not auth- or rate-limit-related. */
export class HubSpotApiError extends AppError {
  readonly status: number;
  readonly correlationId: string | null;
  readonly category: string | null;

  constructor(
    message: string,
    options: {
      readonly status: number;
      readonly correlationId?: string | null;
      readonly category?: string | null;
      readonly details?: Record<string, unknown>;
      readonly cause?: unknown;
    }
  ) {
    super(message, {
      code: AppErrorCodes.HUBSPOT_API_ERROR,
      // 4xx is the caller's problem and is surfaced as 502-worthy only when
      // HubSpot itself failed; map 5xx to 502 Bad Gateway.
      httpStatus: options.status >= 500 ? 502 : options.status,
      retryable: options.status >= 500 || options.status === 408,
      expose: true,
      ...(options.details === undefined ? {} : { details: options.details }),
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.status = options.status;
    this.correlationId = options.correlationId ?? null;
    this.category = options.category ?? null;
  }
}

/** HubSpot was unreachable: DNS failure, connection reset, TLS error. */
export class UpstreamUnavailableError extends AppError {
  constructor(message = 'HubSpot is unreachable.', cause?: unknown) {
    super(message, {
      code: AppErrorCodes.UPSTREAM_UNAVAILABLE,
      httpStatus: 503,
      retryable: true,
      expose: true,
      ...(cause === undefined ? {} : { cause }),
    });
  }
}

/** The circuit breaker is open; we are failing fast without calling HubSpot. */
export class CircuitOpenError extends AppError {
  constructor(retryAfterMs: number) {
    super('HubSpot circuit breaker is open; refusing request to protect the upstream.', {
      code: AppErrorCodes.CIRCUIT_OPEN,
      httpStatus: 503,
      retryable: true,
      expose: true,
      retryAfterMs,
    });
  }
}

export class TimeoutError extends AppError {
  constructor(message: string, timeoutMs: number) {
    super(message, {
      code: AppErrorCodes.TIMEOUT,
      httpStatus: 504,
      retryable: true,
      expose: true,
      details: { timeoutMs },
    });
  }
}

/** Genuine bug. Never exposes its message. */
export class InternalError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, {
      code: AppErrorCodes.INTERNAL,
      httpStatus: 500,
      retryable: false,
      expose: false,
      ...(cause === undefined ? {} : { cause }),
    });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Funnels anything throwable into an `AppError`.
 *
 * Node's low-level network failures arrive as plain `Error`s with a `code`
 * property; recognising them here is what lets the retry middleware treat a
 * dropped connection as retryable without every call site knowing about
 * `ECONNRESET`.
 */
export function normalizeError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const nodeCode = (error as NodeJS.ErrnoException).code;

    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return new TimeoutError('The operation was aborted before it completed.', 0);
    }

    if (nodeCode !== undefined && RETRYABLE_NETWORK_CODES.has(nodeCode)) {
      return new UpstreamUnavailableError(
        `Network failure contacting upstream: ${nodeCode}`,
        error
      );
    }

    return new InternalError(error.message, error);
  }

  return new InternalError(`Non-error value thrown: ${safeStringify(error)}`, error);
}

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function safeStringify(value: unknown): string {
  try {
    // `JSON.stringify` is declared as returning `string`, but genuinely
    // returns `undefined` for `undefined`, functions, and symbols. The
    // assertion corrects the lib type — without it the compiler narrows this
    // to `string` and the guard below is reported as dead code.
    const json = JSON.stringify(value) as string | undefined;
    if (json !== undefined) {
      return json;
    }
  } catch {
    // Circular structure or a throwing `toJSON`; fall through.
  }

  // Avoids implicit `[object Object]` stringification of an unknown value.
  return Object.prototype.toString.call(value);
}

/**
 * RFC 9457 Problem Details. Using the standard shape means Azure API
 * Management, Application Insights, and Power Platform all parse our errors
 * without bespoke mapping.
 */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: AppErrorCode;
  readonly requestId: string;
  readonly timestamp: string;
  readonly errors?: Record<string, unknown>;
}

export function toProblemDetails(error: AppError, requestId: string): ProblemDetails {
  return {
    type: `https://docs.hubspot-mcp.internal/errors/${error.code.toLowerCase()}`,
    title: error.name,
    status: error.httpStatus,
    detail: error.publicMessage,
    code: error.code,
    requestId,
    timestamp: error.timestamp,
    ...(error.expose && error.details !== undefined ? { errors: error.details } : {}),
  };
}
