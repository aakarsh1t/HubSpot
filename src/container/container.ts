import type { Logger } from 'pino';
import type { HubSpotOAuthService } from '../auth/oauth.service.js';
import type { HubSpotClient } from '../clients/hubspot.client.js';
import type { CircuitBreaker } from '../middleware/circuit-breaker.js';
import type { TokenBucketRateLimiter } from '../middleware/rate-limiter.js';
import type { AssociationsService } from '../services/associations.service.js';
import type { CrmService } from '../services/crm.service.js';
import type { EngagementsService } from '../services/engagements.service.js';
import type { HubSpotHealthService } from '../services/hubspot-health.service.js';
import type { PropertiesService } from '../services/properties.service.js';
import type { ToolRegistry } from '../tools/tool.registry.js';
import type { HubSpotTokenProvider, TokenStore } from '../types/auth.types.js';
import type { AppConfig } from '../types/config.types.js';

/**
 * The application's dependency graph, resolved once at startup.
 *
 * This is deliberately a plain, fully-typed interface rather than a
 * reflection-based IoC container. A decorator/`reflect-metadata` container
 * would move wiring errors from compile time to run time, add a startup
 * metadata scan, and obscure the graph — none of which we want in a service
 * whose whole job is to start fast and fail loudly.
 *
 * What we keep from DI is the part that actually matters: nothing constructs
 * its own collaborators, every dependency arrives through a constructor, and
 * every seam is an interface. That is what makes the HubSpot client testable
 * against a fake token provider and the tools testable with no network at all.
 */
export interface Container {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly tokenStore: TokenStore;
  readonly tokenProvider: HubSpotTokenProvider;
  readonly oauthService: HubSpotOAuthService | null;
  readonly rateLimiter: TokenBucketRateLimiter;
  readonly circuitBreaker: CircuitBreaker;
  readonly hubspotClient: HubSpotClient;
  readonly healthService: HubSpotHealthService;
  /** Routes record operations to the right object type at call time. */
  readonly crmService: CrmService;
  readonly associationsService: AssociationsService;
  readonly engagementsService: EngagementsService;
  readonly propertiesService: PropertiesService;
  readonly toolRegistry: ToolRegistry;
  /** Releases held resources. Idempotent. */
  dispose(): Promise<void>;
}
