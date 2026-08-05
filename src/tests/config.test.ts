import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/config.js';
import { ConfigurationError } from '../utils/errors.js';
import { testEnv } from './helpers/fixtures.js';

describe('loadConfig', () => {
  it('applies documented defaults when only required variables are set', () => {
    const config = loadConfig(testEnv());

    expect(config.http.port).toBe(8080);
    expect(config.http.host).toBe('0.0.0.0');
    expect(config.mcp.endpointPath).toBe('/mcp');
    // Stateless is the safe default for App Service scale-out.
    expect(config.mcp.sessionMode).toBe('stateless');
    expect(config.mcp.enableJsonResponse).toBe(true);
    expect(config.hubspot.auth.mode).toBe('private_app');
  });

  it('coerces numeric and boolean environment strings', () => {
    const config = loadConfig(
      testEnv({ PORT: '9001', LOG_PRETTY: 'yes', HTTP_TRUST_PROXY: 'off', RETRY_MAX_ATTEMPTS: '5' })
    );

    expect(config.http.port).toBe(9001);
    expect(config.log.pretty).toBe(true);
    expect(config.http.trustProxy).toBe(false);
    expect(config.retry.maxAttempts).toBe(5);
  });

  it('builds a discriminated private-app auth config', () => {
    const config = loadConfig(testEnv());

    expect(config.hubspot.auth).toEqual({
      mode: 'private_app',
      accessToken: 'fake-hubspot-private-app-token-for-tests',
    });
  });

  it('builds an oauth auth config and parses scopes from either delimiter', () => {
    const config = loadConfig(
      testEnv({
        HUBSPOT_AUTH_MODE: 'oauth',
        HUBSPOT_PRIVATE_APP_TOKEN: '',
        HUBSPOT_CLIENT_ID: 'client-id',
        HUBSPOT_CLIENT_SECRET: 'client-secret',
        HUBSPOT_REFRESH_TOKEN: 'refresh-token',
        HUBSPOT_SCOPES: 'crm.objects.contacts.read, crm.objects.companies.read oauth',
      })
    );

    expect(config.hubspot.auth.mode).toBe('oauth');
    if (config.hubspot.auth.mode !== 'oauth') throw new Error('expected oauth config');
    expect(config.hubspot.auth.scopes).toEqual([
      'crm.objects.contacts.read',
      'crm.objects.companies.read',
      'oauth',
    ]);
  });

  it('rejects private_app mode without a token, naming the variable', () => {
    expect(() => loadConfig(testEnv({ HUBSPOT_PRIVATE_APP_TOKEN: '' }))).toThrow(
      ConfigurationError
    );

    try {
      loadConfig(testEnv({ HUBSPOT_PRIVATE_APP_TOKEN: '' }));
    } catch (error) {
      // The message is read from a log stream during an incident: it must say
      // exactly which variable is wrong.
      expect((error as ConfigurationError).message).toContain('HUBSPOT_PRIVATE_APP_TOKEN');
    }
  });

  it('rejects oauth mode when any credential is missing', () => {
    expect(() =>
      loadConfig(
        testEnv({
          HUBSPOT_AUTH_MODE: 'oauth',
          HUBSPOT_PRIVATE_APP_TOKEN: '',
          HUBSPOT_CLIENT_ID: 'client-id',
        })
      )
    ).toThrow(/HUBSPOT_CLIENT_SECRET[\s\S]*HUBSPOT_REFRESH_TOKEN/);
  });

  it('refuses to start unauthenticated in production', () => {
    expect(() =>
      loadConfig(testEnv({ NODE_ENV: 'production', MCP_AUTH_ENABLED: 'false' }))
    ).toThrow(/MCP_AUTH_ENABLED/);
  });

  it('rejects an API key that is too short to be meaningful', () => {
    expect(() => loadConfig(testEnv({ MCP_API_KEY: 'short-key' }))).toThrow(/at least 32/);
  });

  it('requires an API key whenever inbound auth is enabled', () => {
    expect(() => loadConfig(testEnv({ MCP_API_KEY: '' }))).toThrow(/MCP_API_KEY is required/);
  });

  it('makes an unauthenticated config unrepresentable in the type system', () => {
    const config = loadConfig(testEnv({ NODE_ENV: 'development', MCP_AUTH_ENABLED: 'false' }));

    expect(config.security.apiKeyEnabled).toBe(false);
    // The union has no `apiKey` member when disabled, so a key cannot leak
    // into a config that claims auth is off.
    expect('apiKey' in config.security).toBe(false);
  });

  it('normalises the base URL and endpoint path', () => {
    const config = loadConfig(
      testEnv({ HUBSPOT_BASE_URL: 'https://api.hubapi.com/', MCP_ENDPOINT_PATH: '/mcp/' })
    );

    expect(config.hubspot.baseUrl).toBe('https://api.hubapi.com');
    expect(config.mcp.endpointPath).toBe('/mcp');
  });

  it('rejects an endpoint path that is not absolute', () => {
    expect(() => loadConfig(testEnv({ MCP_ENDPOINT_PATH: 'mcp' }))).toThrow(ConfigurationError);
  });

  it('rejects a retry window whose max delay is below its initial delay', () => {
    expect(() =>
      loadConfig(testEnv({ RETRY_INITIAL_DELAY_MS: '5000', RETRY_MAX_DELAY_MS: '100' }))
    ).toThrow(/RETRY_MAX_DELAY_MS/);
  });

  it('prefers the Azure App Service instance id when present', () => {
    const config = loadConfig(testEnv({ WEBSITE_INSTANCE_ID: 'abcdef0123456789abcdef' }));
    expect(config.service.instanceId).toBe('abcdef012345');
  });
});
