import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { ToolRegistry } from '../tools/tool.registry.js';
import type { AppConfig } from '../types/config.types.js';

export interface McpServerDependencies {
  readonly config: AppConfig;
  readonly toolRegistry: ToolRegistry;
  readonly logger: Logger;
}

/**
 * Guidance handed to the client during `initialize`.
 *
 * Copilot Studio's orchestrator reads this alongside each tool description
 * when deciding what to call, so it is written as instructions to a model —
 * concise, concrete, and explicit about ordering — rather than as prose about
 * the implementation.
 */
const SERVER_INSTRUCTIONS = `This server exposes HubSpot CRM capabilities over the Model Context Protocol.

Guidance:
- Call "hubspot_test_connection" first when a HubSpot request fails or when you are unsure the integration is configured. It reports the exact problem and its remediation.
- Use "hubspot_ping" for a fast availability check when you only need to know whether HubSpot is responding.
- Use "mcp_server_info" to discover which tools are available and which environment you are connected to.

All tools are read-only and safe to retry. Errors are returned as structured results containing a machine-readable code and a requestId; quote the requestId when escalating a failure to a human.`;

/**
 * Constructs the MCP server and binds the tool catalogue to it.
 *
 * Kept free of any transport concern: this same server object is driven by
 * Streamable HTTP today and could be driven by stdio in a CLI harness without
 * modification. In stateless mode one of these is built per request, so
 * construction is intentionally cheap — no I/O, no network, no scanning.
 */
export function createMcpServer(deps: McpServerDependencies): McpServer {
  const { config, toolRegistry, logger } = deps;

  const server = new McpServer(
    {
      name: config.mcp.serverName,
      version: config.mcp.serverVersion,
      title: 'HubSpot MCP Server',
    },
    {
      capabilities: {
        // Only `tools` is advertised. Declaring resources or prompts we do not
        // implement would make clients probe endpoints that return errors.
        tools: { listChanged: false },
        logging: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  toolRegistry.bindTo(server);

  logger.debug(
    { serverName: config.mcp.serverName, toolCount: toolRegistry.size },
    'MCP server instance created.'
  );

  return server;
}
