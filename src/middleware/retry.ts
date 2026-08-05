import type { Logger } from 'pino';
import { computeBackoffDelay, sleep } from '../utils/async.js';
import { type AppError, normalizeError } from '../utils/errors.js';
import type { RetryConfig } from '../types/config.types.js';

export interface RetryAttemptInfo {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly delayMs: number;
  readonly error: AppError;
}

export interface RetryOptions {
  readonly policy: RetryConfig;
  readonly operationName: string;
  readonly logger?: Logger;
  /** Overrides the default `error.retryable` decision. */
  readonly isRetryable?: (error: AppError, attempt: number) => boolean;
  readonly signal?: AbortSignal;
  readonly onRetry?: (info: RetryAttemptInfo) => void;
  /** Seams for deterministic tests. */
  readonly sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly random?: () => number;
}

export interface RetryOutcome<T> {
  readonly result: T;
  /** Total attempts made, including the successful one. Surfaced as a metric. */
  readonly attempts: number;
}

/**
 * Retries an operation with exponential backoff and full jitter.
 *
 * Three behaviours matter here for correctness against a real API:
 *
 *  - **Only retryable failures are retried.** A 401 or a 400 is replayed
 *    forever by naive retry loops; here `AppError.retryable` gates it, so
 *    client errors fail immediately and only 5xx / 429 / network faults repeat.
 *  - **`Retry-After` wins over our backoff.** When HubSpot tells us when to
 *    come back, guessing is worse than obeying — but we still cap the value at
 *    `maxDelayMs` so a hostile or buggy header cannot stall a request forever.
 *  - **Aborts are not retried.** A cancelled request must die immediately
 *    rather than continuing to consume the upstream quota.
 */
export async function withRetry<T>(
  operation: (context: { readonly attempt: number; readonly signal?: AbortSignal }) => Promise<T>,
  options: RetryOptions
): Promise<RetryOutcome<T>> {
  const { policy, operationName, logger, signal, onRetry } = options;
  const sleepFn = options.sleepFn ?? sleep;
  const maxAttempts = Math.max(1, policy.maxAttempts);

  let lastError: AppError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted === true) {
      throw normalizeError(signal.reason ?? new Error('Operation aborted.'));
    }

    try {
      const result = await operation({
        attempt,
        ...(signal === undefined ? {} : { signal }),
      });
      return { result, attempts: attempt };
    } catch (caught) {
      const error = normalizeError(caught);
      lastError = error;

      const retryable = options.isRetryable?.(error, attempt) ?? error.retryable;
      const attemptsRemain = attempt < maxAttempts;

      if (!retryable || !attemptsRemain) {
        logger?.debug(
          {
            operation: operationName,
            attempt,
            maxAttempts,
            errorCode: error.code,
            retryable,
          },
          'Operation failed and will not be retried.'
        );
        throw error;
      }

      const delayMs = resolveDelay(error, attempt, policy, options.random);

      logger?.warn(
        {
          operation: operationName,
          attempt,
          maxAttempts,
          delayMs,
          errorCode: error.code,
          errorMessage: error.message,
          honoredRetryAfter: error.retryAfterMs !== null,
        },
        'Operation failed; retrying after backoff.'
      );

      onRetry?.({ attempt, maxAttempts, delayMs, error });

      try {
        await sleepFn(delayMs, signal);
      } catch (sleepError) {
        // The wait was aborted — surface the abort, not the original failure.
        throw normalizeError(sleepError);
      }
    }
  }

  /* c8 ignore next 2 -- unreachable: the loop either returns or throws. */
  throw lastError ?? normalizeError(new Error(`${operationName} exhausted all retry attempts.`));
}

function resolveDelay(
  error: AppError,
  attempt: number,
  policy: RetryConfig,
  random?: () => number
): number {
  if (error.retryAfterMs !== null) {
    return Math.min(error.retryAfterMs, policy.maxDelayMs);
  }

  return computeBackoffDelay(
    attempt,
    {
      initialDelayMs: policy.initialDelayMs,
      maxDelayMs: policy.maxDelayMs,
      backoffFactor: policy.backoffFactor,
      jitter: policy.jitter,
    },
    random
  );
}
