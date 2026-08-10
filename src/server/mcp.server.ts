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
const SERVER_INSTRUCTIONS = `This server exposes full administrative HubSpot CRM control over the Model Context Protocol.

Most tools take an "objectType" parameter — "contacts", "companies", or "deals" — instead of there being a separate tool per object type. Pick the tool by the ACTION you want, then set objectType. There is no hubspot_get_contact; it is hubspot_get_record with objectType "contacts".

Guidance:
- Identity known (an ID or an email) -> hubspot_get_record. Searching by criteria, or listing -> hubspot_search_records.
- Acting on more than a couple of records -> hubspot_batch_records, not a loop of single-record calls. One round trip instead of N.
- "Property does not exist" or an unfamiliar field -> hubspot_manage_properties with action "list" to discover the portal's real internal property names.
- Moving a deal -> hubspot_list_pipelines first for valid stage IDs, then hubspot_update_record. Set "pipeline" alongside "dealstage" when the target stage is in a different pipeline.
- Anything failing, or unsure the integration is configured -> hubspot_diagnostics. It reports the exact problem and its remediation rather than repeating the failure.

These tools WRITE and DELETE real CRM data. Destructive operations - permanent deletion, merges, bulk archive, and deleting a property definition - each require an explicit confirmation field, and every one of them is irreversible through this API. Confirm intent with the user before setting a confirmation flag; do not set one to work around a validation error.

Errors are returned as structured results containing a machine-readable code, whether the failure is retryable, and a requestId; quote the requestId when escalating to a human.`;

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
