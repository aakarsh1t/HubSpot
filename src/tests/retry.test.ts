import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../middleware/retry.js';
import {
  AuthenticationError,
  HubSpotRateLimitError,
  UpstreamUnavailableError,
  ValidationError,
} from '../utils/errors.js';
import type { RetryConfig } from '../types/config.types.js';

const policy: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 1_000,
  backoffFactor: 2,
  jitter: false,
};

/** Records requested delays instead of actually waiting. */
function recordingSleep(): { fn: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    fn: (ms: number): Promise<void> => {
      delays.push(ms);
      return Promise.resolve();
    },
  };
}

describe('withRetry', () => {
  it('returns immediately on success without sleeping', async () => {
    const sleep = recordingSleep();
    const operation = vi.fn().mockResolvedValue('ok');

    const outcome = await withRetry(operation, {
      policy,
      operationName: 'test',
      sleepFn: sleep.fn,
    });

    expect(outcome).toEqual({ result: 'ok', attempts: 1 });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep.delays).toEqual([]);
  });

  it('retries retryable failures and reports the attempt count', async () => {
    const sleep = recordingSleep();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new UpstreamUnavailableError('boom'))
      .mockRejectedValueOnce(new UpstreamUnavailableError('boom'))
      .mockResolvedValue('recovered');

    const outcome = await withRetry(operation, {
      policy,
      operationName: 'test',
      sleepFn: sleep.fn,
    });

    expect(outcome).toEqual({ result: 'recovered', attempts: 3 });
    expect(sleep.delays).toEqual([100, 200]);
  });

  it('does not retry client errors', async () => {
    const sleep = recordingSleep();
    const operation = vi.fn().mockRejectedValue(new ValidationError('bad input'));

    await expect(
      withRetry(operation, { policy, operationName: 'test', sleepFn: sleep.fn })
    ).rejects.toBeInstanceOf(ValidationError);

    // The whole point: a 400 replayed three times is three wasted calls.
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep.delays).toEqual([]);
  });

  it('stops after maxAttempts and rethrows the final error', async () => {
    const sleep = recordingSleep();
    const operation = vi.fn().mockRejectedValue(new UpstreamUnavailableError('always down'));

    await expect(
      withRetry(operation, { policy, operationName: 'test', sleepFn: sleep.fn })
    ).rejects.toBeInstanceOf(UpstreamUnavailableError);

    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep.delays).toHaveLength(2);
  });

  it('honours Retry-After from the upstream over its own backoff', async () => {
    const sleep = recordingSleep();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new HubSpotRateLimitError('slow down', 750))
      .mockResolvedValue('ok');

    await withRetry(operation, { policy, operationName: 'test', sleepFn: sleep.fn });

    expect(sleep.delays).toEqual([750]);
  });

  it('caps a hostile Retry-After at maxDelayMs', async () => {
    const sleep = recordingSleep();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new HubSpotRateLimitError('slow down', 3_600_000))
      .mockResolvedValue('ok');

    await withRetry(operation, { policy, operationName: 'test', sleepFn: sleep.fn });

    // A buggy or malicious header must not be able to stall a request.
    expect(sleep.delays).toEqual([1_000]);
  });

  it('caps exponential growth at maxDelayMs', async () => {
    const sleep = recordingSleep();
    const operation = vi.fn().mockRejectedValue(new UpstreamUnavailableError('down'));

    await expect(
      withRetry(operation, {
        policy: { ...policy, maxAttempts: 5, initialDelayMs: 400 },
        operationName: 'test',
        sleepFn: sleep.fn,
      })
    ).rejects.toThrow();

    expect(sleep.delays).toEqual([400, 800, 1_000, 1_000]);
  });

  it('applies full jitter within the capped window', async () => {
    const sleep = recordingSleep();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new UpstreamUnavailableError('down'))
      .mockResolvedValue('ok');

    await withRetry(operation, {
      policy: { ...policy, jitter: true },
      operationName: 'test',
      sleepFn: sleep.fn,
      random: () => 0.5,
    });

    expect(sleep.delays).toEqual([50]);
  });

  it('lets a custom predicate override the default retryability', async () => {
    const sleep = recordingSleep();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new AuthenticationError('token expired'))
      .mockResolvedValue('ok');

    // Mirrors the HubSpot client's rule: one retry after re-authenticating.
    const outcome = await withRetry(operation, {
      policy,
      operationName: 'test',
      sleepFn: sleep.fn,
      isRetryable: (error, attempt) => error.code === 'AUTHENTICATION_FAILED' && attempt === 1,
    });

    expect(outcome.attempts).toBe(2);
  });

  it('refuses to start when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const operation = vi.fn();

    await expect(
      withRetry(operation, { policy, operationName: 'test', signal: controller.signal })
    ).rejects.toThrow();

    expect(operation).not.toHaveBeenCalled();
  });

  it('invokes the onRetry callback with attempt context', async () => {
    const sleep = recordingSleep();
    const onRetry = vi.fn();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new UpstreamUnavailableError('down'))
      .mockResolvedValue('ok');

    await withRetry(operation, {
      policy,
      operationName: 'test',
      sleepFn: sleep.fn,
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]![0]).toMatchObject({ attempt: 1, maxAttempts: 3, delayMs: 100 });
  });
});
