import { pino, stdSerializers, type Logger, type LoggerOptions } from 'pino';
import { LOG_REDACT_PATHS } from './redaction.js';
import type { LogConfig, ServiceConfig } from '../types/config.types.js';

/**
 * Builds the root Pino logger.
 *
 * Emits newline-delimited JSON in production, which is what Azure App Service
 * log streaming and Application Insights ingest without a parser. Pretty
 * output is opt-in for local development only.
 */
export function createLogger(logConfig: LogConfig, service: ServiceConfig): Logger {
  const options: LoggerOptions = {
    level: logConfig.level,

    // Never lose a secret to a log aggregator.
    redact: {
      paths: [...LOG_REDACT_PATHS],
      censor: '[REDACTED]',
      remove: false,
    },

    // Stamped on every record so logs from many App Service instances can be
    // separated after the fact.
    base: {
      service: service.name,
      version: service.version,
      env: service.environment,
      instanceId: service.instanceId,
    },

    formatters: {
      // `level: "info"` is far more useful than `level: 30` in a log query.
      level: (label) => ({ level: label }),
    },

    timestamp: pino.stdTimeFunctions.isoTime,

    // Serialise errors with their full chain instead of `{}`.
    serializers: {
      err: stdSerializers.err,
      error: stdSerializers.err,
    },
  };

  if (!logConfig.pretty) {
    return pino(options);
  }

  // pino-pretty is a devDependency. If someone enables pretty logging in an
  // environment where it was not installed, degrade to JSON rather than
  // crashing the process on boot.
  try {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname,service,version,env,instanceId',
          singleLine: false,
        },
      },
    });
  } catch {
    const fallback = pino(options);
    fallback.warn('pino-pretty is unavailable; falling back to JSON log output.');
    return fallback;
  }
}

export type { Logger };
