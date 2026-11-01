import { badRequest } from './errors.js';

// Replaces req.body with the parsed value (trimmed, defaults filled in), or
// answers 400 listing every problem.
export function validate(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const problems = result.error.issues.map(
        (i) => `${i.path.join('.') || 'body'}: ${i.message}`,
      );
      throw badRequest('invalid_request', problems.join('; '));
    }
    req.body = result.data;
    next();
  };
}
