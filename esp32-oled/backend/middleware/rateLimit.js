import { rateLimit } from 'express-rate-limit';
import { config } from '../utils/config.js';

// 10 tries a minute per IP. Codes have 8 characters from 31 symbols and
// expire after 2 minutes, so guessing one is hopeless.
export const pairingLimiter = perMinute({ limit: 10 });

// Device registration: the provision key ships in every firmware, so cap
// how fast anyone holding it can add devices.
export const provisionLimiter = perMinute({ limit: 5 });

// Song searches go to LRCLIB, a free service: 20 a minute per phone.
// Runs after requireSession, so req.user is set.
export const musicSearchLimiter = perMinute({
  limit: 20,
  keyGenerator: (req) => `user:${req.user._id}`,
});

// Only wrong keys count, so normal admin use is never slowed down.
export const adminKeyLimiter = perMinute({
  limit: 5,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
});

function perMinute(options) {
  return rateLimit({
    windowMs: 60_000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Tests send many requests from one IP.
    skip: () => config.env === 'test',
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'rate_limited', message: 'Too many attempts, try again in a minute' },
      });
    },
    ...options,
  });
}
