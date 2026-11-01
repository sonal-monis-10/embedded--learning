import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // The frontend's address. Browsers may call the API only from here, and
  // pairing QR links point here.
  CORS_ORIGIN: z.url().default('http://localhost:5173'),

  MONGODB_URI: z
    .string({ error: 'is required' })
    .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),
  MONGODB_DB: z.string().min(1).default('oled'),

  // Built into every firmware: lets a device register itself on first boot.
  // It can do nothing else, so it is a separate key from ADMIN_KEY.
  PROVISION_KEY: z.string({ error: 'is required' }).min(24, 'must be at least 24 characters'),
  MAX_DEVICES: z.coerce.number().int().min(1).default(20),

  // Maintenance routes (curl only; there is no admin page).
  ADMIN_KEY: z.string({ error: 'is required' }).min(24, 'must be at least 24 characters'),

  // A turn ends after this many minutes without tilt or mode changes.
  IDLE_RELEASE_MIN: z.coerce.number().int().min(1).default(10),

  // Encrypts device secrets and Wi-Fi passwords in MongoDB. Losing it means
  // re-registering every device, so keep a backup.
  SECRETS_KEY: z
    .string({ error: 'is required' })
    .refine((value) => Buffer.from(value, 'base64').length === 32, 'must be 32 bytes, base64'),

  // Written into each device's .env file; the firmware connects here.
  PUBLIC_MQTT_URL: z
    .string()
    .regex(/^wss?:\/\//, 'must start with ws:// or wss://')
    .default('ws://localhost:8080/mqtt'),

  CLEANUP_TZ: z
    .string()
    .refine(isTimeZone, 'must be an IANA time zone such as Asia/Kolkata')
    .default('Asia/Kolkata'),
});

// Validates `env` and returns the settings the app uses. Throws one error
// listing every bad variable. Values are never echoed: several are secrets.
export function loadConfig(env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }

  const vars = result.data;
  return {
    env: vars.NODE_ENV,
    port: vars.PORT,
    logLevel: vars.LOG_LEVEL,
    frontendUrl: vars.CORS_ORIGIN.replace(/\/$/, ''),
    mongo: { uri: vars.MONGODB_URI, dbName: vars.MONGODB_DB },
    provisionKey: vars.PROVISION_KEY,
    maxDevices: vars.MAX_DEVICES,
    adminKey: vars.ADMIN_KEY,
    idleReleaseMs: vars.IDLE_RELEASE_MIN * 60_000,
    secretsKey: Buffer.from(vars.SECRETS_KEY, 'base64'),
    publicMqttUrl: vars.PUBLIC_MQTT_URL,
    cleanupTimeZone: vars.CLEANUP_TZ,
  };
}

function isTimeZone(name) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

function loadConfigOrExit() {
  try {
    return loadConfig(process.env);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

// Loaded once, when the first module imports it.
export const config = loadConfigOrExit();
