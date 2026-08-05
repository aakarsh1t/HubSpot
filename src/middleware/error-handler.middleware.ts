import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { AppFastifyInstance } from '../types/http.types.js';
import {
  type AppError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  isAppError,
  normalizeError,
  toProblemDetails,
} from '../utils/errors.js';

/**
 * Terminal error handling for the HTTP surface.
 *
 * Every error leaves through here, in one shape: RFC 9457 `problem+json`.
 * A single exit point is what guarantees the two invariants that matter —
 * an internal error can never leak its message, and every response carries the
 * `requestId` needed to find the corresponding log line.
 */
export function registerErrorHandler(app: AppFastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const appError = toAppError(error);
    const requestId = request.ctx?.requestId ?? '-';

    // 5xx is our fault and needs a stack; 4xx is the caller's and would only
    // add noise at error level.
    if (appError.httpStatus >= 500) {
      request.log.error(
        {
          requestId,
          err: appError,
          errorCode: appError.code,
          method: request.method,
          path: request.url,
          statusCode: appError.httpStatus,
        },
        'Request failed with a server error.'
      );
    } else {
      request.log.warn(
        {
          requestId,
          errorCode: appError.code,
          errorMessage: appError.publicMessage,
          method: request.method,
          path: request.url,
          statusCode: appError.httpStatus,
        },
        'Request failed with a client error.'
      );
    }

    if (appError.retryAfterMs !== null) {
      void reply.header('retry-after', Math.ceil(appError.retryAfterMs / 1000).toString());
    }

    void reply
      .status(appError.httpStatus)
      .type('application/problem+json')
      .send(toProblemDetails(appError, requestId));
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.ctx?.requestId ?? '-';
    const error = new NotFoundError(`Route ${request.method} ${request.url} does not exist.`);

    void reply
      .status(error.httpStatus)
      .type('application/problem+json')
      .send(toProblemDetails(error, requestId));
  });
}

/**
 * Translates Fastify's own failure modes into our error vocabulary.
 *
 * Fastify signals schema violations, payload-too-large, and rate limiting
 * through `FastifyError` codes rather than typed classes, so this is where
 * they get named.
 */
function toAppError(error: FastifyError): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error.validation !== undefined) {
    return new ValidationError('Request failed schema validation.', {
      issues: error.validation.map((issue) => ({
        path: issue.instancePath,
        message: issue.message ?? 'invalid value',
      })),
    });
  }

  switch (error.code) {
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return new ValidationError('Request body exceeds the configured size limit.');

    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return new ValidationError('Unsupported Content-Type. Use application/json.');

    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
      return new ValidationError('Request body is not valid JSON.');

    case 'FST_ERR_BAD_STATUS_CODE':
      break;

    default:
      break;
  }

  // @fastify/rate-limit surfaces a plain 429 rather than a typed error.
  if (error.statusCode === 429) {
    return new RateLimitError(error.message);
  }

  if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
    return new ValidationError(error.message);
  }

  return normalizeError(error);
}
