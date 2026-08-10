import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContainer } from '../container/composition-root.js';
import { createHttpServer, type HttpServer } from '../server/http.server.js';
import type { Container } from '../container/container.js';
import type { AppConfig } from '../types/config.types.js';
import { testConfig, testLogger } from './helpers/fixtures.js';

/**
 * Integration tests over the real Fastify instance via `app.inject()`.
 *
 * These exercise the actual middleware chain — correlation, security headers,
 * API key auth, error handling — and the real MCP transport. Only the outbound
 * HubSpot network call is faked.
 */

const API_KEY = 'k'.repeat(48);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function startServer(configOverrides: Partial<AppConfig> = {}): Promise<{
  server: HttpServer;
  container: Container;
}> {
  const config = testConfig(configOverrides);
  const container = buildContainer(config, { logger: testLogger() });
  const server = await createHttpServer(container);
  return { server, container };
}

async function stopServer(server: HttpServer, container: Container): Promise<void> {
  await server.app.close();
  await server.transportManager.close();
  await container.dispose();
}

describe('REST surface', () => {
  let server: HttpServer;
  let container: Container;

  beforeAll(async () => {
    ({ server, container } = await startServer());
  });

  afterAll(async () => {
    await stopServer(server, container);
  });

  it('serves liveness without authentication', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'hubspot-mcp-server' });
  });

  it('reports readiness with resilience state', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ready',
      dependencies: { hubspot: { circuitBreaker: { state: 'closed' } } },
      // Derived from the registry rather than hardcoded, so adding a future
      // CRM module does not break an unrelated readiness test.
      mcp: { transport: 'streamable-http', toolCount: container.toolRegistry.size },
    });
  });

  it('returns 503 from readiness once draining', async () => {
    server.setAcceptingTraffic(false);
    const response = await server.app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'shutting_down' });

    server.setAcceptingTraffic(true);
  });

  it('echoes a correlation id back to the caller', async () => {
    const response = await server.app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'trace-abc-123' },
    });

    expect(response.headers['x-request-id']).toBe('trace-abc-123');
  });

  it('rejects a malformed correlation id and issues its own', async () => {
    const response = await server.app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'bad id with spaces\nand-newline' },
    });

    expect(response.headers['x-request-id']).not.toContain('newline');
  });

  it('sets security headers', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-frame-options']).toBeDefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('returns RFC 9457 problem details for an unknown route', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(response.json()).toHaveProperty('requestId');
  });

  it('describes itself at the root', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/' });
    expect(response.json()).toMatchObject({ transport: 'streamable-http' });
  });
});

describe('HubSpot ping endpoints', () => {
  let server: HttpServer;
  let container: Container;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    ({ server, container } = await startServer());
  });

  afterEach(async () => {
    await stopServer(server, container);
    vi.unstubAllGlobals();
  });

  it('returns 200 and the portal id when HubSpot answers', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { portalId: 987654, accountType: 'STANDARD' }));

    const response = await server.app.inject({ method: 'GET', url: '/ping/hubspot' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, portalId: 987654 });
  });

  it('returns 503 with actionable remediation when credentials are rejected', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'bad credentials' }));

    const response = await server.app.inject({ method: 'GET', url: '/ping/hubspot/details' });

    expect(response.statusCode).toBe(503);
    const body = response.json<{ status: string; message: string }>();
    expect(body.status).toBe('unauthorized');
    // The message must tell an operator what to do, not merely what broke.
    expect(body.message).toMatch(/HUBSPOT_PRIVATE_APP_TOKEN|revoked/i);
  });
});

describe('API key authentication', () => {
  let server: HttpServer;
  let container: Container;

  beforeAll(async () => {
    ({ server, container } = await startServer({
      security: { apiKeyEnabled: true, apiKeyHeader: 'x-api-key', apiKey: API_KEY },
    }));
  });

  afterAll(async () => {
    await stopServer(server, container);
  });

  it('leaves health probes reachable without a key', async () => {
    // App Service health probes cannot present credentials.
    expect((await server.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await server.app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
  });

  it('rejects a request with no key', async () => {
    const response = await server.app.inject({ method: 'POST', url: '/mcp', payload: {} });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'AUTHENTICATION_FAILED' });
  });

  it('rejects a request with a wrong key', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'x-api-key': 'x'.repeat(48) },
      payload: {},
    });

    expect(response.statusCode).toBe(401);
  });

  it('accepts the configured key', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'x-api-key': API_KEY,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it('accepts the key via an Authorization bearer header', async () => {
    const response = await server.app.inject({
      method: 'GET',
      url: '/ping/hubspot',
      headers: { authorization: `Bearer ${API_KEY}` },
    });

    // Reaches the handler — the HubSpot call itself may fail, but auth passed.
    expect(response.statusCode).not.toBe(401);
  });
});

