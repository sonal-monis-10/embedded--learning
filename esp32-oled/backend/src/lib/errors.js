// Every error response has the same shape:
//   { "error": { "code": "device_not_found", "message": "…" } }
// so the frontend can branch on `code` instead of parsing messages.

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function notFound(req, res) {
  res
    .status(404)
    .json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
}

export function errorHandler(logger) {
  // Express recognises error handlers by their four parameters, so `next`
  // must stay even though it is unused.
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    // express.json() reports malformed bodies with type 'entity.parse.failed'.
    if (err.type === 'entity.parse.failed') {
      return res
        .status(400)
        .json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON' } });
    }
    if (err.type === 'entity.too.large') {
      return res
        .status(413)
        .json({ error: { code: 'body_too_large', message: 'Request body is too large' } });
    }

    // Anything else is a bug: log the details, return nothing internal.
    logger.error({ err, method: req.method, path: req.path }, 'unhandled error');
    return res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
  };
}
