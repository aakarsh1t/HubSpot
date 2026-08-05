import type { Logger } from 'pino';
import type { z } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/**
 * Everything a tool is allowed to know about the call it is serving.
 *
 * Tools receive this instead of reaching for globals, which is what makes them
 * unit-testable without booting a server.
 */
export interface ToolExecutionContext {
  readonly requestId: string;
  readonly sessionId: string | null;
  readonly toolName: string;
  /** Aborted when the client disconnects or the request times out. */
  readonly signal: AbortSignal;
  /** Child logger pre-bound with requestId + toolName. */
  readonly logger: Logger;
}

/**
 * A tool as the domain sees it: a name, a validated input contract, and an
 * async function returning plain data.
 *
 * Note what is absent — no MCP protocol types, no `content` arrays, no
 * JSON-RPC. The registry adapts this to the wire format, so tools stay pure
 * business logic and the protocol can evolve independently.
 *
 * `execute` is declared with method syntax deliberately: TypeScript's method
 * bivariance is what lets differently-typed tools live in one array.
 */
export interface ToolDefinition<TInput extends z.ZodType = z.ZodType, TOutput = unknown> {
  readonly name: string;
  /** Human-friendly name shown in Copilot Studio's tool picker. */
  readonly title: string;
  /**
   * Drives tool selection by the agent orchestrator. Written for a model to
   * read, not a developer — state what it does and when to use it.
   */
  readonly description: string;
  readonly inputSchema: TInput;
  /** When present, results are also returned as MCP `structuredContent`. */
  readonly outputSchema?: z.ZodType;
  readonly annotations?: ToolAnnotations;

  execute(input: z.output<TInput>, context: ToolExecutionContext): Promise<TOutput>;
}

/** Erased form used for heterogeneous collections of tools. */
export type AnyToolDefinition = ToolDefinition;

/** Non-sensitive tool metadata, surfaced by the health endpoint. */
export interface ToolDescriptor {
  readonly name: string;
  readonly title: string;
  readonly description: string;
}