describe('MCP Streamable HTTP endpoint', () => {
  let server: HttpServer;
  let container: Container;
  let fetchMock: ReturnType<typeof vi.fn>;

  const mcpHeaders = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };

  beforeEach(async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    ({ server, container } = await startServer());
  });

  afterEach(async () => {
    await stopServer(server, container);
    vi.unstubAllGlobals();
  });

  it('completes the initialize handshake', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders,
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      result: { serverInfo: { name: string }; capabilities: Record<string, unknown> };
    }>();
    expect(body.result.serverInfo.name).toBe('hubspot-mcp-server');
    expect(body.result.capabilities).toHaveProperty('tools');
  });

  it('lists the registered tools with JSON Schema', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders,
      payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    });

    const body = response.json<{
      result: { tools: { name: string; inputSchema: { type: string } }[] };
    }>();
    const names = body.result.tools.map((tool) => tool.name).sort();

    expect(names).toEqual(
      expect.arrayContaining([
        'hubspot_diagnostics',
        'hubspot_get_record',
        'hubspot_search_records',
      ])
    );
    expect(names).toHaveLength(container.toolRegistry.size);
    // Every tool must convert cleanly to a JSON Schema object — this is what
    // Copilot Studio's orchestrator reads, so a conversion failure anywhere in
    // the catalogue makes that tool uncallable.
    for (const tool of body.result.tools) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('exposes the whole CRM surface as one object-type-parameterised catalogue', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders,
      payload: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
    });

    const names = response
      .json<{ result: { tools: { name: string }[] } }>()
      .result.tools.map((tool) => tool.name)
      .sort();

    // Asserted as an exact set, not a subset. The catalogue is the contract an
    // orchestrator reads on every turn, and its *size* is the thing that got
    // fixed here — a subset assertion would let entries creep back in
    // unnoticed, which is precisely the regression this guards.
    expect(names).toEqual(
      [
        'hubspot_batch_records',
        'hubspot_create_engagement',
        'hubspot_create_record',
        'hubspot_delete_record',
        'hubspot_diagnostics',
        'hubspot_get_record',
        'hubspot_get_timeline',
        'hubspot_list_pipelines',
        'hubspot_manage_associations',
        'hubspot_manage_properties',
        'hubspot_merge_records',
        'hubspot_restore_record',
        'hubspot_search_records',
        'hubspot_update_record',
      ].sort()
    );
  });

  it('no longer exposes a separate tool per object type', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders,
      payload: { jsonrpc: '2.0', id: 31, method: 'tools/list', params: {} },
    });

    const names = response
      .json<{ result: { tools: { name: string }[] } }>()
      .result.tools.map((tool) => tool.name);

    // Each of these was one of three names for a single HubSpot endpoint. They
    // are reachable now as `objectType` on the generic tool, and their absence
    // is what keeps the catalogue at 14 entries instead of 80.
    for (const retired of [
      'hubspot_get_contact',
      'hubspot_get_company',
      'hubspot_get_deal',
      'hubspot_create_contact',
      'hubspot_search_companies',
      'hubspot_batch_update_deals',
      'hubspot_create_contact_note',
      'hubspot_move_deal_stage',
      'hubspot_test_connection',
      'mcp_server_info',
    ]) {
      expect(names).not.toContain(retired);
    }
  });

  it('keeps the catalogue small enough for an orchestrator to rank cheaply', () => {
    // Every tool's name, description, and full JSON Schema is re-sent to the
    // agent on every request and ranked before it can act, so catalogue size is
    // a direct, per-turn latency cost. The ceiling is deliberately well above
    // the current 14 — it is a regression guard, not a target.
    expect(container.toolRegistry.size).toBeLessThanOrEqual(20);
  });

  it('does not yet expose a Tickets object module', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders,
      payload: { jsonrpc: '2.0', id: 32, method: 'tools/list', params: {} },
    });

    const names = response
      .json<{ result: { tools: { name: string }[] } }>()
      .result.tools.map((tool) => tool.name);

    // Guards the remaining scope: tickets are not a value of `objectType` on
    // the record tools yet. They are already reachable as an *associable* type
    // (hubspot_manage_associations with toObjectType "tickets") and as a
    // pipeline object type, neither of which puts a ticket noun in a tool name.
    expect(names.filter((name) => /ticket/i.test(name))).toEqual([]);
  });

  it('executes a HubSpot-backed tool call against a faked upstream', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { portalId: 424242, accountType: 'STANDARD', uiDomain: 'app.hubspot.com' })
    );

    const response = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders,
      payload: {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'hubspot_diagnostics', arguments: {} },
      },
    });

    const body = response.json<{
      result: {
        isError?: boolean;
        structuredContent: {
          status: string;
          portalId: number;
          server: { toolCount: number; sessionMode: string };
        };
      };
    }>();

    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent.status).toBe('connected');
    expect(body.result.structuredContent.portalId).toBe(424242);
    // Server self-description now rides along with the connectivity check
    // rather than living in a second tool the orchestrator has to choose.
    expect(body.result.structuredContent.server.toolCount).toBe(container.toolRegistry.size);
  });

  it('reports an upstream failure as a successful call with a failed status', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'bad credentials' }));

    const response = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders,
      payload: {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'hubspot_diagnostics', arguments: {} },
      },
    });

    const body = response.json<{
      result: { isError?: boolean; structuredContent: { status: string } };
    }>();

    // A diagnostic tool must not fail when the thing it diagnoses is broken.
    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent.status).toBe('unauthorized');
  });

  it('honours the includeAccountDetails argument', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { portalId: 424242, accountType: 'STANDARD', uiDomain: 'app.hubspot.com' })
    );

    const response = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders,
      payload: {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'hubspot_diagnostics', arguments: { includeAccountDetails: false } },
      },
    });

    const body = response.json<{
      result: { structuredContent: { portalId: number; accountType: string | null } };
    }>();

    expect(body.result.structuredContent.portalId).toBe(424242);
    expect(body.result.structuredContent.accountType).toBeNull();
  });

  it('returns a JSON-RPC error for an unknown tool', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders,
      payload: {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'not_a_tool', arguments: {} },
      },
    });

    const body = response.json<{ error?: { code: number }; result?: { isError?: boolean } }>();
    expect(body.error ?? body.result?.isError).toBeTruthy();
  });

  it('answers with JSON rather than SSE, as Copilot Studio connectors expect', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders,
      payload: { jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} },
    });

    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-type']).not.toContain('text/event-stream');
  });

  it('issues no session id in stateless mode', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders,
      payload: {
        jsonrpc: '2.0',
        id: 10,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      },
    });

    // No session id means any instance can serve any request — the property
    // that makes App Service scale-out safe without ARR affinity.
    expect(response.headers['mcp-session-id']).toBeUndefined();
  });
});

describe('MCP stateful session mode', () => {
  let server: HttpServer;
  let container: Container;

  beforeEach(async () => {
    ({ server, container } = await startServer({
      mcp: { ...testConfig().mcp, sessionMode: 'stateful' },
    }));
  });

  afterEach(async () => {
    await stopServer(server, container);
  });

  it('issues a session id on initialize and accepts it on follow-up calls', async () => {
    const init = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      },
    });

    const sessionId = init.headers['mcp-session-id'] as string | undefined;
    expect(sessionId).toBeTruthy();
    expect(server.transportManager.sessionCount).toBe(1);

    const list = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId!,
      },
      payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    });

    expect(list.statusCode).toBe(200);
    expect(list.json<{ result: { tools: unknown[] } }>().result.tools).toHaveLength(
      container.toolRegistry.size
    );
  });

  it('closes sessions on shutdown', async () => {
    await server.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      },
    });

    expect(server.transportManager.sessionCount).toBe(1);
    await server.transportManager.close();
    expect(server.transportManager.sessionCount).toBe(0);
  });
});
