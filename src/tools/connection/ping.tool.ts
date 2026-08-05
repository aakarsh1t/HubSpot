import type { HubSpotHealthService } from '../../services/hubspot-health.service.js';
import {
  pingInputSchema,
  pingOutputSchema,
  type PingInput,
} from '../../schemas/connection.schema.js';
import type { HubSpotPingResult } from '../../types/hubspot.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../types/tool.types.js';

/**
 * `hubspot_ping` — minimal liveness probe against the HubSpot API.
 *
 * Deliberately narrower than `hubspot_test_connection`: no scopes, no token
 * metadata, no remediation text. It exists so an agent (or a synthetic monitor)
 * can ask "is HubSpot answering right now?" and get a small, cheap, predictable
 * payload instead of a full diagnostic report.
 */
export class PingHubSpotTool implements ToolDefinition<typeof pingInputSchema, HubSpotPingResult> {
  readonly name = 'hubspot_ping';
  readonly title = 'Ping HubSpot';
  readonly description =
    'Check whether the HubSpot API is currently reachable from this server. ' +
    'Returns a boolean status, the measured round-trip latency in milliseconds, and the HubSpot portal ID. ' +
    'This is a lightweight availability check — use hubspot_test_connection instead when diagnosing ' +
    'authentication or permission problems.';

  readonly inputSchema = pingInputSchema;
  readonly outputSchema = pingOutputSchema;

  readonly annotations = {
    title: 'Ping HubSpot',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly healthService: HubSpotHealthService;

  constructor(healthService: HubSpotHealthService) {
    this.healthService = healthService;
  }

  async execute(_input: PingInput, context: ToolExecutionContext): Promise<HubSpotPingResult> {
    return this.healthService.ping(context.signal);
  }
}
