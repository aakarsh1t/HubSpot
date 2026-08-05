import { describe, expect, it, vi } from 'vitest';
import { OAuthTokenProvider } from '../auth/oauth-token.provider.js';
import { PrivateAppTokenProvider } from '../auth/private-app-token.provider.js';
import { InMemoryTokenStore } from '../auth/token-store.js';
import { createTokenProvider } from '../auth/token-provider.factory.js';
import type { HubSpotOAuthService } from '../auth/oauth.service.js';
import { fingerprintSecret } from '../utils/redaction.js';
import type { HubSpotOAuthAuthConfig } from '../types/config.types.js';
import type { OAuthTokenResponse } from '../types/auth.types.js';
import { testLogger } from './helpers/fixtures.js';

const oauthConfig: HubSpotOAuthAuthConfig = {
  mode: 'oauth',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-token-1',
  redirectUri: 'https://example.com/callback',
  scopes: ['oauth', 'crm.objects.contacts.read'],
  refreshMarginSeconds: 300,
};

/** Counts refreshes so single-flight behaviour can be asserted. */
function fakeOAuthService(
  response: Partial<OAuthTokenResponse> = {},
  delayMs = 0
): { service: HubSpotOAuthService; calls: () => number } {
  let calls = 0;

  const service = {
    refreshAccessToken: async (refreshToken: string): Promise<OAuthTokenResponse> => {
      calls += 1;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return {
        accessToken: `access-token-${calls}`,
        refreshToken,
        expiresIn: 1_800,
        tokenType: 'bearer',
        ...response,
      };
    },
  } as unknown as HubSpotOAuthService;

  return { service, calls: () => calls };
}

describe('PrivateAppTokenProvider', () => {
  it('returns a non-expiring token without any network call', async () => {
    const provider = new PrivateAppTokenProvider({
      mode: 'private_app',
      accessToken: 'pat-na1-secret',
    });

    const token = await provider.getAccessToken();

    expect(token.value).toBe('pat-na1-secret');
    expect(token.expiresAt).toBeNull();
    expect(provider.mode).toBe('private_app');
  });

  it('describes itself without revealing the token', async () => {
    const provider = new PrivateAppTokenProvider({
      mode: 'private_app',
      accessToken: 'pat-na1-abcdefghijklmnop',
    });

    const descriptor = await provider.describe();

    expect(descriptor.tokenFingerprint).not.toContain('abcdefghijkl');
    expect(descriptor.tokenFingerprint).toContain('mnop');
    expect(descriptor.expiresAt).toBeNull();
  });
});

describe('OAuthTokenProvider', () => {
  it('fetches a token on first use and caches it', async () => {
    const { service, calls } = fakeOAuthService();
    const provider = new OAuthTokenProvider({
      config: oauthConfig,
      oauthService: service,
      tokenStore: new InMemoryTokenStore(),
      logger: testLogger(),
    });

    const first = await provider.getAccessToken();
    const second = await provider.getAccessToken();

    expect(first.value).toBe('access-token-1');
    expect(second.value).toBe('access-token-1');
    expect(calls()).toBe(1);
  });

  it('collapses concurrent refreshes into a single network call', async () => {
    const { service, calls } = fakeOAuthService({}, 25);
    const provider = new OAuthTokenProvider({
      config: oauthConfig,
      oauthService: service,
      tokenStore: new InMemoryTokenStore(),
      logger: testLogger(),
    });

    const tokens = await Promise.all(Array.from({ length: 20 }, () => provider.getAccessToken()));

    // Without single-flight this is 20 refreshes: wasted quota, likely 429s,
    // and a rotation race if HubSpot returns a new refresh token.
    expect(calls()).toBe(1);
    expect(new Set(tokens.map((token) => token.value)).size).toBe(1);
  });

  it('refreshes early, before the token actually expires', async () => {
    let now = 1_000_000;
    const { service, calls } = fakeOAuthService({ expiresIn: 400 });
    const provider = new OAuthTokenProvider({
      config: oauthConfig,
      oauthService: service,
      tokenStore: new InMemoryTokenStore(),
      logger: testLogger(),
      now: () => now,
    });

    await provider.getAccessToken();
    expect(calls()).toBe(1);

    // 150s in: 250s of life left, which is under the 300s margin, so the
    // provider must renew rather than hand out a token that may die in flight.
    now += 150_000;
    await provider.getAccessToken();
    expect(calls()).toBe(2);
  });

  it('keeps using a token that still has more life than the margin', async () => {
    let now = 1_000_000;
    const { service, calls } = fakeOAuthService({ expiresIn: 1_800 });
    const provider = new OAuthTokenProvider({
      config: oauthConfig,
      oauthService: service,
      tokenStore: new InMemoryTokenStore(),
      logger: testLogger(),
      now: () => now,
    });

    await provider.getAccessToken();
    now += 60_000;
    await provider.getAccessToken();

    expect(calls()).toBe(1);
  });

  it('re-fetches after invalidation', async () => {
    const { service, calls } = fakeOAuthService();
    const provider = new OAuthTokenProvider({
      config: oauthConfig,
      oauthService: service,
      tokenStore: new InMemoryTokenStore(),
      logger: testLogger(),
    });

    await provider.getAccessToken();
    await provider.invalidate();
    const token = await provider.getAccessToken();

    expect(calls()).toBe(2);
    expect(token.value).toBe('access-token-2');
  });

  it('adopts a rotated refresh token for subsequent refreshes', async () => {
    const seen: string[] = [];
    let call = 0;

    const service = {
      refreshAccessToken: (refreshToken: string): Promise<OAuthTokenResponse> => {
        seen.push(refreshToken);
        call += 1;
        return Promise.resolve({
          accessToken: `access-${call}`,
          refreshToken: `rotated-${call}`,
          expiresIn: 1_800,
          tokenType: 'bearer',
        });
      },
    } as unknown as HubSpotOAuthService;

    const provider = new OAuthTokenProvider({
      config: oauthConfig,
      oauthService: service,
      tokenStore: new InMemoryTokenStore(),
      logger: testLogger(),
    });

    await provider.getAccessToken();
    await provider.invalidate();
    await provider.getAccessToken();

    expect(seen).toEqual(['refresh-token-1', 'rotated-1']);
  });

  it('propagates a refresh failure rather than serving a stale token', async () => {
    const service = {
      refreshAccessToken: (): Promise<OAuthTokenResponse> =>
        Promise.reject(new Error('refresh token revoked')),
    } as unknown as HubSpotOAuthService;

    const provider = new OAuthTokenProvider({
      config: oauthConfig,
      oauthService: service,
      tokenStore: new InMemoryTokenStore(),
      logger: testLogger(),
    });

    await expect(provider.getAccessToken()).rejects.toThrow('refresh token revoked');
  });

  it('clears the in-flight promise after a failure so the next call retries', async () => {
    let attempt = 0;
    const service = {
      refreshAccessToken: (): Promise<OAuthTokenResponse> => {
        attempt += 1;
        if (attempt === 1) {
          return Promise.reject(new Error('transient'));
        }
        return Promise.resolve({
          accessToken: 'recovered',
          refreshToken: 'refresh-token-1',
          expiresIn: 1_800,
          tokenType: 'bearer',
        });
      },
    } as unknown as HubSpotOAuthService;

    const provider = new OAuthTokenProvider({
      config: oauthConfig,
      oauthService: service,
      tokenStore: new InMemoryTokenStore(),
      logger: testLogger(),
    });

    await expect(provider.getAccessToken()).rejects.toThrow('transient');
    // A failed refresh must not poison the provider permanently.
    await expect(provider.getAccessToken()).resolves.toMatchObject({ value: 'recovered' });
  });
});

