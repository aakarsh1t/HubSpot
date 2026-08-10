import type { HubSpotHealthService } from '../../services/hubspot-health.service.js';
import {
  diagnosticsInputSchema,
  diagnosticsOutputSchema,
  type DiagnosticsInput,
} from '../../schemas/diagnostics.schema.js';
import type { AppConfig } from '../../types/config.types.js';
import type {
  ToolDefinition,
  ToolDescriptor,
  ToolExecutionContext,
} from '../../types/tool.types.js';

interface DiagnosticsResult {
  readonly status: string;
  readonly message: string;
  readonly latencyMs: number;
  readonly checkedAt: string;
  readonly authMode: string;
  readonly portalId: number | null;
  readonly accountType: string | null;
  readonly uiDomain: string | null;
  readonly dataHostingLocation: string | null;
  readonly scopeCount: number | null;
  readonly tokenExpiresAt: string | null;
  readonly server: {
    readonly name: string;
    readonly version: string;
    readonly environment: string;
    readonly protocolTransport: string;
    readonly sessionMode: string;
    readonly hubspotBaseUrl: string;
    readonly toolCount: number;
    readonly uptimeSeconds: number;
  };
  readonly tools?: readonly ToolDescriptor[];
}

/**
 * `hubspot_diagnostics` — the one tool to call when something is wrong.
 *
 * Consolidates `hubspot_test_connection`, `hubspot_ping`, and
 * `mcp_server_info`. Those three overlapped almost entirely: all an agent ever
 * wanted from any of them was "is this working, and what am I talking to?" —
 * and having three answers to that meant the orchestrator regularly picked the
 * weakest one (a bare ping tells you nothing about *why* a call failed).
 *
 * It never throws for an unhealthy upstream. A diagnostic tool that fails when
 * the thing it diagnoses is down would report "tool error" precisely when the
 * real reason is most needed — so a failed connection is a *successful* call
 * reporting `status: "unauthorized" | "unreachable"` and the remediation.
 *
 * Everything returned is non-sensitive by construction: auth *mode* but never
 * the credential, base URL and portal identity but no internal wiring. This
 * output can appear in a Copilot Studio transcript.
 */
export class DiagnosticsTool implements ToolDefinition<
  typeof diagnosticsInputSchema,
  DiagnosticsResult
> {
  readonly name = 'hubspot_diagnostics';
  readonly title = 'HubSpot Diagnostics';
  readonly description =
    'Check that this server can authenticate with HubSpot and reach the API, and report what it ' +
    'is connected to: connection status, the HubSpot portal reached, auth mode, measured latency, ' +
    'server version and environment, and — when the connection fails — the specific remediation ' +
    'step. Call this FIRST whenever a HubSpot tool fails or you are unsure the integration is ' +
    'configured; it explains the failure instead of just repeating it.';

  readonly inputSchema = diagnosticsInputSchema;
  readonly outputSchema = diagnosticsOutputSchema;

  readonly annotations = {
    title: 'HubSpot Diagnostics',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } as const;

  private readonly config: AppConfig;
  private readonly healthService: HubSpotHealthService;
  private readonly listTools: () => readonly ToolDescriptor[];

  constructor(
    config: AppConfig,
    healthService: HubSpotHealthService,
    // Resolved lazily: this tool is inside the very registry it reports on, so
    // an eager array would be a construction-order cycle.
    listTools: () => readonly ToolDescriptor[]
  ) {
    this.config = config;
    this.healthService = healthService;
    this.listTools = listTools;
  }

  async execute(
    input: DiagnosticsInput,
    context: ToolExecutionContext
  ): Promise<DiagnosticsResult> {
    const report = await this.healthService.testConnection(context.signal);
    const tools = this.listTools();

    return {
      status: report.status,
      message: report.message,
      latencyMs: report.latencyMs,
      checkedAt: report.checkedAt,
      authMode: report.authMode,
      portalId: report.portalId,
      accountType: input.includeAccountDetails ? report.accountType : null,
      uiDomain: input.includeAccountDetails ? report.uiDomain : null,
      dataHostingLocation: input.includeAccountDetails ? report.dataHostingLocation : null,
      scopeCount: report.scopeCount,
      tokenExpiresAt: report.tokenExpiresAt,
      server: {
        name: this.config.mcp.serverName,
        version: this.config.mcp.serverVersion,
        environment: this.config.service.environment,
        protocolTransport: 'streamable-http',
        sessionMode: this.config.mcp.sessionMode,
        hubspotBaseUrl: this.config.hubspot.baseUrl,
        toolCount: tools.length,
        uptimeSeconds: Math.round(process.uptime()),
      },
      ...(input.includeToolCatalogue ? { tools } : {}),
    };
  }
}
