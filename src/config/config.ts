import { randomUUID } from 'node:crypto';
import { type z } from 'zod';
import { envSchema, type Env } from './env.schema.js';
import { ConfigurationError } from '../utils/errors.js';
import type {
  AppConfig,
  HubSpotAuthConfig,
  SecurityConfig,
  ServiceConfig,
} from '../types/config.types.js';

/**
 * Validates the environment and translates it into the domain `AppConfig`.
 *
 * Called exactly once, at startup, before anything else is constructed. If it
 * throws, the process exits — a server running on half-valid configuration is
 * more dangerous than one that never started.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    throw new ConfigurationError(formatIssues(parsed.error), {
      invalidKeys: [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))],
    });
  }

  const env = parsed.data;

  return {
    service: buildServiceConfig(env, source),
    http: {
      host: env.HOST,
      port: env.PORT,
      bodyLimitBytes: env.HTTP_BODY_LIMIT_BYTES,
      requestTimeoutMs: env.HTTP_REQUEST_TIMEOUT_MS,
      shutdownTimeoutMs: env.HTTP_SHUTDOWN_TIMEOUT_MS,
      trustProxy: env.HTTP_TRUST_PROXY,
    },
    log: {
      level: env.LOG_LEVEL,
      pretty: env.LOG_PRETTY,
    },
    mcp: {
      serverName: env.MCP_SERVER_NAME,
      serverVersion: env.MCP_SERVER_VERSION,
      endpointPath: normalizePath(env.MCP_ENDPOINT_PATH),
      sessionMode: env.MCP_SESSION_MODE,
      enableJsonResponse: env.MCP_ENABLE_JSON_RESPONSE,
      sessionTtlMs: env.MCP_SESSION_TTL_MS,
      maxSessions: env.MCP_MAX_SESSIONS,
    },
    hubspot: {
      baseUrl: stripTrailingSlash(env.HUBSPOT_BASE_URL),
      requestTimeoutMs: env.HUBSPOT_REQUEST_TIMEOUT_MS,
      auth: buildAuthConfig(env),
    },
    retry: {
      maxAttempts: env.RETRY_MAX_ATTEMPTS,
      initialDelayMs: env.RETRY_INITIAL_DELAY_MS,
      maxDelayMs: env.RETRY_MAX_DELAY_MS,
      backoffFactor: env.RETRY_BACKOFF_FACTOR,
      jitter: env.RETRY_JITTER,
    },
    rateLimit: {
      inbound: {
        enabled: env.HTTP_RATE_LIMIT_ENABLED,
        max: env.HTTP_RATE_LIMIT_MAX,
        windowMs: env.HTTP_RATE_LIMIT_WINDOW_MS,
      },
      outbound: {
        enabled: env.HUBSPOT_RATE_LIMIT_ENABLED,
        maxRequests: env.HUBSPOT_RATE_LIMIT_MAX_REQUESTS,
        windowMs: env.HUBSPOT_RATE_LIMIT_WINDOW_MS,
        maxQueueMs: env.HUBSPOT_RATE_LIMIT_MAX_QUEUE_MS,
      },
    },
    circuitBreaker: {
      enabled: env.CIRCUIT_BREAKER_ENABLED,
      failureThreshold: env.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      successThreshold: env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
      openStateMs: env.CIRCUIT_BREAKER_OPEN_STATE_MS,
    },
    security: buildSecurityConfig(env),
  };
}

function buildServiceConfig(env: Env, source: NodeJS.ProcessEnv): ServiceConfig {
  return {
    name: env.SERVICE_NAME,
    version: env.SERVICE_VERSION,
    environment: env.NODE_ENV,
    // App Service sets WEBSITE_INSTANCE_ID per worker. Preferring it means log
    // records can be traced back to the exact instance that served a request.
    instanceId: source.WEBSITE_INSTANCE_ID?.slice(0, 12) ?? randomUUID().slice(0, 12),
  };
}

/**
 * Asserts a conditionally-required variable is present.
 *
 * `superRefine` has already proven these exist for the selected mode, so this
 * is unreachable in practice. It is a deliberate belt-and-braces guard: if the
 * schema and this mapping ever drift apart, the result is a named
 * configuration error at startup rather than `undefined` silently becoming an
 * access token and every HubSpot call failing with a baffling 401.
 */
function required(value: string | undefined, variable: string): string {
  if (value === undefined) {
    throw new ConfigurationError(
      `${variable} is required for the selected mode but was missing after validation.`,
      { variable }
    );
  }
  return value;
}

function buildAuthConfig(env: Env): HubSpotAuthConfig {
  if (env.HUBSPOT_AUTH_MODE === 'private_app') {
    return {
      mode: 'private_app',
      accessToken: required(env.HUBSPOT_PRIVATE_APP_TOKEN, 'HUBSPOT_PRIVATE_APP_TOKEN'),
    };
  }

  return {
    mode: 'oauth',
    clientId: required(env.HUBSPOT_CLIENT_ID, 'HUBSPOT_CLIENT_ID'),
    clientSecret: required(env.HUBSPOT_CLIENT_SECRET, 'HUBSPOT_CLIENT_SECRET'),
    refreshToken: required(env.HUBSPOT_REFRESH_TOKEN, 'HUBSPOT_REFRESH_TOKEN'),
    redirectUri: env.HUBSPOT_REDIRECT_URI ?? null,
    scopes: parseScopes(env.HUBSPOT_SCOPES),
    refreshMarginSeconds: env.HUBSPOT_TOKEN_REFRESH_MARGIN_SECONDS,
  };
}

function buildSecurityConfig(env: Env): SecurityConfig {
  if (!env.MCP_AUTH_ENABLED) {
    return { apiKeyEnabled: false, apiKeyHeader: env.MCP_API_KEY_HEADER.toLowerCase() };
  }

  return {
    apiKeyEnabled: true,
    apiKeyHeader: env.MCP_API_KEY_HEADER.toLowerCase(),
    apiKey: required(env.MCP_API_KEY, 'MCP_API_KEY'),
  };
}

/** HubSpot scopes are space-delimited, but comma-separated lists are a common slip. */
function parseScopes(raw: string): readonly string[] {
  return raw
    .split(/[\s,]+/u)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function normalizePath(path: string): string {
  const withoutTrailing = stripTrailingSlash(path);
  return withoutTrailing === '' ? '/' : withoutTrailing;
}

/**
 * Renders Zod issues as an operator-readable checklist.
 *
 * Startup failures are read at 3am from a log stream, so the message names
 * every offending variable explicitly instead of dumping a nested error tree.
 */
function formatIssues(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const key = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `  • ${key}: ${issue.message}`;
  });

  return `Invalid environment configuration:\n${lines.join('\n')}`;
}
