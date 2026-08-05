import { fingerprintSecret } from '../utils/redaction.js';
import type { AccessToken, AuthDescriptor, HubSpotTokenProvider } from '../types/auth.types.js';
import type { HubSpotPrivateAppAuthConfig } from '../types/config.types.js';

/**
 * Private App Token strategy.
 *
 * HubSpot private app tokens are long-lived and do not expire, so this
 * provider is deliberately trivial: no refresh, no network call, no cache
 * invalidation semantics. The value is not in the logic but in the fact that
 * it satisfies the same `HubSpotTokenProvider` interface as OAuth — the
 * HubSpot client cannot tell which one it was given.
 *
 * Use this mode for a server-to-server integration against a single HubSpot
 * portal, which is the normal shape for a Copilot Studio backend.
 */
export class PrivateAppTokenProvider implements HubSpotTokenProvider {
  readonly mode = 'private_app' as const;

  private readonly token: AccessToken;

  constructor(config: HubSpotPrivateAppAuthConfig) {
    this.token = {
      value: config.accessToken,
      mode: 'private_app',
      expiresAt: null,
      scopes: [],
    };
  }

  getAccessToken(): Promise<AccessToken> {
    return Promise.resolve(this.token);
  }

  /**
   * No-op. There is nothing to invalidate — if HubSpot rejects a private app
   * token, re-fetching would return the identical token, so failing fast is
   * the correct behaviour and the caller surfaces an actionable error instead
   * of retrying forever.
   */
  invalidate(): Promise<void> {
    return Promise.resolve();
  }

  describe(): Promise<AuthDescriptor> {
    return Promise.resolve({
      mode: this.mode,
      expiresAt: null,
      scopeCount: this.token.scopes.length,
      tokenFingerprint: fingerprintSecret(this.token.value),
    });
  }
}
