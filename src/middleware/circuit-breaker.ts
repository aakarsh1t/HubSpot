import type { Logger } from 'pino';
import { type AppError, CircuitOpenError, normalizeError } from '../utils/errors.js';
import type { CircuitBreakerConfig } from '../types/config.types.js';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerSnapshot {
  readonly enabled: boolean;
  readonly state: CircuitState;
  readonly consecutiveFailures: number;
  readonly consecutiveSuccesses: number;
  readonly openedAt: string | null;
  readonly retryAfterMs: number | null;
}

export interface CircuitBreakerOptions {
  readonly config: CircuitBreakerConfig;
  readonly name: string;
  readonly logger?: Logger;
  /** Decides whether a failure counts against the breaker. */
  readonly isFailure?: (error: AppError) => boolean;
  readonly now?: () => number;
}

/**
 * Circuit breaker guarding all outbound HubSpot traffic.
 *
 * Retries alone make an outage worse: when HubSpot is down, every request
 * spends its full retry budget before failing, so latency climbs, connections
 * pile up, and the App Service worker exhausts its thread pool serving
 * requests that were never going to succeed. The breaker converts that slow
 * collapse into fast, cheap failure and gives the upstream room to recover.
 *
 * Only *upstream* faults count. A 401 from a bad token or a 400 from bad input
 * is our fault, not HubSpot's, and tripping the breaker on those would take
 * the integration down over a caller's typo — hence the default `isFailure`
 * predicate keys off `AppError.retryable`.
 */
export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private readonly name: string;
  private readonly logger: Logger | undefined;
  private readonly isFailure: (error: AppError) => boolean;
  private readonly now: () => number;

  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private openedAt: number | null = null;
  /** Ensures only one probe request is in flight while half-open. */
  private probeInFlight = false;

  constructor(options: CircuitBreakerOptions) {
    this.config = options.config;
    this.name = options.name;
    this.logger = options.logger;
    this.isFailure = options.isFailure ?? ((error): boolean => error.retryable);
    this.now = options.now ?? Date.now;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.config.enabled) {
      return operation();
    }

    this.beforeCall();

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (caught) {
      this.onFailure(normalizeError(caught));
      throw caught;
    }
  }

  snapshot(): CircuitBreakerSnapshot {
    return {
      enabled: this.config.enabled,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      openedAt: this.openedAt === null ? null : new Date(this.openedAt).toISOString(),
      retryAfterMs: this.state === 'open' ? this.remainingOpenMs() : null,
    };
  }

  /** Test/ops affordance to force the breaker closed. */
  reset(): void {
    this.transitionTo('closed');
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.openedAt = null;
    this.probeInFlight = false;
  }

  private beforeCall(): void {
    if (this.state === 'open') {
      const remaining = this.remainingOpenMs();

      if (remaining > 0) {
        throw new CircuitOpenError(remaining);
      }

      // Cool-down elapsed: allow a single probe through.
      this.transitionTo('half_open');
      this.consecutiveSuccesses = 0;
      this.probeInFlight = true;
      return;
    }

    if (this.state === 'half_open') {
      if (this.probeInFlight) {
        // A probe is already deciding the upstream's fate; don't pile on.
        throw new CircuitOpenError(this.config.openStateMs);
      }
      this.probeInFlight = true;
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;

    if (this.state === 'half_open') {
      this.probeInFlight = false;
      this.consecutiveSuccesses += 1;

      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.transitionTo('closed');
        this.consecutiveSuccesses = 0;
        this.openedAt = null;
      }
    }
  }

  private onFailure(error: AppError): void {
    if (!this.isFailure(error)) {
      // Caller-side error: it tells us nothing about upstream health.
      if (this.state === 'half_open') {
        this.probeInFlight = false;
      }
      return;
    }

    this.consecutiveSuccesses = 0;

    if (this.state === 'half_open') {
      this.probeInFlight = false;
      this.trip();
      return;
    }

    this.consecutiveFailures += 1;

    if (this.consecutiveFailures >= this.config.failureThreshold) {
      this.trip();
    }
  }

  private trip(): void {
    this.openedAt = this.now();
    this.transitionTo('open');
  }

  private remainingOpenMs(): number {
    if (this.openedAt === null) {
      return 0;
    }
    return Math.max(0, this.config.openStateMs - (this.now() - this.openedAt));
  }

  private transitionTo(next: CircuitState): void {
    if (this.state === next) {
      return;
    }

    const previous = this.state;
    this.state = next;

    const message = `Circuit breaker "${this.name}" transitioned ${previous} -> ${next}.`;
    if (next === 'open') {
      this.logger?.error(
        { breaker: this.name, previous, next, failures: this.consecutiveFailures },
        message
      );
    } else {
      this.logger?.warn({ breaker: this.name, previous, next }, message);
    }
  }
}
