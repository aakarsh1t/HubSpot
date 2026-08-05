import type { Logger } from 'pino';
import { HubSpotOAuthService } from './oauth.service.js';
import { OAuthTokenProvider } from './oauth-token.provider.js';
import { PrivateAppTokenProvider } from './private-app-token.provider.js';
import { InMemoryTokenStore } from './token-store.js';
import { fingerprintSecret } from '../utils/redaction.js';
import type { HubSpotTokenProvider, TokenStore } from '../types/auth.types.js';
import type { HubSpotConfig } from '../types/config.types.js';

export interface TokenProviderDependencies {
  readonly hubspot: HubSpotConfig;
  readonly logger: Logger;
  readonly tokenStore?: TokenStore;
}

/**
 * Selects the credential strategy from validated configuration.
 *
 * This is the *only* place in the codebase that branches on auth mode. The
 * exhaustive switch means adding a third strategy later (client credentials,
 * managed identity) is a compile error everywhere it must be handled, rather
 * than a silent fallthrough.
 */
export function createTokenProvider(deps: TokenProviderDependencies): HubSpotTokenProvider {
  const { hubspot, logger } = deps;
  const auth = hubspot.auth;

  switch (auth.mode) {
    case 'private_app': {
      logger.info(
        { authMode: auth.mode, tokenFingerprint: fingerprintSecret(auth.accessToken) },
        'Using HubSpot private app token authentication.'
      );
      return new PrivateAppTokenProvider(auth);
    }

    case 'oauth': {
      logger.info(
        {
          authMode: auth.mode,
          clientId: fingerprintSecret(auth.clientId),
          scopeCount: auth.scopes.length,
          refreshMarginSeconds: auth.refreshMarginSeconds,
        },
        'Using HubSpot OAuth 2.0 authentication.'
      );

      return new OAuthTokenProvider({
        config: auth,
        oauthService: new HubSpotOAuthService(auth, hubspot.baseUrl, logger),
        tokenStore: deps.tokenStore ?? new InMemoryTokenStore(),
        logger,
      });
    }
  }
}
