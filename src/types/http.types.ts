import type { FastifyInstance, RawServerDefault } from 'fastify';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from 'pino';

/**
 * The concrete Fastify instance type used throughout this application.
 *
 * Because we hand Fastify our own configured Pino instance via
 * `loggerInstance`, Fastify specialises its logger generic from
 * `FastifyBaseLogger` to Pino's `Logger`. Helpers typed against the bare
 * `FastifyInstance` default would therefore not accept our app — the mismatch
 * shows up as a wall of variance errors under `exactOptionalPropertyTypes`.
 *
 * Naming the specialised type once, here, keeps every `register*` helper
 * signature honest and the errors gone.
 */
export type AppFastifyInstance = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse,
  Logger
>;
