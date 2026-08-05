import type { AccessToken, TokenStore } from '../types/auth.types.js';

/**
 * Process-local token cache.
 *
 * Adequate for a single App Service plan: each instance refreshes its own
 * token, and HubSpot tolerates concurrent valid access tokens for the same
 * refresh token. If you later scale to many instances and want to minimise
 * refresh calls, implement this same interface over Redis or Azure Key Vault
 * and swap it in the composition root — nothing else changes.
 */
export class InMemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, AccessToken>();

  get(key: string): Promise<AccessToken | null> {
    return Promise.resolve(this.tokens.get(key) ?? null);
  }

  set(key: string, token: AccessToken): Promise<void> {
    this.tokens.set(key, token);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.tokens.delete(key);
    return Promise.resolve();
  }

  /** Test affordance. */
  clear(): void {
    this.tokens.clear();
  }
}