describe('createTokenProvider', () => {
  it('selects the private app strategy', () => {
    const provider = createTokenProvider({
      hubspot: {
        baseUrl: 'https://api.hubapi.com',
        requestTimeoutMs: 5_000,
        auth: { mode: 'private_app', accessToken: 'pat-na1-x' },
      },
      logger: testLogger(),
    });

    expect(provider).toBeInstanceOf(PrivateAppTokenProvider);
    expect(provider.mode).toBe('private_app');
  });

  it('selects the oauth strategy', () => {
    const provider = createTokenProvider({
      hubspot: {
        baseUrl: 'https://api.hubapi.com',
        requestTimeoutMs: 5_000,
        auth: oauthConfig,
      },
      logger: testLogger(),
    });

    expect(provider).toBeInstanceOf(OAuthTokenProvider);
    expect(provider.mode).toBe('oauth');
  });
});

describe('fingerprintSecret', () => {
  it('never returns the full secret', () => {
    const secret = 'pat-na1-0123456789abcdef';
    const fingerprint = fingerprintSecret(secret);

    expect(fingerprint).not.toBe(secret);
    expect(fingerprint).not.toContain('0123456789ab');
    expect(fingerprint).toContain('cdef');
  });

  it('keeps the HubSpot region prefix, which is useful and not secret', () => {
    expect(fingerprintSecret('pat-na1-0123456789abcdef')).toMatch(/^pat-na1-/);
  });

  it('handles absent and very short values without leaking', () => {
    expect(fingerprintSecret(null)).toBe('<absent>');
    expect(fingerprintSecret(undefined)).toBe('<absent>');
    expect(fingerprintSecret('')).toBe('<absent>');
    expect(fingerprintSecret('abc')).toBe('****');
  });
});

describe('InMemoryTokenStore', () => {
  it('stores, retrieves, and deletes tokens', async () => {
    const store = new InMemoryTokenStore();
    const token = { value: 'v', mode: 'oauth' as const, expiresAt: null, scopes: [] };

    expect(await store.get('k')).toBeNull();

    await store.set('k', token);
    expect(await store.get('k')).toEqual(token);

    await store.delete('k');
    expect(await store.get('k')).toBeNull();
  });
});

describe('token provider factory logging', () => {
  it('does not log the raw credential', () => {
    const logger = testLogger();
    const spy = vi.spyOn(logger, 'info');

    createTokenProvider({
      hubspot: {
        baseUrl: 'https://api.hubapi.com',
        requestTimeoutMs: 5_000,
        auth: { mode: 'private_app', accessToken: 'pat-na1-supersecretvalue' },
      },
      logger,
    });

    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain('supersecretvalue');
  });
});
