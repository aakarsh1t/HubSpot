import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppFastifyInstance } from '../../types/http.types.js';
import type { McpTransportManager } from '../mcp-transport.manager.js';
import type { AppConfig } from '../../types/config.types.js';

export interface McpRouteDependencies {
  readonly config: AppConfig;
  readonly transportManager: McpTransportManager;
}

/**
 * The MCP endpoint itself.
 *
 * All three verbs of the Streamable HTTP transport are wired up:
 *   POST   — JSON-RPC requests (initialize, tools/list, tools/call)
 *   GET    — server-initiated notification stream (SSE)
 *   DELETE — explicit session termination
 *
 * Copilot Studio only issues POST, but GET and DELETE are part of the
 * transport specification and other clients (MCP Inspector, Claude Desktop,
 * VS Code) rely on them.
 */
export function registerMcpRoutes(app: AppFastifyInstance, deps: McpRouteDependencies): void {
  const { config, transportManager } = deps;
  const path = config.mcp.endpointPath;

  const handler = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Hand the socket to the MCP transport: it writes status, headers, and
    // body itself. Without `hijack()` Fastify would also try to respond and
    // corrupt the stream with a double write.
    reply.hijack();

    try {
      await transportManager.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      request.log.error(
        {
          requestId: request.ctx?.requestId,
          err: error,
          method: request.method,
          path,
        },
        'MCP transport failed to handle the request.'
      );

      // The transport may already have written headers; only respond if not.
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error.' },
            id: null,
          })
        );
      } else {
        reply.raw.end();
      }
    }
  };

  app.post(path, handler);
  app.get(path, handler);
  app.delete(path, handler);
}
