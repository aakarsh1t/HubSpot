import { RateLimitError } from '../utils/errors.js';
import type { OutboundRateLimitConfig } from '../types/config.types.js';

interface Waiter {
  readonly enqueuedAt: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
  signal: AbortSignal | null;
  onAbort: (() => void) | null;
  settled: boolean;
}

export interface RateLimiterSnapshot {
  readonly enabled: boolean;
  readonly availableTokens: number;
  readonly capacity: number;
  readonly queueDepth: number;
}

/**
 * Outbound token-bucket limiter protecting our HubSpot API quota.
 *
 * This paces *our* calls to HubSpot; it is the opposite of the inbound
 * `@fastify/rate-limit`, which protects this server from its callers.
 *
 * A token bucket rather than a fixed window because HubSpot's own limiter is
 * burst-tolerant: bursting up to capacity then refilling smoothly uses the
 * available quota far better than a fixed window, which wastes the whole
 * remainder of a window after an early burst.
 *
 * Waiters are served FIFO so a steady stream of callers cannot starve one
 * unlucky request, and every waiter carries a deadline — exceeding it fails
 * fast with 429 instead of letting a request hang until the client gives up.
 */
export class TokenBucketRateLimiter {
  private readonly capacity: number;
  /** Tokens replenished per millisecond. */
  private readonly refillRatePerMs: number;
  private readonly maxQueueMs: number;
  private readonly enabled: boolean;
  private readonly now: () => number;

  private tokens: number;
  private lastRefillAt: number;
  private readonly queue: Waiter[] = [];
  private drainTimer: NodeJS.Timeout | null = null;

  constructor(config: OutboundRateLimitConfig, now: () => number = Date.now) {
    this.enabled = config.enabled;
    this.capacity = Math.max(1, config.maxRequests);
    this.refillRatePerMs = this.capacity / Math.max(1, config.windowMs);
    this.maxQueueMs = config.maxQueueMs;
    this.now = now;
    this.tokens = this.capacity;
    this.lastRefillAt = now();
  }

  /**
   * Resolves when a token is available. Rejects with `RateLimitError` if the
   * wait would exceed `maxQueueMs`, or with the abort reason if `signal` fires.
   */
  async acquire(signal?: AbortSignal): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (signal?.aborted === true) {
      throw new RateLimitError('Request aborted while awaiting rate limit token.');
    }

    this.refill();

    // Only take the fast path when nobody is queued, otherwise a late arrival
    // could jump the queue and break FIFO fairness.
    if (this.queue.length === 0 && this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    const estimatedWaitMs = this.estimateWaitMs();
    if (estimatedWaitMs > this.maxQueueMs) {
      throw new RateLimitError(
        `Outbound HubSpot rate limit reached; estimated wait ${Math.round(estimatedWaitMs)}ms exceeds the ${this.maxQueueMs}ms budget.`,
        Math.round(estimatedWaitMs)
      );
    }

    await this.enqueue(signal);
  }

  snapshot(): RateLimiterSnapshot {
    this.refill();
    return {
      enabled: this.enabled,
      availableTokens: Math.floor(this.tokens),
      capacity: this.capacity,
      queueDepth: this.queue.length,
    };
  }

  /** Rejects everything queued. Called during shutdown so drain never hangs. */
  dispose(): void {
    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }

    while (this.queue.length > 0) {
      const waiter = this.queue.shift();
      if (waiter !== undefined) {
        this.settle(waiter, new RateLimitError('Rate limiter disposed during shutdown.'));
      }
    }
  }

  private enqueue(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        enqueuedAt: this.now(),
        resolve,
        reject,
        timer: null,
        signal: signal ?? null,
        onAbort: null,
        settled: false,
      };

      if (this.maxQueueMs > 0) {
        waiter.timer = setTimeout(() => {
          this.remove(waiter);
          this.settle(
            waiter,
            new RateLimitError(
              `Timed out after ${this.maxQueueMs}ms waiting for an outbound HubSpot rate limit token.`
            )
          );
        }, this.maxQueueMs);
        // Never let a queued waiter keep the event loop alive at shutdown.
        waiter.timer.unref();
      }

      if (signal !== undefined) {
        waiter.onAbort = (): void => {
          this.remove(waiter);
          this.settle(
            waiter,
            new RateLimitError('Request aborted while awaiting rate limit token.')
          );
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }

      this.queue.push(waiter);
      this.scheduleDrain();
    });
  }

  private scheduleDrain(): void {
    if (this.drainTimer !== null || this.queue.length === 0) {
      return;
    }

    const waitMs = Math.max(1, Math.ceil(this.estimateWaitMsForNext()));
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.drain();
    }, waitMs);
    this.drainTimer.unref();
  }

  private drain(): void {
    this.refill();

    while (this.queue.length > 0 && this.tokens >= 1) {
      const waiter = this.queue.shift();
      if (waiter === undefined || waiter.settled) {
        continue;
      }
      this.tokens -= 1;
      this.settle(waiter, null);
    }

    this.scheduleDrain();
  }

  private refill(): void {
    const now = this.now();
    const elapsed = now - this.lastRefillAt;

    if (elapsed <= 0) {
      return;
    }

    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRatePerMs);
    this.lastRefillAt = now;
  }

  /** Wait for a caller that would join the back of the queue. */
  private estimateWaitMs(): number {
    const tokensNeeded = this.queue.length + 1 - this.tokens;
    return tokensNeeded <= 0 ? 0 : tokensNeeded / this.refillRatePerMs;
  }

  /** Wait until the head of the queue can be served. */
  private estimateWaitMsForNext(): number {
    const tokensNeeded = 1 - this.tokens;
    return tokensNeeded <= 0 ? 0 : tokensNeeded / this.refillRatePerMs;
  }

  private remove(waiter: Waiter): void {
    const index = this.queue.indexOf(waiter);
    if (index >= 0) {
      this.queue.splice(index, 1);
    }
  }

  private settle(waiter: Waiter, error: Error | null): void {
    if (waiter.settled) {
      return;
    }
    waiter.settled = true;

    if (waiter.timer !== null) {
      clearTimeout(waiter.timer);
      waiter.timer = null;
    }

    // Detach the abort listener; a caller may reuse one signal across many
    // acquires, and orphaned listeners would accumulate on it.
    if (waiter.onAbort !== null && waiter.signal !== null) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
    }
    waiter.onAbort = null;
    waiter.signal = null;

    if (error === null) {
      waiter.resolve();
    } else {
      waiter.reject(error);
    }
  }
}
