import type { Logger } from 'pino';
import type { HubSpotOAuthService } from './oauth.service.js';
import { fingerprintSecret } from '../utils/redaction.js';
import type {
  AccessToken,
  AuthDescriptor,
  HubSpotTokenProvider,
  TokenStore,
} from '../types/auth.types.js';
import type { HubSpotOAuthAuthConfig } from '../types/config.types.js';

const CACHE_KEY = 'hubspot:oauth:access-token';

export interface OAuthTokenProviderOptions {
  readonly config: HubSpotOAuthAuthConfig;
  readonly oauthService: HubSpotOAuthService;
  readonly tokenStore: TokenStore;
  readonly logger: Logger;
  readonly now?: () => number;
}

/**
 * OAuth 2.0 refresh-token strategy.
 *
 * HubSpot access tokens live ~30 minutes, so this provider's real job is
 * refreshing them safely under concurrency. Two details carry that weight:
 *
 *  - **Single-flight refresh.** A busy server can have dozens of tool calls
 *    in flight when a token expires. Without coordination each one starts its
 *    own refresh, which wastes quota, invites 429s, and — because HubSpot may
 *    rotate the refresh token — risks a lost-update race where one response
 *    invalidates another's refresh token. All concurrent callers here await a
 *    single shared promise.
 *
 *  - **A refresh margin.** Renewing exactly at expiry guarantees a slice of
 *    requests carry a token that dies in flight. Refreshing early
 *    (`refreshMarginSeconds`, default 5 min) removes that class of 401
 *    entirely.
 */
export class OAuthTokenProvider implements HubSpotTokenProvider {
  readonly mode = 'oauth' as const;

  private readonly config: HubSpotOAuthAuthConfig;
  private readonly oauthService: HubSpotOAuthService;
  private readonly tokenStore: TokenStore;
  private readonly logger: Logger;
  private readonly now: () => number;

  /** Non-null while a refresh is in progress; every caller awaits this one. */
  private refreshInFlight: Promise<AccessToken> | null = null;
  /** Tracks rotation: HubSpot may return a new refresh token on each refresh. */
  private currentRefreshToken: string;

  constructor(options: OAuthTokenProviderOptions) {
    this.config = options.config;
    this.oauthService = options.oauthService;
    this.tokenStore = options.tokenStore;
    this.logger = options.logger.child({ component: 'oauth-token-provider' });
    this.now = options.now ?? Date.now;
    this.currentRefreshToken = options.config.refreshToken;
  }

  async getAccessToken(): Promise<AccessToken> {
    const cached = await this.tokenStore.get(CACHE_KEY);

    if (cached !== null && this.isUsable(cached)) {
      return cached;
    }

    return this.refreshSingleFlight();
  }

  async invalidate(): Promise<void> {
    this.logger.warn('Invalidating cached HubSpot access token.');
    await this.tokenStore.delete(CACHE_KEY);
  }

  async describe(): Promise<AuthDescriptor> {
    const cached = await this.tokenStore.get(CACHE_KEY);

    return {
      mode: this.mode,
      expiresAt:
        cached?.expiresAt === undefined || cached.expiresAt === null
          ? null
          : new Date(cached.expiresAt).toISOString(),
      scopeCount: cached?.scopes.length ?? this.config.scopes.length,
      tokenFingerprint: fingerprintSecret(cached?.value),
    };
  }

  /**
   * Collapses concurrent refreshes into one network call.
   *
   * The promise is stored *before* it is awaited, so any caller arriving while
   * it is pending joins the same operation instead of starting a second one.
   */
  private refreshSingleFlight(): Promise<AccessToken> {
    if (this.refreshInFlight !== null) {
      this.logger.debug('Joining an in-flight token refresh.');
      return this.refreshInFlight;
    }

    const inFlight = this.performRefresh().finally(() => {
      this.refreshInFlight = null;
    });

    this.refreshInFlight = inFlight;
    return inFlight;
  }

  private async performRefresh(): Promise<AccessToken> {
    const response = await this.oauthService.refreshAccessToken(this.currentRefreshToken);

    if (response.refreshToken !== this.currentRefreshToken) {
      // Rotation is in-memory only. On restart we fall back to the configured
      // HUBSPOT_REFRESH_TOKEN, so operators need to know it changed.
      this.logger.warn(
        'HubSpot returned a rotated refresh token. Update HUBSPOT_REFRESH_TOKEN in your App Service configuration to survive a restart.'
      );
      this.currentRefreshToken = response.refreshToken;
    }

    const token: AccessToken = {
      value: response.accessToken,
      mode: 'oauth',
      expiresAt: this.now() + response.expiresIn * 1000,
      scopes: this.config.scopes,
    };

    await this.tokenStore.set(CACHE_KEY, token);

    this.logger.info(
      {
        expiresInSeconds: response.expiresIn,
        tokenFingerprint: fingerprintSecret(token.value),
      },
      'Obtained a fresh HubSpot access token.'
    );

    return token;
  }

  /** True while the token has more life left than the configured margin. */
  private isUsable(token: AccessToken): boolean {
    if (token.expiresAt === null) {
      return true;
    }

    const marginMs = this.config.refreshMarginSeconds * 1000;
    return this.now() + marginMs < token.expiresAt;
  }
}
