import pino from 'pino';

// JSON logs: Render's log view shows one line per entry. In development,
// `npm run dev` pipes them through pino-pretty for readable output.
export function createLogger({ level }) {
  return pino({
    level,
    // Never log credentials, even by accident (e.g. logging a whole request).
    redact: ['req.headers.authorization', '*.password', '*.secret', '*.token'],
  });
}
