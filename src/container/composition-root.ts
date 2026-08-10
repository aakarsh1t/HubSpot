import type { Logger } from 'pino';
import type { Container } from './container.js';
import { HubSpotOAuthService } from '../auth/oauth.service.js';
import { createTokenProvider } from '../auth/token-provider.factory.js';
import { InMemoryTokenStore } from '../auth/token-store.js';
import { HubSpotClient } from '../clients/hubspot.client.js';
import { CircuitBreaker } from '../middleware/circuit-breaker.js';
import { TokenBucketRateLimiter } from '../middleware/rate-limiter.js';
import { AssociationsService } from '../services/associations.service.js';
import { CrmService } from '../services/crm.service.js';
import { EngagementsService } from '../services/engagements.service.js';
import { HubSpotHealthService } from '../services/hubspot-health.service.js';
import { PropertiesService } from '../services/properties.service.js';
import { createTools } from '../tools/index.js';
import { ToolRegistry } from '../tools/tool.registry.js';
import { createLogger } from '../utils/logger.js';
import type { TokenStore } from '../types/auth.types.js';
import type { AppConfig } from '../types/config.types.js';

export interface CompositionOverrides {
  /** Injected by tests to avoid real network calls or noisy output. */
  readonly logger?: Logger;
  readonly tokenStore?: TokenStore;
}

/**
 * Builds the object graph.
 *
 * This is the only function in the codebase that calls `new` on more than one
 * collaborator, and the only one that knows how the pieces fit together.
 * Every other module receives what it needs and stays ignorant of
 * construction — which is precisely what makes the rest of the codebase
 * unit-testable.
 *
 * Construction is eager and ordered by dependency, so a misconfiguration
 * surfaces during startup — before App Service marks the instance healthy and
 * routes traffic to it — rather than on the first customer request.
 */
export function buildContainer(config: AppConfig, overrides: CompositionOverrides = {}): Container {
  const logger = overrides.logger ?? createLogger(config.log, config.service);

  const tokenStore = overrides.tokenStore ?? new InMemoryTokenStore();

  // Retained on the container only for OAuth, where it also backs token
  // introspection and the authorization-URL helper.
  const oauthService =
    config.hubspot.auth.mode === 'oauth'
      ? new HubSpotOAuthService(config.hubspot.auth, config.hubspot.baseUrl, logger)
      : null;

  const tokenProvider = createTokenProvider({
    hubspot: config.hubspot,
    logger,
    tokenStore,
  });

  const rateLimiter = new TokenBucketRateLimiter(config.rateLimit.outbound);

  const circuitBreaker = new CircuitBreaker({
    config: config.circuitBreaker,
    name: 'hubspot-api',
    logger,
  });

  const hubspotClient = new HubSpotClient({
    config: config.hubspot,
    retryConfig: config.retry,
    tokenProvider,
    rateLimiter,
    circuitBreaker,
    logger,
    // Identifies this integration in HubSpot's logs, which is what their
    // support team asks for first when investigating a portal issue.
    userAgent: `${config.service.name}/${config.service.version} (+mcp)`,
  });

  const healthService = new HubSpotHealthService({
    client: hubspotClient,
    tokenProvider,
    logger,
  });

  // CRM services. Each depends only on the HubSpot client, so every one of
  // them is unit-testable against a fake without touching the network.
  // `CrmService` holds one generic `CrmObjectService` per object type and
  // hands out the right one at call time — which is what lets a single tool
  // serve contacts, companies, and deals. Associations, Engagements, and
  // Properties were already generic across all three.
  const crmService = new CrmService({ client: hubspotClient, logger });
  const associationsService = new AssociationsService({ client: hubspotClient, logger });
  const engagementsService = new EngagementsService({ client: hubspotClient, logger });
  const propertiesService = new PropertiesService({ client: hubspotClient, logger });

  const toolRegistry = new ToolRegistry(logger);
  toolRegistry.registerAll(
    createTools({
      config,
      healthService,
      crmService,
      associationsService,
      engagementsService,
      propertiesService,
      registry: toolRegistry,
    })
  );

  let disposed = false;

  return {
    config,
    logger,
    tokenStore,
    tokenProvider,
    oauthService,
    rateLimiter,
    circuitBreaker,
    hubspotClient,
    healthService,
    crmService,
    associationsService,
    engagementsService,
    propertiesService,
    toolRegistry,

    dispose(): Promise<void> {
      if (disposed) {
        return Promise.resolve();
      }
      disposed = true;

      // Rejects anything still queued so shutdown cannot block on a waiter
      // that will never be served.
      rateLimiter.dispose();
      logger.debug('Container disposed.');
      return Promise.resolve();
    },
  };
}
