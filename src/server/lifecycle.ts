import type { Logger } from 'pino';
import type { HttpServer } from './http.server.js';
import type { Container } from '../container/container.js';

export interface ShutdownDependencies {
  readonly httpServer: HttpServer;
  readonly container: Container;
  readonly logger: Logger;
  readonly timeoutMs: number;
}

/**
 * Graceful shutdown, wired to the signals Azure App Service actually sends.
 *
 * App Service sends SIGTERM and then waits a bounded grace period before
 * killing the worker, so shutdown is ordered to drain rather than to stop:
 *
 *   1. Fail readiness first, so the front end stops routing new requests here.
 *   2. Close the HTTP listener, letting in-flight requests finish.
 *   3. Close MCP sessions and release container resources.
 *
 * A hard timer bounds the whole sequence: exiting late looks identical to
 * hanging, and the platform will SIGKILL us anyway — better to exit
 * deliberately with a log line explaining why.
 */
export function registerShutdownHandlers(deps: ShutdownDependencies): () => Promise<void> {
  const { httpServer, container, logger, timeoutMs } = deps;
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      logger.warn({ signal }, 'Shutdown already in progress; ignoring repeat signal.');
      return;
    }
    shuttingDown = true;

    logger.info({ signal, timeoutMs }, 'Graceful shutdown initiated.');

    const forceExit = setTimeout(() => {
      logger.fatal({ signal, timeoutMs }, 'Graceful shutdown timed out; forcing exit.');
      process.exit(1);
    }, timeoutMs);
    forceExit.unref();

    try {
      // Step 1: drain. Readiness turns 503 while the listener is still open,
      // so requests already in flight are unaffected.
      httpServer.setAcceptingTraffic(false);

      // Step 2: stop accepting connections and wait for open ones to finish.
      await httpServer.app.close();

      // Step 3: release everything else.
      await httpServer.transportManager.close();
      await container.dispose();

      clearTimeout(forceExit);
      logger.info({ signal }, 'Graceful shutdown complete.');
    } catch (error) {
      clearTimeout(forceExit);
      logger.error({ signal, err: error }, 'Error during graceful shutdown.');
      process.exitCode = 1;
    }
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }

  // A process that has thrown an uncaught exception has unknown state. Log it
  // with full fidelity, then leave — restarting is safer than continuing to
  // serve from a corrupted process, and App Service will replace the instance.
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception; shutting down.');
    void shutdown('uncaughtException').finally(() => {
      process.exit(1);
    });
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection; shutting down.');
    void shutdown('unhandledRejection').finally(() => {
      process.exit(1);
    });
  });

  return () => shutdown('manual');
}
