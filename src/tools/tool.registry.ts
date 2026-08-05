import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from 'pino';
import {
  type AppError,
  ConfigurationError,
  ValidationError,
  normalizeError,
} from '../utils/errors.js';
import { runWithContext, withToolContext } from '../utils/request-context.js';
import type {
  AnyToolDefinition,
  ToolDescriptor,
  ToolExecutionContext,
} from '../types/tool.types.js';

/**
 * Owns the catalogue of tools and adapts each one to the MCP wire protocol.
 *
 * This is the seam that keeps `ToolDefinition` free of protocol concerns.
 * Tools return plain objects and throw typed errors; everything MCP-shaped —
 * `content` arrays, `structuredContent`, `isError`, correlation, timing, and
 * error redaction — is applied uniformly here. Adding a CRM tool later means
 * writing business logic, not protocol glue, and it inherits all of this
 * behaviour automatically.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'tool-registry' });
  }

  /**
   * Duplicate names fail loudly at startup rather than silently shadowing.
   * With MCP, a shadowed tool is invisible — the agent simply calls the wrong
   * implementation, and nothing in the logs says so.
   */
  register(tool: AnyToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new ConfigurationError(`Duplicate MCP tool name "${tool.name}".`, {
        toolName: tool.name,
      });
    }

    this.tools.set(tool.name, tool);
    this.logger.debug({ tool: tool.name }, 'Registered MCP tool.');
  }

  registerAll(tools: readonly AnyToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  get(name: string): AnyToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDescriptor[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
    }));
  }

  get size(): number {
    return this.tools.size;
  }

  /** Binds every registered tool onto an `McpServer` instance. */
  bindTo(server: McpServer): void {
    for (const tool of this.tools.values()) {
      this.bindTool(server, tool);
    }

    this.logger.info({ toolCount: this.tools.size }, 'Bound MCP tools to server.');
  }

  private bindTool(server: McpServer, tool: AnyToolDefinition): void {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
        ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
      },
      (args: unknown, extra): Promise<CallToolResult> =>
        this.invoke(tool, args, {
          signal: extra.signal,
          sessionId: extra.sessionId ?? null,
        })
    );
  }

  /**
   * Runs one tool call with correlation, timing, and uniform error handling.
   *
   * Exposed (rather than private) so tests can exercise the full wrapper —
   * validation, error mapping, result shaping — without standing up a
   * transport.
   */
  async invoke(
    tool: AnyToolDefinition,
    rawArgs: unknown,
    options: { readonly signal: AbortSignal; readonly sessionId: string | null }
  ): Promise<CallToolResult> {
    const context = withToolContext(tool.name, options.sessionId);

    return runWithContext(context, async () => {
      const logger = this.logger.child({
        requestId: context.requestId,
        sessionId: context.sessionId,
        tool: tool.name,
      });

      const startedAt = Date.now();
      logger.info('Tool invocation started.');

      try {
        // Re-validated here even though the SDK already checked the input.
        // It costs microseconds, it gives us a typed value rather than
        // `unknown`, and it means a tool invoked directly in a unit test
        // enforces exactly the same contract as one invoked over the wire.
        const input = this.parseInput(tool, rawArgs);

        const executionContext: ToolExecutionContext = {
          requestId: context.requestId,
          sessionId: context.sessionId,
          toolName: tool.name,
          signal: options.signal,
          logger,
        };

        const output = await tool.execute(input, executionContext);
        const durationMs = Date.now() - startedAt;

        logger.info({ durationMs }, 'Tool invocation succeeded.');

        return this.toSuccessResult(tool, output);
      } catch (caught) {
        const error = normalizeError(caught);
        const durationMs = Date.now() - startedAt;

        // 5xx is ours to fix and needs a stack; 4xx is the caller's input.
        if (error.httpStatus >= 500) {
          logger.error(
            { err: error, errorCode: error.code, durationMs },
            'Tool invocation failed.'
          );
        } else {
          logger.warn(
            { errorCode: error.code, errorMessage: error.message, durationMs },
            'Tool invocation rejected.'
          );
        }

        return this.toErrorResult(error, context.requestId);
      }
    });
  }

  private parseInput(tool: AnyToolDefinition, rawArgs: unknown): unknown {
    const result = tool.inputSchema.safeParse(rawArgs ?? {});

    if (!result.success) {
      throw new ValidationError(`Invalid arguments for tool "${tool.name}".`, {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    return result.data;
  }

  private toSuccessResult(tool: AnyToolDefinition, output: unknown): CallToolResult {
    // Text content is what every MCP client can render; `structuredContent` is
    // the machine-readable twin, emitted only when the tool declares an output
    // schema (the SDK validates it against that schema).
    const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);

    return {
      content: [{ type: 'text', text }],
      ...(tool.outputSchema === undefined || output === null || typeof output !== 'object'
        ? {}
        : { structuredContent: output as Record<string, unknown> }),
    };
  }

  /**
   * Returns failures as `isError` results rather than throwing.
   *
   * This is the MCP convention and it matters for agent behaviour: a JSON-RPC
   * error is a protocol fault the model never sees, whereas an `isError`
   * result is handed to the model, which can then explain the problem or try a
   * different approach. The `requestId` gives a human something to grep for.
   */
  private toErrorResult(error: AppError, requestId: string): CallToolResult {
    const payload = {
      error: {
        code: error.code,
        message: error.publicMessage,
        retryable: error.retryable,
        requestId,
        ...(error.expose && error.details !== undefined ? { details: error.details } : {}),
      },
    };

    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    };
  }
}
