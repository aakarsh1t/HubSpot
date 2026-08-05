import type { HubSpotAuthMode } from './config.types.js';

/**
 * An access token plus everything the caller needs to reason about its
 * lifetime. `expiresAt` is null for private app tokens, which do not expire.
 */
export interface AccessToken {
  readonly value: string;
  readonly mode: HubSpotAuthMode;
  /** Epoch milliseconds, or null when the token has no expiry. */
  readonly expiresAt: number | null;
  readonly scopes: readonly string[];
}

/** Non-sensitive description of the active auth strategy, safe to log or return from tools. */
export interface AuthDescriptor {
  readonly mode: HubSpotAuthMode;
  readonly expiresAt: string | null;
  readonly scopeCount: number;
  /** e.g. `pat-na1-****cdef` — enough to identify a credential, never to use it. */
  readonly tokenFingerprint: string;
}

/**
 * The single seam between "how we obtain credentials" and "how we call
 * HubSpot". The client depends only on this interface, which is why swapping
 * private-app auth for OAuth requires no change to any calling code.
 */
export interface HubSpotTokenProvider {
  readonly mode: HubSpotAuthMode;

  /** Returns a valid token, refreshing transparently when required. */
  getAccessToken(): Promise<AccessToken>;

  /**
   * Discards any cached token. Called when HubSpot rejects a token with 401,
   * so the next attempt re-fetches instead of replaying a dead credential.
   *
   * Async because a real token store is out-of-process (Redis, Key Vault);
   * returning a promise keeps the interface honest rather than forcing
   * implementations into fire-and-forget deletes.
   */
  invalidate(): Promise<void>;

  /** Redacted description of the current credential, for diagnostics. */
  describe(): Promise<AuthDescriptor>;
}

/** Persistence seam for OAuth tokens. In-memory by default; swap for Redis/Key Vault. */
export interface TokenStore {
  get(key: string): Promise<AccessToken | null>;
  set(key: string, token: AccessToken): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Shape returned by HubSpot's `POST /oauth/v1/token`. */
export interface OAuthTokenResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly tokenType: string;
}

/** Shape returned by HubSpot's `GET /oauth/v1/access-tokens/{token}`. */
export interface AccessTokenMetadata {
  readonly hubId: number;
  readonly userId: number;
  readonly appId: number;
  readonly scopes: readonly string[];
  readonly tokenType: string;
  readonly expiresIn: number;
  readonly user: string | null;
  readonly hubDomain: string | null;
}
