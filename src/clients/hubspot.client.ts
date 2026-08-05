import { Client } from '@hubspot/api-client';
import type { Logger } from 'pino';
import { mapHubSpotHttpError, mapHubSpotThrown } from './hubspot-error.mapper.js';
import { type CircuitBreaker, type CircuitBreakerSnapshot } from '../middleware/circuit-breaker.js';
import {
  type TokenBucketRateLimiter,
  type RateLimiterSnapshot,
} from '../middleware/rate-limiter.js';
import { withRetry } from '../middleware/retry.js';
import { withTimeout } from '../utils/async.js';
import { type AppError, AppErrorCodes } from '../utils/errors.js';
import { getRequestId } from '../utils/request-context.js';
import type { HubSpotTokenProvider } from '../types/auth.types.js';
import type { HubSpotConfig, RetryConfig } from '../types/config.types.js';
import type { HubSpotRequestOptions, HubSpotResponse } from '../types/hubspot.types.js';

export interface HubSpotClientDependencies {
  readonly config: HubSpotConfig;
  readonly retryConfig: RetryConfig;
  readonly tokenProvider: HubSpotTokenProvider;
  readonly rateLimiter: TokenBucketRateLimiter;
  readonly circuitBreaker: CircuitBreaker;
  readonly logger: Logger;
  readonly userAgent: string;
}

export interface HubSpotClientHealth {
  readonly rateLimiter: RateLimiterSnapshot;
  readonly circuitBreaker: CircuitBreakerSnapshot;
}

/**
 * The single gateway for every outbound HubSpot call.
 *
 * All resilience concerns compose here, in a deliberate order:
 *
 * ```
 *   circuit breaker            one decision per logical call
 *     └─ retry                 N attempts with backoff + jitter
 *          └─ rate limiter     one token per attempt
 *               └─ timeout     per-attempt deadline
 *                    └─ fetch  via the official HubSpot SDK
 * ```
 *
 * The breaker sits *outside* retry on purpose. Inside, an open breaker would
 * raise a retryable error and the retry loop would immediately spin against
 * it — burning the whole budget to discover, repeatedly, that we already
 * decided not to call. Outside, an open breaker fails the call instantly.
 *
 * The rate limiter sits *inside* retry, because every attempt is a real HTTP
 * request against the quota — including retries.
 */
export class HubSpotClient {
  private readonly config: HubSpotConfig;
  private readonly retryConfig: RetryConfig;
  private readonly tokenProvider: HubSpotTokenProvider;
  private readonly rateLimiter: TokenBucketRateLimiter;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly logger: Logger;
  private readonly userAgent: string;

  /** SDK clients are cached per token value; see `clientForToken`. */
  private cachedClient: Client | null = null;
  private cachedTokenValue: string | null = null;

  constructor(deps: HubSpotClientDependencies) {
    this.config = deps.config;
    this.retryConfig = deps.retryConfig;
    this.tokenProvider = deps.tokenProvider;
    this.rateLimiter = deps.rateLimiter;
    this.circuitBreaker = deps.circuitBreaker;
    this.logger = deps.logger.child({ component: 'hubspot-client' });
    this.userAgent = deps.userAgent;
  }

