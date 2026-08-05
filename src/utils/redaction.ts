/**
 * Secret-handling helpers.
 *
 * The rule this file enforces: a credential may appear in a log line only as a
 * fingerprint, never in full — not even at trace level, because trace logs get
 * shipped to Log Analytics like everything else.
 */

/**
 * Paths Pino strips from every log record.
 *
 * Deliberately broad: it is cheaper to redact a field that was never sensitive
 * than to discover a bearer token in a log aggregator.
 */
export const LOG_REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-hubspot-signature"]',
  'req.headers["x-hubspot-signature-v3"]',
  'res.headers["set-cookie"]',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'clientSecret',
  'client_secret',
  'apiKey',
  'api_key',
  'password',
  'token',
  'authorization',
  '*.accessToken',
  '*.refreshToken',
  '*.clientSecret',
  '*.apiKey',
  '*.token',
  'config.hubspot.auth.accessToken',
  'config.hubspot.auth.clientSecret',
  'config.hubspot.auth.refreshToken',
  'config.security.apiKey',
];

/**
 * Produces a stable, non-reversible-enough identifier for a secret.
 *
 * Keeps the HubSpot key prefix (`pat-na1-`) because it is genuinely useful for
 * debugging — it identifies the credential *type* and data-residency region —
 * and appends the last four characters so an operator can confirm which key is
 * loaded without ever seeing the key.
 */
export function fingerprintSecret(secret: string | null | undefined): string {
  if (secret === null || secret === undefined || secret.length === 0) {
    return '<absent>';
  }

  if (secret.length <= 8) {
    return '****';
  }

  const lastFour = secret.slice(-4);
  const prefixMatch = /^(pat-[a-z0-9]+-|pat-|na\d-)/i.exec(secret);
  const prefix = prefixMatch?.[0] ?? '';

  return `${prefix}****${lastFour}`;
}

/** Masks a value entirely, preserving only whether it was present. */
export function maskPresence(value: string | null | undefined): string {
  return value === null || value === undefined || value.length === 0 ? '<absent>' : '<set>';
}
