import pino from 'pino';
import { config } from './config.js';

// JSON lines for Render's log view; `npm run dev` pipes them through pino-pretty.
export const logger = pino({
  level: config.logLevel,
  redact: ['req.headers.authorization', 'req.headers["x-admin-key"]', '*.password', '*.secret'],
});
