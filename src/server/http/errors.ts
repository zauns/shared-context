import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { DomainError } from '../domain/errors.js';
import type { Logger } from '../logger.js';

export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

export function notFoundHandler(): RequestHandler {
  return (request, response) => {
    response.status(404).json({
      ok: false,
      error: {
        code: 'not_found',
        message: `No route for ${request.method} ${request.path}`,
      },
    });
  };
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error, request, response, _next) => {
    if (response.headersSent) {
      response.end();
      return;
    }

    if (error instanceof DomainError) {
      response.status(error.status).json({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        ...(error.currentIssue !== undefined ? { issue: error.currentIssue } : {}),
      });
      return;
    }

    if (error instanceof ZodError) {
      response.status(400).json({
        ok: false,
        error: {
          code: 'validation_error',
          message: 'Invalid request',
          details: { issues: error.issues },
        },
      });
      return;
    }

    if (error instanceof SyntaxError) {
      response.status(400).json({
        ok: false,
        error: { code: 'validation_error', message: 'Malformed JSON body' },
      });
      return;
    }

    logger.error(
      { err: error, method: request.method, path: request.path },
      'request failed',
    );
    response.status(500).json({
      ok: false,
      error: { code: 'internal_error', message: 'Internal server error' },
    });
  };
}
