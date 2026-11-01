import { HttpError } from './errors.js';

// Validates req.body against a zod schema and replaces it with the parsed
// (trimmed, defaulted) value. Every problem is listed in one 400 response.
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const message = result.error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ');
      throw new HttpError(400, 'invalid_request', message);
    }
    req.body = result.data;
    next();
  };
}
