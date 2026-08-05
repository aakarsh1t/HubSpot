import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../middleware/circuit-breaker.js';
import { CircuitOpenError, UpstreamUnavailableError, ValidationError } from '../utils/errors.js';
import type { CircuitBreakerConfig } from '../types/config.types.js';

const config: CircuitBreakerConfig = {
  enabled: true,
  failureThreshold: 3,
  successThreshold: 2,
  openStateMs: 10_000,
};

/** Controllable clock so cool-down can be tested without waiting. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let current = 1_000_000;
  return {
    now: () => current,
    advance: (ms: number): void => {
      current += ms;
    },
  };
}

const fail = (): Promise<never> => Promise.reject(new UpstreamUnavailableError('down'));
const succeed = (): Promise<string> => Promise.resolve('ok');

describe('CircuitBreaker', () => {
  it('passes calls through untouched when disabled', async () => {
    const breaker = new CircuitBreaker({ config: { ...config, enabled: false }, name: 'test' });

    for (let i = 0; i < 10; i += 1) {
      await expect(breaker.execute(fail)).rejects.toThrow(UpstreamUnavailableError);
    }

    expect(breaker.snapshot().state).toBe('closed');
  });

  it('opens after the failure threshold is reached', async () => {
    const breaker = new CircuitBreaker({ config, name: 'test' });

    for (let i = 0; i < 3; i += 1) {
      await expect(breaker.execute(fail)).rejects.toThrow(UpstreamUnavailableError);
    }

    expect(breaker.snapshot().state).toBe('open');
  });

  it('fails fast without calling the upstream once open', async () => {
    const breaker = new CircuitBreaker({ config, name: 'test' });
    for (let i = 0; i < 3; i += 1) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }

    let called = false;
    await expect(
      breaker.execute(() => {
        called = true;
        return succeed();
      })
    ).rejects.toBeInstanceOf(CircuitOpenError);

    // This is the entire value of the breaker: the upstream is not touched.
    expect(called).toBe(false);
  });

  it('ignores client errors so a caller typo cannot trip the breaker', async () => {
    const breaker = new CircuitBreaker({ config, name: 'test' });

    for (let i = 0; i < 10; i += 1) {
      await expect(
        breaker.execute(() => Promise.reject(new ValidationError('bad input')))
      ).rejects.toBeInstanceOf(ValidationError);
    }

    expect(breaker.snapshot().state).toBe('closed');
  });

  it('half-opens after the cool-down and closes after enough successes', async () => {
    const clock = fakeClock();
    const breaker = new CircuitBreaker({ config, name: 'test', now: clock.now });

    for (let i = 0; i < 3; i += 1) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }
    expect(breaker.snapshot().state).toBe('open');

    clock.advance(10_001);

    await expect(breaker.execute(succeed)).resolves.toBe('ok');
    expect(breaker.snapshot().state).toBe('half_open');

    await expect(breaker.execute(succeed)).resolves.toBe('ok');
    expect(breaker.snapshot().state).toBe('closed');
  });

  it('reopens immediately when the probe fails', async () => {
    const clock = fakeClock();
    const breaker = new CircuitBreaker({ config, name: 'test', now: clock.now });

    for (let i = 0; i < 3; i += 1) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }
    clock.advance(10_001);

    await expect(breaker.execute(fail)).rejects.toThrow(UpstreamUnavailableError);

    // One failed probe is enough; no need to re-earn the full threshold.
    expect(breaker.snapshot().state).toBe('open');
  });

  it('reports the remaining cool-down so callers can back off intelligently', async () => {
    const clock = fakeClock();
    const breaker = new CircuitBreaker({ config, name: 'test', now: clock.now });

    for (let i = 0; i < 3; i += 1) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }

    clock.advance(4_000);
    expect(breaker.snapshot().retryAfterMs).toBe(6_000);
  });

  it('resets to a clean closed state on demand', async () => {
    const breaker = new CircuitBreaker({ config, name: 'test' });
    for (let i = 0; i < 3; i += 1) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }

    breaker.reset();

    const snapshot = breaker.snapshot();
    expect(snapshot.state).toBe('closed');
    expect(snapshot.consecutiveFailures).toBe(0);
    await expect(breaker.execute(succeed)).resolves.toBe('ok');
  });
});
