import { logger } from '../utils/logger.js';

// Every error response has the same shape, so the frontend can branch on
// `code`:   { "error": { "code": "device_not_found", "message": "No such device" } }
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (code, message) => new HttpError(400, code, message);
export const unauthorized = (code, message) => new HttpError(401, code, message);
export const forbidden = (code, message) => new HttpError(403, code, message);
export const notFound = (code, message) => new HttpError(404, code, message);

export function unknownRoute(req, res) {
  sendError(res, notFound('not_found', `No route for ${req.method} ${req.path}`));
}

// Express treats a middleware with four parameters as the error handler.
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return sendError(res, err);

  // Thrown by express.json() for unreadable bodies.
  if (err.type === 'entity.parse.failed') {
    return sendError(res, badRequest('invalid_json', 'Request body is not valid JSON'));
  }
  if (err.type === 'entity.too.large') {
    return sendError(res, new HttpError(413, 'body_too_large', 'Request body is too large'));
  }

  logger.error({ err, method: req.method, path: req.path }, 'unhandled error');
  sendError(res, new HttpError(500, 'internal', 'Internal server error'));
}

function sendError(res, { status, code, message }) {
  res.status(status).json({ error: { code, message } });
}
