import { describe, expect, it } from 'vitest';
import { TokenBucketRateLimiter } from '../middleware/rate-limiter.js';
import { RateLimitError } from '../utils/errors.js';

describe('TokenBucketRateLimiter', () => {
  it('is a no-op when disabled', async () => {
    const limiter = new TokenBucketRateLimiter({
      enabled: false,
      maxRequests: 1,
      windowMs: 60_000,
      maxQueueMs: 0,
    });

    for (let i = 0; i < 50; i += 1) {
      await expect(limiter.acquire()).resolves.toBeUndefined();
    }
  });

  it('allows an initial burst up to capacity', async () => {
    const limiter = new TokenBucketRateLimiter({
      enabled: true,
      maxRequests: 5,
      windowMs: 10_000,
      maxQueueMs: 0,
    });

    for (let i = 0; i < 5; i += 1) {
      await expect(limiter.acquire()).resolves.toBeUndefined();
    }

    expect(limiter.snapshot().availableTokens).toBe(0);
  });

  it('fails fast when the estimated wait exceeds the queue budget', async () => {
    const limiter = new TokenBucketRateLimiter({
      enabled: true,
      maxRequests: 1,
      windowMs: 60_000,
      maxQueueMs: 0,
    });

    await limiter.acquire();

    // Better to return 429 promptly than to hold a request for a minute.
    await expect(limiter.acquire()).rejects.toBeInstanceOf(RateLimitError);
  });

  it('queues and releases a waiter once a token refills', async () => {
    const limiter = new TokenBucketRateLimiter({
      enabled: true,
      maxRequests: 10,
      // 10 tokens per 100ms => one token every 10ms.
      windowMs: 100,
      maxQueueMs: 1_000,
    });

    for (let i = 0; i < 10; i += 1) {
      await limiter.acquire();
    }

    const startedAt = Date.now();
    await limiter.acquire();

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(5);
  });

  it('refills over time', async () => {
    let now = 0;
    const limiter = new TokenBucketRateLimiter(
      { enabled: true, maxRequests: 10, windowMs: 1_000, maxQueueMs: 0 },
      () => now
    );

    for (let i = 0; i < 10; i += 1) {
      await limiter.acquire();
    }
    expect(limiter.snapshot().availableTokens).toBe(0);

    now += 500;
    expect(limiter.snapshot().availableTokens).toBe(5);

    now += 10_000;
    // Never exceeds capacity, however long we idle.
    expect(limiter.snapshot().availableTokens).toBe(10);
  });

  it('rejects queued waiters when the signal aborts', async () => {
    const limiter = new TokenBucketRateLimiter({
      enabled: true,
      maxRequests: 1,
      windowMs: 10_000,
      maxQueueMs: 5_000,
    });
    await limiter.acquire();

    const controller = new AbortController();
    const pending = limiter.acquire(controller.signal);
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(RateLimitError);
  });

  it('rejects immediately if the signal is already aborted', async () => {
    const limiter = new TokenBucketRateLimiter({
      enabled: true,
      maxRequests: 10,
      windowMs: 1_000,
      maxQueueMs: 1_000,
    });

    const controller = new AbortController();
    controller.abort();

    await expect(limiter.acquire(controller.signal)).rejects.toBeInstanceOf(RateLimitError);
  });

  it('drains queued waiters on dispose so shutdown cannot hang', async () => {
    const limiter = new TokenBucketRateLimiter({
      enabled: true,
      maxRequests: 1,
      windowMs: 60_000,
      maxQueueMs: 30_000,
    });
    await limiter.acquire();

    const pending = limiter.acquire();
    limiter.dispose();

    await expect(pending).rejects.toBeInstanceOf(RateLimitError);
  });

  it('serves queued waiters in FIFO order', async () => {
    const limiter = new TokenBucketRateLimiter({
      enabled: true,
      maxRequests: 2,
      windowMs: 40,
      maxQueueMs: 2_000,
    });

    await limiter.acquire();
    await limiter.acquire();

    const order: number[] = [];
    const waiters = [0, 1, 2].map((index) =>
      limiter.acquire().then(() => {
        order.push(index);
      })
    );

    await Promise.all(waiters);

    // Fairness: a steady stream of arrivals must not starve an early waiter.
    expect(order).toEqual([0, 1, 2]);
  });
});
