import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../tools/tool.registry.js';
import { AuthenticationError, ConfigurationError, InternalError } from '../utils/errors.js';
import type { AnyToolDefinition, ToolDefinition } from '../types/tool.types.js';
import { testLogger } from './helpers/fixtures.js';

const echoSchema = z.object({ value: z.string() });

function echoTool(overrides: Partial<AnyToolDefinition> = {}): AnyToolDefinition {
  const tool: ToolDefinition<typeof echoSchema, { echoed: string }> = {
    name: 'echo',
    title: 'Echo',
    description: 'Echo the input back.',
    inputSchema: echoSchema,
    execute(input) {
      return Promise.resolve({ echoed: input.value });
    },
  };

  return { ...tool, ...overrides };
}

function failingTool(error: Error): AnyToolDefinition {
  const tool: ToolDefinition<typeof echoSchema, never> = {
    name: 'failing',
    title: 'Failing',
    description: 'Always fails.',
    inputSchema: echoSchema,
    execute() {
      return Promise.reject(error);
    },
  };
  return tool;
}

const signal = new AbortController().signal;

/**
 * Narrows an MCP content block to its text payload.
 *
 * `CallToolResult.content` is a union (text | image | audio | resource), so a
 * bare `.text` access does not type-check. Failing loudly here also means a
 * tool that accidentally returns a non-text block fails the test rather than
 * silently comparing `undefined`.
 */
function textOf(result: { content: { type: string }[] }): string {
  const first = result.content[0];
  if (first?.type !== 'text') {
    throw new Error(`Expected a text content block, received: ${first?.type ?? 'none'}`);
  }
  return (first as { type: 'text'; text: string }).text;
}

describe('ToolRegistry registration', () => {
  it('registers and lists tools', () => {
    const registry = new ToolRegistry(testLogger());
    registry.register(echoTool());

    expect(registry.size).toBe(1);
    expect(registry.list()).toEqual([
      { name: 'echo', title: 'Echo', description: 'Echo the input back.' },
    ]);
    expect(registry.get('echo')).toBeDefined();
    expect(registry.get('missing')).toBeUndefined();
  });

  it('rejects duplicate tool names loudly', () => {
    const registry = new ToolRegistry(testLogger());
    registry.register(echoTool());

    // A silently shadowed tool is invisible: the agent would call the wrong
    // implementation and nothing would say so.
    expect(() => {
      registry.register(echoTool());
    }).toThrow(ConfigurationError);
  });

  it('registers many tools at once', () => {
    const registry = new ToolRegistry(testLogger());
    registry.registerAll([echoTool(), echoTool({ name: 'echo2' })]);
    expect(registry.size).toBe(2);
  });
});

describe('ToolRegistry.invoke', () => {
  it('returns tool output as MCP text content', async () => {
    const registry = new ToolRegistry(testLogger());
    const tool = echoTool();

    const result = await registry.invoke(tool, { value: 'hello' }, { signal, sessionId: null });

    expect(result.isError).toBeUndefined();
    // Compact, not pretty-printed: the only consumer is a model, and
    // indentation is tokens the orchestrator pays for on every tool call.
    expect(result.content[0]).toEqual({
      type: 'text',
      text: '{"echoed":"hello"}',
    });
  });

  it('adds structuredContent only when the tool declares an output schema', async () => {
    const registry = new ToolRegistry(testLogger());

    const withoutSchema = await registry.invoke(
      echoTool(),
      { value: 'x' },
      { signal, sessionId: null }
    );
    expect(withoutSchema.structuredContent).toBeUndefined();

    const withSchema = await registry.invoke(
      echoTool({ outputSchema: z.object({ echoed: z.string() }) }),
      { value: 'x' },
      { signal, sessionId: null }
    );
    expect(withSchema.structuredContent).toEqual({ echoed: 'x' });
  });

  it('rejects invalid arguments without invoking the tool', async () => {
    const registry = new ToolRegistry(testLogger());
    let called = false;

    const tool = echoTool({
      execute() {
        called = true;
        return Promise.resolve({ echoed: '' });
      },
    });

    const result = await registry.invoke(tool, { value: 42 }, { signal, sessionId: null });

    expect(result.isError).toBe(true);
    expect(called).toBe(false);
    expect(textOf(result)).toContain('VALIDATION_FAILED');
  });

  it('returns failures as isError results rather than throwing', async () => {
    const registry = new ToolRegistry(testLogger());

    const result = await registry.invoke(
      failingTool(new AuthenticationError('token rejected')),
      { value: 'x' },
      { signal, sessionId: null }
    );

    // MCP convention: the model sees the error and can react to it, whereas a
    // JSON-RPC error would be invisible to it.
    expect(result.isError).toBe(true);

    const payload = JSON.parse(textOf(result)) as {
      error: { code: string; message: string; retryable: boolean; requestId: string };
    };
    expect(payload.error.code).toBe('AUTHENTICATION_FAILED');
    expect(payload.error.retryable).toBe(false);
    expect(payload.error.requestId).toBeTruthy();
  });

  it('never leaks an internal error message to the caller', async () => {
    const registry = new ToolRegistry(testLogger());

    const result = await registry.invoke(
      failingTool(new InternalError('db password is hunter2')),
      { value: 'x' },
      { signal, sessionId: null }
    );

    expect(textOf(result)).not.toContain('hunter2');
    expect(textOf(result)).toContain('An internal error occurred.');
  });

  it('normalizes an unexpected non-AppError throwable', async () => {
    const registry = new ToolRegistry(testLogger());

    const result = await registry.invoke(
      failingTool(new Error('raw failure')),
      { value: 'x' },
      { signal, sessionId: null }
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('INTERNAL');
  });

  it('supplies a populated execution context to the tool', async () => {
    const registry = new ToolRegistry(testLogger());
    let captured: { requestId: string; sessionId: string | null; toolName: string } | null = null;

    const tool = echoTool({
      execute(_input, context) {
        captured = {
          requestId: context.requestId,
          sessionId: context.sessionId,
          toolName: context.toolName,
        };
        return Promise.resolve({ echoed: 'ok' });
      },
    });

    await registry.invoke(tool, { value: 'x' }, { signal, sessionId: 'session-42' });

    expect(captured).toMatchObject({ sessionId: 'session-42', toolName: 'echo' });
    expect(captured!.requestId).toBeTruthy();
  });

  it('applies schema defaults before the tool runs', async () => {
    const registry = new ToolRegistry(testLogger());
    const schema = z.object({ flag: z.boolean().default(true) });
    let received: unknown;

    const tool: ToolDefinition<typeof schema> = {
      name: 'defaults',
      title: 'Defaults',
      description: 'Checks defaults.',
      inputSchema: schema,
      execute(input) {
        received = input;
        return Promise.resolve({});
      },
    };

    await registry.invoke(tool, {}, { signal, sessionId: null });
    expect(received).toEqual({ flag: true });
  });

  it('treats missing arguments as an empty object', async () => {
    const registry = new ToolRegistry(testLogger());
    const schema = z.object({});
    const tool: ToolDefinition<typeof schema> = {
      name: 'noargs',
      title: 'No Args',
      description: 'Takes nothing.',
      inputSchema: schema,
      execute: () => Promise.resolve({ ok: true }),
    };

    const result = await registry.invoke(tool, undefined, {
      signal,
      sessionId: null,
    });

    expect(result.isError).toBeUndefined();
  });
});
