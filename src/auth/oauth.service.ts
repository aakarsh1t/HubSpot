import { Client } from '@hubspot/api-client';
import type { Logger } from 'pino';
import { mapHubSpotThrown } from '../clients/hubspot-error.mapper.js';
import { AuthenticationError } from '../utils/errors.js';
import type { AccessTokenMetadata, OAuthTokenResponse } from '../types/auth.types.js';
import type { HubSpotOAuthAuthConfig } from '../types/config.types.js';

/**
 * Thin, testable wrapper over HubSpot's OAuth endpoints.
 *
 * Isolating the SDK here means the token provider — which owns the genuinely
 * tricky concurrency logic — can be unit-tested against a two-method fake
 * instead of an HTTP mock.
 */
export class HubSpotOAuthService {
  private readonly client: Client;
  private readonly config: HubSpotOAuthAuthConfig;
  private readonly logger: Logger;

  constructor(config: HubSpotOAuthAuthConfig, baseUrl: string, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: 'hubspot-oauth' });
    // No access token: the OAuth endpoints authenticate with client
    // credentials in the request body, not a bearer token.
    this.client = new Client({ basePath: baseUrl });
  }

  /**
   * Exchanges a refresh token for a fresh access token.
   *
   * HubSpot may rotate the refresh token in the response, so callers must
   * persist `refreshToken` from the result rather than assuming the original
   * stays valid indefinitely.
   */
  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenResponse> {
    try {
      const response = await this.client.oauth.tokensApi.create(
        'refresh_token',
        undefined,
        this.config.redirectUri ?? undefined,
        this.config.clientId,
        this.config.clientSecret,
        refreshToken
      );

      this.logger.debug({ expiresIn: response.expiresIn }, 'Refreshed HubSpot access token.');

      return {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        expiresIn: response.expiresIn,
        tokenType: response.tokenType,
      };
    } catch (error) {
      const mapped = mapHubSpotThrown(error);
      this.logger.error(
        { errorCode: mapped.code, errorMessage: mapped.message },
        'Failed to refresh HubSpot access token.'
      );

      // A rejected refresh token is terminal: it has been revoked, the app was
      // uninstalled, or the client secret rotated. Surfacing it as an auth
      // error stops the retry middleware from hammering HubSpot.
      if (mapped.httpStatus === 400 || mapped.httpStatus === 401) {
        throw new AuthenticationError(
          'HubSpot refused the refresh token. It may have been revoked or the app uninstalled; re-authorize the integration.',
          { hubspotStatus: mapped.httpStatus }
        );
      }

      throw mapped;
    }
  }

  /** Exchanges an authorization code for tokens during initial installation. */
  async exchangeAuthorizationCode(code: string, redirectUri: string): Promise<OAuthTokenResponse> {
    try {
      const response = await this.client.oauth.tokensApi.create(
        'authorization_code',
        code,
        redirectUri,
        this.config.clientId,
        this.config.clientSecret,
        undefined
      );

      return {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        expiresIn: response.expiresIn,
        tokenType: response.tokenType,
      };
    } catch (error) {
      throw mapHubSpotThrown(error);
    }
  }

  /**
   * Introspects an access token: portal id, granted scopes, remaining life.
   * Used by the connection-test tool to prove the credential really works.
   */
  async getTokenMetadata(accessToken: string): Promise<AccessTokenMetadata> {
    try {
      const info = await this.client.oauth.accessTokensApi.get(accessToken);

      return {
        hubId: info.hubId,
        userId: info.userId,
        appId: info.appId,
        scopes: info.scopes,
        tokenType: info.tokenType,
        expiresIn: info.expiresIn,
        user: info.user ?? null,
        hubDomain: info.hubDomain ?? null,
      };
    } catch (error) {
      throw mapHubSpotThrown(error);
    }
  }

  /**
   * Builds the consent URL an administrator visits to install the app.
   * Exposed so the OAuth bootstrap can be scripted rather than hand-assembled.
   */
  buildAuthorizationUrl(state?: string): string {
    if (this.config.redirectUri === null) {
      throw new AuthenticationError(
        'HUBSPOT_REDIRECT_URI must be configured to build an authorization URL.'
      );
    }

    return this.client.oauth.getAuthorizationUrl(
      this.config.clientId,
      this.config.redirectUri,
      this.config.scopes.join(' '),
      undefined,
      state
    );
  }
}
