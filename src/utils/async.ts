import { setTimeout as delay } from 'node:timers/promises';
import { TimeoutError } from './errors.js';

/** Promise-based sleep that cooperates with an AbortSignal. */
export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await delay(ms, undefined, signal === undefined ? undefined : { signal });
}

/**
 * Applies a hard deadline to a promise.
 *
 * Critically, this also *aborts* the underlying work through the returned
 * signal rather than merely ignoring its result — otherwise a slow HubSpot
 * call would keep a socket and its memory alive long after we stopped caring.
 */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  description: string,
  externalSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const onExternalAbort = (): void => {
    controller.abort(externalSignal?.reason);
  };

  if (externalSignal !== undefined) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  // Held in an object rather than a bare `let`: TypeScript's control-flow
  // analysis does not track assignments made inside a timer callback, so a
  // plain boolean would be narrowed to `false` at the catch site and the
  // timeout branch would be (incorrectly) reported as dead code.
  const state = { timedOut: false };
  const timer = setTimeout(() => {
    state.timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await operation(controller.signal);
  } catch (error) {
    if (state.timedOut) {
      throw new TimeoutError(`${description} timed out after ${timeoutMs}ms.`, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Exponential backoff with full jitter.
 *
 * Full jitter (a uniform draw from `[0, capped]`) rather than fixed backoff is
 * what prevents every instance that failed on the same HubSpot outage from
 * retrying in lockstep and re-creating the thundering herd that caused it.
 */
export function computeBackoffDelay(
  attempt: number,
  options: {
    readonly initialDelayMs: number;
    readonly maxDelayMs: number;
    readonly backoffFactor: number;
    readonly jitter: boolean;
  },
  random: () => number = Math.random
): number {
  const exponential = options.initialDelayMs * Math.pow(options.backoffFactor, attempt - 1);
  const capped = Math.min(exponential, options.maxDelayMs);

  if (!options.jitter) {
    return Math.round(capped);
  }

  return Math.round(random() * capped);
}

/**
 * Parses an HTTP `Retry-After` header, which may be either delta-seconds or an
 * HTTP date. Returns null when absent or unparseable.
 */
export function parseRetryAfter(
  headerValue: string | null | undefined,
  now = Date.now()
): number | null {
  if (headerValue === null || headerValue === undefined || headerValue.trim() === '') {
    return null;
  }

  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const timestamp = Date.parse(headerValue);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.max(0, timestamp - now);
}
