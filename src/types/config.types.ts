/**
 * Domain-level configuration contract.
 *
 * These types are deliberately hand-written rather than inferred from the Zod
 * environment schema. The env schema describes *transport* (flat, stringly
 * typed process.env); this file describes the *domain* (nested, richly typed,
 * with illegal states made unrepresentable). `loadConfig` is the translation
 * layer between them, which is what lets us change env var names without
 * rippling changes through the whole application.
 */

export type NodeEnv = 'development' | 'test' | 'production';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

export type HubSpotAuthMode = 'private_app' | 'oauth';

/**
 * `stateless` creates a fresh MCP server + transport per request. It is the
 * correct default on Azure App Service, where horizontal scale-out and
 * instance recycling mean a follow-up request may not reach the instance that
 * created the session.
 *
 * `stateful` keeps sessions in process memory and requires session affinity
 * (ARR affinity) to be enabled.
 */
export type McpSessionMode = 'stateless' | 'stateful';

export interface ServiceConfig {
  readonly name: string;
  readonly version: string;
  readonly environment: NodeEnv;
  /** Unique per process. Correlates logs across App Service instances. */
  readonly instanceId: string;
}

export interface HttpConfig {
  readonly host: string;
  readonly port: number;
  readonly bodyLimitBytes: number;
  readonly requestTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  /** Must be true behind Azure App Service so client IPs resolve correctly. */
  readonly trustProxy: boolean;
}

export interface LogConfig {
  readonly level: LogLevel;
  readonly pretty: boolean;
}

export interface McpConfig {
  readonly serverName: string;
  readonly serverVersion: string;
  readonly endpointPath: string;
  readonly sessionMode: McpSessionMode;
  /**
   * When true the transport answers POSTs with a single JSON body instead of
   * opening an SSE stream. Power Platform / Copilot Studio connectors proxy
   * plain JSON far more reliably than long-lived streams.
   */
  readonly enableJsonResponse: boolean;
  readonly sessionTtlMs: number;
  readonly maxSessions: number;
}

export interface RetryConfig {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffFactor: number;
  readonly jitter: boolean;
}

/** Inbound HTTP throttling (protects this server). */
export interface InboundRateLimitConfig {
  readonly enabled: boolean;
  readonly max: number;
  readonly windowMs: number;
}

/** Outbound call pacing (protects our HubSpot quota). */
export interface OutboundRateLimitConfig {
  readonly enabled: boolean;
  readonly maxRequests: number;
  readonly windowMs: number;
  /** How long a call may wait for a token before failing fast. */
  readonly maxQueueMs: number;
}

export interface CircuitBreakerConfig {
  readonly enabled: boolean;
  readonly failureThreshold: number;
  readonly successThreshold: number;
  readonly openStateMs: number;
}

export interface HubSpotPrivateAppAuthConfig {
  readonly mode: 'private_app';
  readonly accessToken: string;
}

export interface HubSpotOAuthAuthConfig {
  readonly mode: 'oauth';
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly redirectUri: string | null;
  readonly scopes: readonly string[];
  /** Refresh this many seconds before actual expiry to avoid edge-of-life 401s. */
  readonly refreshMarginSeconds: number;
}

/**
 * A discriminated union, not a bag of optionals: it is impossible to construct
 * a config that claims OAuth mode while carrying only a private app token.
 */
export type HubSpotAuthConfig = HubSpotPrivateAppAuthConfig | HubSpotOAuthAuthConfig;

export interface HubSpotConfig {
  readonly baseUrl: string;
  readonly requestTimeoutMs: number;
  readonly auth: HubSpotAuthConfig;
}

/**
 * Inbound authentication for the MCP endpoint itself.
 *
 * Modelled as a union so `enabled: true` without a key cannot type-check —
 * the class of misconfiguration that silently exposes a server to the public
 * internet.
 */
export type SecurityConfig =
  | { readonly apiKeyEnabled: false; readonly apiKeyHeader: string }
  | { readonly apiKeyEnabled: true; readonly apiKeyHeader: string; readonly apiKey: string };

export interface AppConfig {
  readonly service: ServiceConfig;
  readonly http: HttpConfig;
  readonly log: LogConfig;
  readonly mcp: McpConfig;
  readonly hubspot: HubSpotConfig;
  readonly retry: RetryConfig;
  readonly rateLimit: {
    readonly inbound: InboundRateLimitConfig;
    readonly outbound: OutboundRateLimitConfig;
  };
  readonly circuitBreaker: CircuitBreakerConfig;
  readonly security: SecurityConfig;
}
