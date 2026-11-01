import { rateLimit } from 'express-rate-limit';

// Per-IP limits (req.ip is the real client because app.js trusts Render's
// proxy). Disabled in tests, which make many requests from one IP.
function limiter(options) {
  return rateLimit({
    windowMs: 60_000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => req.app.locals.config.env === 'test',
    handler: (req, res) => {
      res.status(429).json({
        error: { code: 'rate_limited', message: 'Too many attempts, try again in a minute' },
      });
    },
    ...options,
  });
}

// Pairing: 10 tries a minute. With 8-character codes from 31 symbols that
// makes guessing a live 2-minute code practically impossible.
export const pairingLimiter = limiter({ limit: 10 });

// Admin: only wrong keys count, so normal admin use is never blocked.
export const adminKeyLimiter = limiter({
  limit: 5,
  requestWasSuccessful: (req, res) => res.statusCode !== 401,
  skipSuccessfulRequests: true,
});
