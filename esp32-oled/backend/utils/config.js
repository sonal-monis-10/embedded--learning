import { z } from 'zod';

// Every setting the backend reads from the environment. Later steps add
// MQTT_* (full list: docs/plan/README.md §8).
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // The frontend's origin, e.g. https://oled-frontend.onrender.com. Only this
  // origin may call the API from a browser, and pairing QR links point here.
  CORS_ORIGIN: z.url().default('http://localhost:5173'),
  // Atlas connection string. The database name comes from MONGODB_DB, so the
  // same cluster can hold separate dev and prod databases.
  MONGODB_URI: z
    .string({ error: 'is required' })
    .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),
  MONGODB_DB: z.string().min(1).default('oled'),
  // Unlocks /api/admin (device registration). Long enough that guessing is
  // hopeless even without the rate limit.
  ADMIN_KEY: z.string({ error: 'is required' }).min(24, 'must be at least 24 characters'),
  // AES-256 key for device secrets and Wi-Fi passwords in MongoDB. Losing it
  // means every device has to be re-registered, so back it up.
  SECRETS_KEY: z
    .string({ error: 'is required' })
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded'),
  // Written into device .env files; the firmware connects here.
  PUBLIC_MQTT_URL: z
    .string()
    .regex(/^wss?:\/\//, 'must start with ws:// or wss://')
    .default('ws://localhost:8080/mqtt'),
  // The nightly cleanup runs at 00:00 in this time zone.
  CLEANUP_TZ: z
    .string()
    .refine(isTimeZone, 'must be an IANA time zone such as Asia/Kolkata')
    .default('Asia/Kolkata'),
});

function isTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Throws one readable error listing every bad variable, so a misconfigured
// deploy fails at startup instead of on the first request. Values are never
// echoed, since several of them are secrets.
export function loadConfig(env = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  const c = result.data;
  return {
    env: c.NODE_ENV,
    port: c.PORT,
    logLevel: c.LOG_LEVEL,
    corsOrigin: c.CORS_ORIGIN,
    frontendUrl: c.CORS_ORIGIN.replace(/\/$/, ''),
    mongo: { uri: c.MONGODB_URI, dbName: c.MONGODB_DB },
    adminKey: c.ADMIN_KEY,
    secretsKey: Buffer.from(c.SECRETS_KEY, 'base64'),
    publicMqttUrl: c.PUBLIC_MQTT_URL,
    cleanupTz: c.CLEANUP_TZ,
  };
}
