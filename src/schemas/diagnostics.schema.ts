import { z } from 'zod';

/**
 * Input/output contract for the single diagnostics tool.
 *
 * It replaces three separate tools — `hubspot_test_connection`,
 * `hubspot_ping`, and `mcp_server_info` — which between them answered one
 * question ("is this integration working, and what am I connected to?") in
 * three overlapping ways. Three catalogue entries for one question is three
 * chances for the orchestrator to pick the least useful of them, on top of the
 * per-turn cost of carrying all three.
 */

export const diagnosticsInputSchema = z.object({
  includeAccountDetails: z
    .boolean()
    .default(true)
    .describe(
      'Include HubSpot portal identity (portal ID, account type, region). Set false when the ' +
        'result will be relayed into a transcript that should not carry account metadata.'
    ),
  includeToolCatalogue: z
    .boolean()
    .default(false)
    .describe(
      'Include the full list of tools this server exposes. Defaults to false — it is a large ' +
        'response and the tools are already listed in the MCP session.'
    ),
});

export const diagnosticsOutputSchema = z.object({
  status: z
    .enum(['connected', 'degraded', 'unauthorized', 'unreachable'])
    .describe(
      'connected = fully working; degraded = reachable but slow or throttled; unauthorized = ' +
        'credential or scope problem; unreachable = HubSpot or the network is down.'
    ),
  message: z
    .string()
    .describe('Human-readable outcome. On failure this states the remediation step to take.'),
  latencyMs: z.number().describe('Round-trip time of the verification call, in milliseconds.'),
  checkedAt: z.string().describe('ISO 8601 timestamp of when the check ran.'),

  authMode: z.string().describe('HubSpot credential strategy in use: private_app or oauth.'),
  portalId: z.number().nullable().describe('The HubSpot portal (hub) ID that was reached.'),
  accountType: z.string().nullable(),
  uiDomain: z.string().nullable(),
  dataHostingLocation: z.string().nullable().describe('Region hosting the portal data, e.g. na1.'),
  scopeCount: z.number().nullable().describe('Number of OAuth scopes granted to the credential.'),
  tokenExpiresAt: z
    .string()
    .nullable()
    .describe('ISO 8601 token expiry; null for non-expiring private app tokens.'),

  server: z.object({
    name: z.string(),
    version: z.string(),
    environment: z.string(),
    protocolTransport: z.string(),
    sessionMode: z.string(),
    hubspotBaseUrl: z.string(),
    toolCount: z.number(),
    uptimeSeconds: z.number(),
  }),

  tools: z
    .array(z.object({ name: z.string(), title: z.string(), description: z.string() }))
    .optional()
    .describe('Present only when includeToolCatalogue is true.'),
});

export type DiagnosticsInput = z.output<typeof diagnosticsInputSchema>;
