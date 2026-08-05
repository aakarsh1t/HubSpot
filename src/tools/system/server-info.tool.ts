import {
  serverInfoInputSchema,
  serverInfoOutputSchema,
  type ServerInfoInput,
} from '../../schemas/server-info.schema.js';
import type { AppConfig } from '../../types/config.types.js';
import type { ToolDefinition, ToolDescriptor } from '../../types/tool.types.js';

interface ServerInfoOutput {
  readonly name: string;
  readonly version: string;
  readonly environment: string;
  readonly protocolTransport: string;
  readonly sessionMode: string;
  readonly authMode: string;
  readonly hubspotBaseUrl: string;
  readonly toolCount: number;
  readonly tools: readonly ToolDescriptor[];
  readonly uptimeSeconds: number;
}

/**
 * `mcp_server_info` — self-description of this server.
 *
 * Useful during Copilot Studio onboarding to confirm which build and
 * configuration an agent is actually talking to, which is otherwise guesswork
 * across dev/test/prod App Service slots.
 *
 * Everything it returns is non-sensitive by construction: base URL and auth
 * *mode* but never the credential, tool names but never internal wiring. The
 * output of this tool can appear in a chat transcript.
 *
 * The tool list is supplied as a callback rather than an array because the
 * registry is still being populated when this tool is constructed — resolving
 * it lazily avoids a construction-order cycle.
 */
export class ServerInfoTool implements ToolDefinition<
  typeof serverInfoInputSchema,
  ServerInfoOutput
> {
  readonly name = 'mcp_server_info';
  readonly title = 'MCP Server Info';
  readonly description =
    'Return metadata about this MCP server: its name, version, deployment environment, transport, ' +
    'HubSpot authentication mode, and the catalogue of tools it exposes. ' +
    'Use this to confirm which server and configuration you are connected to, or to discover available tools.';

  readonly inputSchema = serverInfoInputSchema;
  readonly outputSchema = serverInfoOutputSchema;

  readonly annotations = {
    title: 'MCP Server Info',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    // Answers from local state only — no external system is consulted.
    openWorldHint: false,
  } as const;

  private readonly config: AppConfig;
  private readonly listTools: () => readonly ToolDescriptor[];

  constructor(config: AppConfig, listTools: () => readonly ToolDescriptor[]) {
    this.config = config;
    this.listTools = listTools;
  }

  execute(_input: ServerInfoInput): Promise<ServerInfoOutput> {
    const tools = this.listTools();

    return Promise.resolve({
      name: this.config.mcp.serverName,
      version: this.config.mcp.serverVersion,
      environment: this.config.service.environment,
      protocolTransport: 'streamable-http',
      sessionMode: this.config.mcp.sessionMode,
      authMode: this.config.hubspot.auth.mode,
      hubspotBaseUrl: this.config.hubspot.baseUrl,
      toolCount: tools.length,
      tools,
      uptimeSeconds: Math.round(process.uptime()),
    });
  }
}