  async request<T>(options: HubSpotRequestOptions): Promise<HubSpotResponse<T>> {
    const startedAt = Date.now();
    const operationName = `${options.method} ${options.path}`;

    const outcome = await this.circuitBreaker.execute(() =>
      withRetry(({ attempt }) => this.executeOnce(options, attempt, operationName), {
        policy: this.retryConfig,
        operationName,
        logger: this.logger,
        isRetryable: (error, attempt) => this.isRetryable(error, attempt, options),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    );

    const durationMs = Date.now() - startedAt;

    this.logger.debug(
      {
        requestId: getRequestId(),
        operation: operationName,
        status: outcome.result.status,
        attempts: outcome.attempts,
        durationMs,
      },
      'HubSpot request completed.'
    );

    return {
      status: outcome.result.status,
      // The single unchecked boundary in this client. HubSpot's response body
      // is not schema-validated here — callers declare the shape they expect
      // via `T`. Keeping the cast in exactly one place makes that trust
      // boundary explicit rather than smearing a fake generic through the
      // private helpers; a caller that needs real guarantees should parse the
      // result with a Zod schema at its own layer.
      data: outcome.result.data as T,
      durationMs,
      attempts: outcome.attempts,
    };
  }

  /** Live resilience state, surfaced by the readiness endpoint. */
  health(): HubSpotClientHealth {
    return {
      rateLimiter: this.rateLimiter.snapshot(),
      circuitBreaker: this.circuitBreaker.snapshot(),
    };
  }

  private async executeOnce(
    options: HubSpotRequestOptions,
    attempt: number,
    operationName: string
  ): Promise<{ status: number; data: unknown }> {
    // Acquired per attempt: a retry is a real request against the quota.
    await this.rateLimiter.acquire(options.signal);

    // Fetched per attempt so a mid-flight refresh (after a 401) is picked up
    // by the very next try.
    const token = await this.tokenProvider.getAccessToken();
    const client = this.clientForToken(token.value);
    const timeoutMs = options.timeoutMs ?? this.config.requestTimeoutMs;

    let response: Response;
    try {
      response = await withTimeout(
        () =>
          client.apiRequest({
            method: options.method,
            path: options.path,
            ...(options.query === undefined ? {} : { qs: stringifyQuery(options.query) }),
            ...(options.body === undefined ? {} : { body: options.body }),
          }),
        timeoutMs,
        operationName,
        options.signal
      );
    } catch (error) {
      throw mapHubSpotThrown(error);
    }

    if (!response.ok) {
      const body = await readBodySafely(response);

      if (response.status === 401) {
        // Drop the cached credential so the retry re-authenticates rather
        // than replaying the token HubSpot just rejected.
        await this.tokenProvider.invalidate();
        this.cachedClient = null;
        this.cachedTokenValue = null;
      }

      this.logger.warn(
        {
          requestId: getRequestId(),
          operation: operationName,
          attempt,
          status: response.status,
        },
        'HubSpot returned an error response.'
      );

      throw mapHubSpotHttpError(response.status, body, response.headers);
    }

    return { status: response.status, data: await parseJson(response) };
  }

  /**
   * Allows exactly one extra attempt after a 401, and only under OAuth.
   *
   * An expired access token is the one authentication failure that is
   * genuinely transient — the retry runs after `invalidate()`, so it carries a
   * freshly minted token. Every other 401, and every 401 under a private app
   * token (which never expires), fails immediately instead of burning quota on
   * a credential that will never be accepted.
   */
  private isRetryable(error: AppError, attempt: number, options: HubSpotRequestOptions): boolean {
    if (options.retryable === false) {
      return false;
    }

    if (error.code === AppErrorCodes.AUTHENTICATION_FAILED) {
      return attempt === 1 && this.tokenProvider.mode === 'oauth';
    }

    return error.retryable;
  }

  /**
   * Returns an SDK client bound to `token`, rebuilding only when it rotates.
   *
   * Caching by token value, rather than mutating one client with
   * `setAccessToken`, avoids a race in which a concurrent refresh swaps the
   * credential out from under an in-flight request.
   *
   * Note also what is *not* configured: `numberOfApiCallRetries` and
   * `limiterOptions` are both left unset. The SDK registers those as
   * decorators on a process-wide singleton, so enabling them would (a) stack a
   * second retry policy on top of ours — turning 3 attempts into 9 — and
   * (b) leak configuration across every other Client in the process,
   * including the OAuth one.
   */
  private clientForToken(token: string): Client {
    if (this.cachedClient !== null && this.cachedTokenValue === token) {
      return this.cachedClient;
    }

    // The SDK always appends its own `User-agent`, so the wire value ends up
    // as "<our agent>, hubspot-api-client-nodejs; <version>". That is the
    // useful outcome — HubSpot support can see both the calling application
    // and the SDK version — and it cannot be overridden anyway, since the SDK
    // merges its header last.
    const client = new Client({
      accessToken: token,
      basePath: this.config.baseUrl,
      defaultHeaders: { 'User-Agent': this.userAgent },
    });

    this.cachedClient = client;
    this.cachedTokenValue = token;
    return client;
  }
}

function stringifyQuery(
  query: Readonly<Record<string, string | number | boolean>>
): Record<string, string> {
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [key, String(value)]));
}

/** Reads an error body without letting a malformed payload mask the real failure. */
async function readBodySafely(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (text.trim() === '') {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

async function parseJson(response: Response): Promise<unknown> {
  // 204 No Content and 202 Accepted legitimately have empty bodies.
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return null;
  }

  const text = await response.text();
  if (text.trim() === '') {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw mapHubSpotThrown(error);
  }
}
