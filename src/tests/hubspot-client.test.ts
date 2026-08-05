import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HubSpotClient } from '../clients/hubspot.client.js';
import { CircuitBreaker } from '../middleware/circuit-breaker.js';
import { TokenBucketRateLimiter } from '../middleware/rate-limiter.js';
import {
  AuthenticationError,
  HubSpotRateLimitError,
  UpstreamUnavailableError,
} from '../utils/errors.js';
import type { HubSpotConfig, RetryConfig } from '../types/config.types.js';
import { FakeTokenProvider, testLogger } from './helpers/fixtures.js';

const hubspotConfig: HubSpotConfig = {
  baseUrl: 'https://api.hubapi.com',
  requestTimeoutMs: 5_000,
  auth: { mode: 'private_app', accessToken: 'pat-na1-test' },
};

const retryConfig: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1,
  maxDelayMs: 5,
  backoffFactor: 2,
  jitter: false,
};

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

interface ClientHarness {
  client: HubSpotClient;
  tokenProvider: FakeTokenProvider;
  breaker: CircuitBreaker;
}

function buildClient(
  options: {
    mode?: 'private_app' | 'oauth';
    breakerEnabled?: boolean;
    limiterEnabled?: boolean;
  } = {}
): ClientHarness {
  const tokenProvider = new FakeTokenProvider(options.mode ?? 'private_app');
  const logger = testLogger();

  const breaker = new CircuitBreaker({
    config: {
      enabled: options.breakerEnabled ?? false,
      failureThreshold: 2,
      successThreshold: 1,
      openStateMs: 10_000,
    },
    name: 'test',
    logger,
  });

  const client = new HubSpotClient({
    config: hubspotConfig,
    retryConfig,
    tokenProvider,
    rateLimiter: new TokenBucketRateLimiter({
      enabled: options.limiterEnabled ?? false,
      maxRequests: 100,
      windowMs: 1_000,
      maxQueueMs: 1_000,
    }),
    circuitBreaker: breaker,
    logger,
    userAgent: 'hubspot-mcp-server/test',
  });

  return { client, tokenProvider, breaker };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HubSpotClient.request', () => {
  it('performs a successful request and reports attempt count', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { portalId: 123 }));
    const { client } = buildClient();

    const response = await client.request<{ portalId: number }>({
      method: 'GET',
      path: '/account-info/v3/details',
    });

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ portalId: 123 });
    expect(response.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the bearer token and identifying user agent', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    const { client } = buildClient();

    await client.request({ method: 'GET', path: '/account-info/v3/details' });

    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string> };
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer test-token');

    // The SDK unconditionally appends its own `User-agent`, so the header
    // carries both identities. That is desirable — HubSpot support can see the
    // calling application and the SDK version — but it is emergent behaviour,
    // so it is asserted rather than assumed.
    expect(headers.get('user-agent')).toContain('hubspot-mcp-server/test');
    expect(headers.get('user-agent')).toContain('hubspot-api-client-nodejs');
  });

  it('builds the URL from base path, path, and query', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    const { client } = buildClient();

    await client.request({
      method: 'GET',
      path: '/crm/v3/objects/contacts',
      query: { limit: 10, archived: false },
    });

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('https://api.hubapi.com/crm/v3/objects/contacts');
    expect(url).toContain('limit=10');
    expect(url).toContain('archived=false');
  });

  it('retries a 500 and succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { message: 'server error' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const { client } = buildClient();
    const response = await client.request({ method: 'GET', path: '/x' });

    expect(response.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 400', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { message: 'bad request' }));
    const { client } = buildClient();

    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 honouring Retry-After', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, { message: 'slow down' }, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const { client } = buildClient();
    const response = await client.request({ method: 'GET', path: '/x' });

    expect(response.attempts).toBe(2);
  });

  it('surfaces a persistent 429 as a rate limit error', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(429, { message: 'slow down' }, { 'retry-after': '0' })
    );
    const { client } = buildClient();

    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      HubSpotRateLimitError
    );
  });

  it('invalidates the token on 401 and does not retry under private app auth', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'bad credentials' }));
    const { client, tokenProvider } = buildClient({ mode: 'private_app' });

    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      AuthenticationError
    );

    expect(tokenProvider.invalidateCount).toBe(1);
    // A private app token never expires, so re-trying it is pure waste.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries exactly once on 401 under oauth, after re-authenticating', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const { client, tokenProvider } = buildClient({ mode: 'oauth' });
    const response = await client.request({ method: 'GET', path: '/x' });

    expect(response.attempts).toBe(2);
    expect(tokenProvider.invalidateCount).toBe(1);
  });

  it('gives up after a second 401 under oauth', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'expired' }));
    const { client } = buildClient({ mode: 'oauth' });

    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      AuthenticationError
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honours retryable: false for non-idempotent calls', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { message: 'unavailable' }));
    const { client } = buildClient();

    await expect(
      client.request({ method: 'POST', path: '/x', body: {}, retryable: false })
    ).rejects.toBeInstanceOf(UpstreamUnavailableError);

    // Replaying a write that may have partially applied is worse than failing.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies a network failure as retryable', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    const { client } = buildClient();

    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      UpstreamUnavailableError
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns null for an empty 204 body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { client } = buildClient();

    const response = await client.request({ method: 'DELETE', path: '/x' });
    expect(response.data).toBeNull();
  });

  it('reports a malformed success body as an error rather than returning junk', async () => {
    fetchMock.mockResolvedValue(
      new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const { client } = buildClient();

    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow();
  });

  it('opens the circuit after repeated upstream failures and then fails fast', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { message: 'down' }));
    const { client, breaker } = buildClient({ breakerEnabled: true });

    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow();
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow();
    expect(breaker.snapshot().state).toBe('open');

    const callsBefore = fetchMock.mock.calls.length;
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow(/circuit breaker/i);

    // Fails without touching the network at all.
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('does not let a client error trip the breaker', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { message: 'bad' }));
    const { client, breaker } = buildClient({ breakerEnabled: true });

    for (let i = 0; i < 5; i += 1) {
      await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow();
    }

    expect(breaker.snapshot().state).toBe('closed');
  });

  it('consumes a rate limit token per attempt, including retries', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(200, {}));

    const tokenProvider = new FakeTokenProvider();
    const limiter = new TokenBucketRateLimiter({
      enabled: true,
      maxRequests: 10,
      windowMs: 100_000,
      maxQueueMs: 0,
    });

    const client = new HubSpotClient({
      config: hubspotConfig,
      retryConfig,
      tokenProvider,
      rateLimiter: limiter,
      circuitBreaker: new CircuitBreaker({
        config: { enabled: false, failureThreshold: 5, successThreshold: 1, openStateMs: 1_000 },
        name: 'test',
      }),
      logger: testLogger(),
      userAgent: 'test',
    });

    await client.request({ method: 'GET', path: '/x' });

    // Two attempts => two tokens; a retry is a real request against the quota.
    expect(limiter.snapshot().availableTokens).toBe(8);
  });

  it('exposes resilience state for the readiness endpoint', () => {
    const { client } = buildClient({ breakerEnabled: true, limiterEnabled: true });
    const health = client.health();

    expect(health.circuitBreaker.state).toBe('closed');
    expect(health.rateLimiter.enabled).toBe(true);
  });
});
