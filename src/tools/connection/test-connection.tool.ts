import type { HubSpotHealthService } from '../../services/hubspot-health.service.js';
import {
  testConnectionInputSchema,
  testConnectionOutputSchema,
  type TestConnectionInput,
} from '../../schemas/connection.schema.js';
import type { HubSpotConnectionReport } from '../../types/hubspot.types.js';
import type { ToolDefinition, ToolExecutionContext } from '../../types/tool.types.js';

/**
 * `hubspot_test_connection` — end-to-end credential and connectivity check.
 *
 * The first tool anyone runs after wiring this server into Copilot Studio, and
 * the one they return to when something breaks. It answers the three questions
 * a failed integration actually raises: are the credentials accepted, *which*
 * portal do they reach, and if it is broken, what do I change?
 *
 * It never throws for an unhealthy upstream. A diagnostic tool that fails when
 * the thing it diagnoses is down would report "tool error" precisely when the
 * user most needs the real reason — so a failed connection is a successful
 * tool call reporting `status: "unauthorized" | "unreachable"`.
 */
export class TestConnectionTool implements ToolDefinition<
  typeof testConnectionInputSchema,
  HubSpotConnectionReport
> {
  readonly name = 'hubspot_test_connection';
  readonly title = 'Test HubSpot Connection';
  readonly description =
    'Verify that this server can authenticate with HubSpot and reach the HubSpot API. ' +
    'Returns the connection status, the HubSpot portal ID it reached, the authentication mode in use, ' +
    'measured latency, and — when the connection fails — the specific remediation step to take. ' +
    'Use this to diagnose HubSpot connectivity or credential problems before running any other HubSpot tool.';

  readonly inputSchema = testConnectionInputSchema;
  readonly outputSchema = testConnectionOutputSchema;

  readonly annotations = {
    title: 'Test HubSpot Connection',
    // Hints for the orchestrator: safe to call, changes nothing, and calling
    // it twice is the same as calling it once.
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly healthService: HubSpotHealthService;

  constructor(healthService: HubSpotHealthService) {
    this.healthService = healthService;
  }

  async execute(
    input: TestConnectionInput,
    context: ToolExecutionContext
  ): Promise<HubSpotConnectionReport> {
    const report = await this.healthService.testConnection(context.signal);

    if (input.includeAccountDetails) {
      return report;
    }

    // Callers can opt out of portal identity — useful when the result is
    // relayed into a chat transcript that should not carry account metadata.
    return {
      ...report,
      accountType: null,
      uiDomain: null,
      dataHostingLocation: null,
    };
  }
}
