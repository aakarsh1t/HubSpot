import { vi } from 'vitest';
import type { HubSpotClient } from '../../clients/hubspot.client.js';
import type { HubSpotRequestOptions, HubSpotResponse } from '../../types/hubspot.types.js';

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly query: Record<string, unknown> | undefined;
  readonly retryable: boolean | undefined;
}

/**
 * A recording stand-in for `HubSpotClient`.
 *
 * The CRM services are pure orchestration over this one seam, so faking it
 * lets the tests assert the things that actually matter — the exact path, the
 * request body HubSpot will receive, and crucially the `retryable` flag, which
 * is what prevents a replayed create from duplicating a customer record.
 */
export class FakeHubSpotClient {
  readonly requests: RecordedRequest[] = [];

  private responses: unknown[] = [];
  private error: Error | null = null;

  /** Queues responses, returned in order across successive calls. */
  respondWith(...responses: unknown[]): this {
    this.responses = [...responses];
    return this;
  }

  /** Makes the next request reject. */
  failWith(error: Error): this {
    this.error = error;
    return this;
  }

  request<T>(options: HubSpotRequestOptions): Promise<HubSpotResponse<T>> {
    this.requests.push({
      method: options.method,
      path: options.path,
      body: options.body,
      query: options.query,
      retryable: options.retryable,
    });

    if (this.error !== null) {
      const error = this.error;
      this.error = null;
      return Promise.reject(error);
    }

    // Repeats the final queued response once the queue is exhausted, so a
    // service making several identical follow-up calls stays easy to set up.
    const data = (this.responses.length > 1 ? this.responses.shift() : this.responses[0]) ?? null;

    return Promise.resolve({
      status: 200,
      data: data as T,
      durationMs: 1,
      attempts: 1,
    });
  }

  health = vi.fn();

  /** The services depend only on `request`, so this narrowing cast is safe. */
  asClient(): HubSpotClient {
    return this as unknown as HubSpotClient;
  }

  lastRequest(): RecordedRequest {
    const last = this.requests.at(-1);
    if (last === undefined) {
      throw new Error('No request was recorded.');
    }
    return last;
  }

  requestFor(method: string, pathFragment: string): RecordedRequest {
    const match = this.requests.find(
      (request) => request.method === method && request.path.includes(pathFragment)
    );
    if (match === undefined) {
      throw new Error(
        `No ${method} request matching "${pathFragment}". Recorded: ${this.requests
          .map((request) => `${request.method} ${request.path}`)
          .join(', ')}`
      );
    }
    return match;
  }
}
