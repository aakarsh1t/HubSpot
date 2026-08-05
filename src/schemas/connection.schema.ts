import { z } from 'zod';

/**
 * Input/output contracts for the connectivity tools.
 *
 * These schemas are not merely validation — the MCP SDK converts them to JSON
 * Schema and ships them in `tools/list`, which is exactly what Copilot Studio's
 * orchestrator reads when deciding whether and how to call a tool. Every
 * `.describe()` here is prompt material for a model, so it is written for that
 * audience rather than for a developer.
 */

export const testConnectionInputSchema = z.object({
  includeAccountDetails: z
    .boolean()
    .default(true)
    .describe(
      'Include HubSpot portal details (portal ID, account type, region) in the response. Defaults to true.'
    ),
});

export const testConnectionOutputSchema = z.object({
  status: z
    .enum(['connected', 'degraded', 'unauthorized', 'unreachable'])
    .describe(
      'connected = fully working; degraded = reachable but slow or throttled; unauthorized = credential or scope problem; unreachable = HubSpot or the network is down.'
    ),
  authMode: z
    .string()
    .describe('Which HubSpot credential strategy is active: private_app or oauth.'),
  latencyMs: z.number().describe('Round-trip time of the verification call, in milliseconds.'),
  checkedAt: z.string().describe('ISO 8601 timestamp of when the check ran.'),
  portalId: z.number().nullable().describe('The HubSpot portal (hub) ID that was reached.'),
  accountType: z
    .string()
    .nullable()
    .describe('HubSpot account type, e.g. STANDARD or DEVELOPER_TEST.'),
  uiDomain: z.string().nullable().describe('Domain used to open this portal in a browser.'),
  dataHostingLocation: z
    .string()
    .nullable()
    .describe('Region hosting the portal data, e.g. na1 or eu1.'),
  scopeCount: z.number().nullable().describe('Number of OAuth scopes granted to the credential.'),
  tokenExpiresAt: z
    .string()
    .nullable()
    .describe(
      'ISO 8601 expiry of the current access token; null for non-expiring private app tokens.'
    ),
  message: z
    .string()
    .describe('Human-readable outcome. On failure this states the remediation step to take.'),
});

export const pingInputSchema = z.object({});

export const pingOutputSchema = z.object({
  ok: z.boolean().describe('True when HubSpot responded successfully.'),
  latencyMs: z.number().describe('Round-trip time in milliseconds.'),
  checkedAt: z.string().describe('ISO 8601 timestamp of when the ping ran.'),
  portalId: z.number().nullable().describe('The HubSpot portal ID that responded.'),
  message: z.string().describe('Human-readable outcome of the ping.'),
});

export type TestConnectionInput = z.output<typeof testConnectionInputSchema>;
export type PingInput = z.output<typeof pingInputSchema>;
