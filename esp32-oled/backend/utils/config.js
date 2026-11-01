import { z } from 'zod';

// Every setting the backend reads from the environment. Later steps add
// JWT_SECRET, SECRETS_KEY, MQTT_* and so on (full list: docs/plan/README.md §8).
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // The frontend's origin, e.g. https://oled-frontend.onrender.com. Only this
  // origin may call the API from a browser.
  CORS_ORIGIN: z.url().default('http://localhost:5173'),
  // Atlas connection string. The database name comes from MONGODB_DB, so the
  // same cluster can hold separate dev and prod databases.
  MONGODB_URI: z
    .string({ error: 'is required' })
    .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),
  MONGODB_DB: z.string().min(1).default('oled'),
});

// Throws one readable error listing every bad variable, so a misconfigured
// deploy fails at startup instead of on the first request. The connection
// string is never echoed, since it contains the database password.
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
    mongo: { uri: c.MONGODB_URI, dbName: c.MONGODB_DB },
  };
}
