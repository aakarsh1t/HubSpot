import { pino } from 'pino';
import type { Logger } from 'pino';
import type { AccessToken, AuthDescriptor, HubSpotTokenProvider } from '../../types/auth.types.js';
import type { AppConfig } from '../../types/config.types.js';

/** Silent logger — tests assert on behaviour, not on log noise. */
export function testLogger(): Logger {
  return pino({ level: 'silent' });
}

/** Minimal valid environment for `loadConfig`, overridable per test. */
export function testEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    HUBSPOT_AUTH_MODE: 'private_app',
    HUBSPOT_PRIVATE_APP_TOKEN: 'fake-hubspot-private-app-token-for-tests',
    MCP_AUTH_ENABLED: 'true',
    MCP_API_KEY: 'k'.repeat(48),
    ...overrides,
  };
}

/**
 * A fully-formed `AppConfig` for tests that need config but not env parsing.
 * Timings are deliberately tiny so retry/limiter tests stay fast.
 */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base: AppConfig = {
    service: {
      name: 'hubspot-mcp-server',
      version: '0.0.0-test',
      environment: 'test',
      instanceId: 'test-instance',
    },
    http: {
      host: '127.0.0.1',
      port: 0,
      bodyLimitBytes: 1_048_576,
      requestTimeoutMs: 5_000,
      shutdownTimeoutMs: 5_000,
      trustProxy: true,
    },
    log: { level: 'silent', pretty: false },
    mcp: {
      serverName: 'hubspot-mcp-server',
      serverVersion: '0.0.0-test',
      endpointPath: '/mcp',
      sessionMode: 'stateless',
      enableJsonResponse: true,
      sessionTtlMs: 60_000,
      maxSessions: 10,
    },
    hubspot: {
      baseUrl: 'https://api.hubapi.com',
      requestTimeoutMs: 5_000,
      auth: { mode: 'private_app', accessToken: 'fake-hubspot-private-app-token-for-tests' },
    },
    retry: {
      maxAttempts: 3,
      initialDelayMs: 1,
      maxDelayMs: 5,
      backoffFactor: 2,
      jitter: false,
    },
    rateLimit: {
      inbound: { enabled: false, max: 1_000, windowMs: 60_000 },
      outbound: { enabled: false, maxRequests: 1_000, windowMs: 1_000, maxQueueMs: 1_000 },
    },
    circuitBreaker: {
      enabled: false,
      failureThreshold: 5,
      successThreshold: 2,
      openStateMs: 1_000,
    },
    security: { apiKeyEnabled: false, apiKeyHeader: 'x-api-key' },
  };

  return { ...base, ...overrides };
}

/** Token provider fake that records how often it was invalidated. */
export class FakeTokenProvider implements HubSpotTokenProvider {
  invalidateCount = 0;
  getCount = 0;

  constructor(
    readonly mode: 'private_app' | 'oauth' = 'private_app',
    private tokenValue = 'test-token'
  ) {}

  getAccessToken(): Promise<AccessToken> {
    this.getCount += 1;
    return Promise.resolve({
      value: this.tokenValue,
      mode: this.mode,
      expiresAt: null,
      scopes: [],
    });
  }

  invalidate(): Promise<void> {
    this.invalidateCount += 1;
    return Promise.resolve();
  }

  describe(): Promise<AuthDescriptor> {
    return Promise.resolve({
      mode: this.mode,
      expiresAt: null,
      scopeCount: 0,
      tokenFingerprint: '****oken',
    });
  }

  /** Simulates credential rotation. */
  rotate(next: string): void {
    this.tokenValue = next;
  }
}
