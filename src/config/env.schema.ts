import { z } from 'zod';

/**
 * The environment contract.
 *
 * This schema is the *only* place `process.env` is interpreted. Everything
 * downstream consumes the typed `AppConfig`, so no module ever reads a raw env
 * var and no misconfiguration survives past startup — the process refuses to
 * boot rather than failing later on a customer request.
 */

/** Env vars are strings; coerce booleans from the spellings operators actually use. */
const envBoolean = (defaultValue: boolean): z.ZodType<boolean> =>
  z.preprocess((value) => {
    if (value === undefined || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    // Anything that is not a string cannot have come from process.env; pass it
    // through so z.boolean() reports a precise type error rather than us
    // stringifying an object into '[object Object]'.
    if (typeof value !== 'string') return value;

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;

    // Fall through unchanged so z.boolean() reports a precise error.
    return value;
  }, z.boolean());

const envInt = (options: {
  readonly default?: number;
  readonly min?: number;
  readonly max?: number;
}): z.ZodType<number> => {
  let schema = z.number().int();
  if (options.min !== undefined) schema = schema.min(options.min);
  if (options.max !== undefined) schema = schema.max(options.max);

  return z.preprocess((value) => {
    if (value === undefined || value === '') return options.default;
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return value;
    const parsed = Number(value.trim());
    return Number.isNaN(parsed) ? value : parsed;
  }, schema);
};

const envNumber = (options: {
  readonly default?: number;
  readonly min?: number;
  readonly max?: number;
}): z.ZodType<number> => {
  let schema = z.number();
  if (options.min !== undefined) schema = schema.min(options.min);
  if (options.max !== undefined) schema = schema.max(options.max);

  return z.preprocess((value) => {
    if (value === undefined || value === '') return options.default;
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return value;
    const parsed = Number(value.trim());
    return Number.isNaN(parsed) ? value : parsed;
  }, schema);
};

/** Treats whitespace-only values as absent — a very common `.env` mistake. */
const optionalString = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

export const envSchema = z
  .object({
    // ---------------------------------------------------------------- runtime
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    SERVICE_NAME: z.string().trim().min(1).default('hubspot-mcp-server'),
    SERVICE_VERSION: z.string().trim().min(1).default('0.1.0'),

    // ------------------------------------------------------------------- http
    // Azure App Service injects PORT and expects the app to bind it.
    PORT: envInt({ default: 8080, min: 1, max: 65535 }),
    // 0.0.0.0 is required on App Service; localhost-only would fail health checks.
    HOST: z.string().trim().min(1).default('0.0.0.0'),
    HTTP_BODY_LIMIT_BYTES: envInt({ default: 1_048_576, min: 1024, max: 33_554_432 }),
    HTTP_REQUEST_TIMEOUT_MS: envInt({ default: 30_000, min: 1_000, max: 300_000 }),
    HTTP_SHUTDOWN_TIMEOUT_MS: envInt({ default: 15_000, min: 1_000, max: 120_000 }),
    HTTP_TRUST_PROXY: envBoolean(true),

    // ---------------------------------------------------------------- logging
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
    LOG_PRETTY: envBoolean(false),

    // -------------------------------------------------------------------- mcp
    MCP_SERVER_NAME: z.string().trim().min(1).default('hubspot-mcp-server'),
    MCP_SERVER_VERSION: z.string().trim().min(1).default('0.1.0'),
    MCP_ENDPOINT_PATH: z
      .string()
      .trim()
      .regex(/^\/[a-zA-Z0-9\-_/]*$/u, 'MCP_ENDPOINT_PATH must be an absolute path such as /mcp')
      .default('/mcp'),
    MCP_SESSION_MODE: z.enum(['stateless', 'stateful']).default('stateless'),
    MCP_ENABLE_JSON_RESPONSE: envBoolean(true),
    MCP_SESSION_TTL_MS: envInt({ default: 1_800_000, min: 60_000, max: 86_400_000 }),
    MCP_MAX_SESSIONS: envInt({ default: 1_000, min: 1, max: 100_000 }),

    // --------------------------------------------------------------- security
    MCP_AUTH_ENABLED: envBoolean(true),
    MCP_API_KEY: optionalString,
    MCP_API_KEY_HEADER: z.string().trim().min(1).default('x-api-key'),

    // ---------------------------------------------------------------- hubspot
    HUBSPOT_AUTH_MODE: z.enum(['private_app', 'oauth']).default('private_app'),
    HUBSPOT_BASE_URL: z.url().default('https://api.hubapi.com'),
    HUBSPOT_REQUEST_TIMEOUT_MS: envInt({ default: 30_000, min: 1_000, max: 120_000 }),

    HUBSPOT_PRIVATE_APP_TOKEN: optionalString,

    HUBSPOT_CLIENT_ID: optionalString,
    HUBSPOT_CLIENT_SECRET: optionalString,
    HUBSPOT_REFRESH_TOKEN: optionalString,
    HUBSPOT_REDIRECT_URI: optionalString,
    HUBSPOT_SCOPES: z.string().trim().default(''),
    HUBSPOT_TOKEN_REFRESH_MARGIN_SECONDS: envInt({ default: 300, min: 0, max: 3_600 }),

    // ------------------------------------------------------------------ retry
    RETRY_MAX_ATTEMPTS: envInt({ default: 3, min: 1, max: 10 }),
    RETRY_INITIAL_DELAY_MS: envInt({ default: 250, min: 10, max: 60_000 }),
    RETRY_MAX_DELAY_MS: envInt({ default: 8_000, min: 10, max: 120_000 }),
    RETRY_BACKOFF_FACTOR: envNumber({ default: 2, min: 1, max: 10 }),
    RETRY_JITTER: envBoolean(true),

    // ------------------------------------------------------------- rate limit
    HTTP_RATE_LIMIT_ENABLED: envBoolean(true),
    HTTP_RATE_LIMIT_MAX: envInt({ default: 300, min: 1, max: 1_000_000 }),
    HTTP_RATE_LIMIT_WINDOW_MS: envInt({ default: 60_000, min: 1_000, max: 3_600_000 }),

    HUBSPOT_RATE_LIMIT_ENABLED: envBoolean(true),
    // HubSpot's documented baseline for private apps is 110 requests / 10s.
    // We default just below it to leave headroom for other integrations.
    HUBSPOT_RATE_LIMIT_MAX_REQUESTS: envInt({ default: 100, min: 1, max: 10_000 }),
    HUBSPOT_RATE_LIMIT_WINDOW_MS: envInt({ default: 10_000, min: 100, max: 600_000 }),
    HUBSPOT_RATE_LIMIT_MAX_QUEUE_MS: envInt({ default: 10_000, min: 0, max: 120_000 }),

    // -------------------------------------------------------- circuit breaker
    CIRCUIT_BREAKER_ENABLED: envBoolean(true),
    CIRCUIT_BREAKER_FAILURE_THRESHOLD: envInt({ default: 5, min: 1, max: 100 }),
    CIRCUIT_BREAKER_SUCCESS_THRESHOLD: envInt({ default: 2, min: 1, max: 100 }),
    CIRCUIT_BREAKER_OPEN_STATE_MS: envInt({ default: 30_000, min: 1_000, max: 600_000 }),
  })
  // Cross-field rules. Each one encodes a failure we would otherwise only
  // discover in production, on a live request.
  .superRefine((env, ctx) => {
    if (env.HUBSPOT_AUTH_MODE === 'private_app') {
      if (env.HUBSPOT_PRIVATE_APP_TOKEN === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['HUBSPOT_PRIVATE_APP_TOKEN'],
          message:
            'HUBSPOT_PRIVATE_APP_TOKEN is required when HUBSPOT_AUTH_MODE=private_app. Create one in HubSpot under Settings → Integrations → Private Apps.',
        });
      }
    } else {
      const missing = (
        [
          ['HUBSPOT_CLIENT_ID', env.HUBSPOT_CLIENT_ID],
          ['HUBSPOT_CLIENT_SECRET', env.HUBSPOT_CLIENT_SECRET],
          ['HUBSPOT_REFRESH_TOKEN', env.HUBSPOT_REFRESH_TOKEN],
        ] as const
      ).filter(([, value]) => value === undefined);

      for (const [name] of missing) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} is required when HUBSPOT_AUTH_MODE=oauth.`,
        });
      }
    }

    if (env.MCP_AUTH_ENABLED && env.MCP_API_KEY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['MCP_API_KEY'],
        message:
          'MCP_API_KEY is required when MCP_AUTH_ENABLED=true. Set MCP_AUTH_ENABLED=false only for local development.',
      });
    }

    // A short key is barely better than no key; refuse it outright in production.
    if (env.MCP_AUTH_ENABLED && env.MCP_API_KEY !== undefined && env.MCP_API_KEY.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['MCP_API_KEY'],
        message:
          'MCP_API_KEY must be at least 32 characters. Generate one with `openssl rand -hex 32`.',
      });
    }

    // Refuse to start an unauthenticated server in production. This is the
    // guard that stops a misapplied App Service setting from publishing an
    // open MCP endpoint to the internet.
    if (env.NODE_ENV === 'production' && !env.MCP_AUTH_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['MCP_AUTH_ENABLED'],
        message: 'MCP_AUTH_ENABLED must not be false when NODE_ENV=production.',
      });
    }

    if (env.RETRY_MAX_DELAY_MS < env.RETRY_INITIAL_DELAY_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['RETRY_MAX_DELAY_MS'],
        message: 'RETRY_MAX_DELAY_MS must be greater than or equal to RETRY_INITIAL_DELAY_MS.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
