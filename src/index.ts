import { config as loadDotenv } from 'dotenv';
import { buildContainer } from './container/composition-root.js';
import { createHttpServer } from './server/http.server.js';
import { registerShutdownHandlers } from './server/lifecycle.js';
import { loadConfig } from './config/config.js';
import { isAppError } from './utils/errors.js';

/**
 * Application entry point.
 *
 * The startup sequence is ordered so that anything that can fail, fails before
 * this instance ever advertises itself as healthy:
 *
 *   1. load .env (local only — App Service injects real settings)
 *   2. validate configuration       ← fails fast, with named variables
 *   3. build the dependency graph   ← fails fast on wiring problems
 *   4. build the HTTP server
 *   5. install signal handlers *before* listening, so a SIGTERM arriving
 *      during startup is still handled gracefully
 *   6. listen
 */
async function main(): Promise<void> {
  // In App Service, configuration comes from App Settings, which are already
  // in process.env. `override: false` guarantees a stray committed .env can
  // never take precedence over real platform configuration.
  loadDotenv({ quiet: true, override: false });

  const config = loadConfig();
  const container = buildContainer(config);
  const { logger } = container;

  logger.info(
    {
      environment: config.service.environment,
      authMode: config.hubspot.auth.mode,
      sessionMode: config.mcp.sessionMode,
      endpoint: config.mcp.endpointPath,
      apiKeyAuth: config.security.apiKeyEnabled,
      toolCount: container.toolRegistry.size,
      nodeVersion: process.version,
    },
    'Starting HubSpot MCP server.'
  );

  const httpServer = await createHttpServer(container);

  registerShutdownHandlers({
    httpServer,
    container,
    logger,
    timeoutMs: config.http.shutdownTimeoutMs,
  });

  await httpServer.app.listen({
    port: config.http.port,
    // Must be 0.0.0.0 on App Service: binding to localhost would make the
    // platform's health probe — which arrives over the container network —
    // fail on every instance.
    host: config.http.host,
  });

  logger.info(
    {
      port: config.http.port,
      host: config.http.host,
      mcpEndpoint: config.mcp.endpointPath,
    },
    'HubSpot MCP server is listening.'
  );
}

main().catch((error: unknown) => {
  // The logger may not exist yet — a config failure happens before it is
  // built — so this one path deliberately uses console.error.
  if (isAppError(error)) {
    console.error(`[fatal] ${error.name}: ${error.message}`);
    if (error.details !== undefined) {
      console.error(JSON.stringify(error.details, null, 2));
    }
  } else {
    console.error('[fatal] Failed to start HubSpot MCP server:', error);
  }

  process.exit(1);
});
