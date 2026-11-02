import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    // The frontend's address. Browsers may call the API only from here, and
    // pairing QR links point here. On Render it arrives as a bare host.
    CORS_ORIGIN: z.preprocess(withHttps, z.url().default('http://localhost:5173')),

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

    // Handed to each device when it registers; the firmware connects here.
    // Unset on Render, it is worked out from RENDER_EXTERNAL_URL.
    PUBLIC_MQTT_URL: z
      .string()
      .regex(/^wss?:\/\//, 'must start with ws:// or wss://')
      .optional(),
    RENDER_EXTERNAL_URL: z.url().optional(),

    CLEANUP_TZ: z
      .string()
      .refine(isTimeZone, 'must be an IANA time zone such as Asia/Kolkata')
      .default('Asia/Kolkata'),

    // The Mosquitto broker the backend starts inside its container. Set
    // MQTT_ENABLED=false to run the API on a laptop without Mosquitto.
    MQTT_ENABLED: z.enum(['true', 'false']).default('true'),
    MOSQUITTO_BIN: z.string().default('mosquitto'),
    MOSQUITTO_CTRL_BIN: z.string().default('mosquitto_ctrl'),
    MOSQUITTO_PLUGIN: z.string().default('/usr/lib/mosquitto_dynamic_security.so'),
    MQTT_TCP_PORT: z.coerce.number().int().min(1).max(65535).default(1883),
    MQTT_WS_PORT: z.coerce.number().int().min(1).max(65535).default(9001),
    MQTT_ADMIN_PASSWORD: z.string().min(16, 'must be at least 16 characters').optional(),
    MQTT_BACKEND_PASSWORD: z.string().min(16, 'must be at least 16 characters').optional(),
  })
  .superRefine((vars, ctx) => {
    if (vars.MQTT_ENABLED === 'false') return;
    for (const name of ['MQTT_ADMIN_PASSWORD', 'MQTT_BACKEND_PASSWORD']) {
      if (!vars[name]) ctx.addIssue({ code: 'custom', path: [name], message: 'is required' });
    }
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
    publicMqttUrl: vars.PUBLIC_MQTT_URL ?? mqttUrlFor(vars.RENDER_EXTERNAL_URL),
    cleanupTimeZone: vars.CLEANUP_TZ,
    mqtt: {
      enabled: vars.MQTT_ENABLED === 'true',
      bin: vars.MOSQUITTO_BIN,
      ctrlBin: vars.MOSQUITTO_CTRL_BIN,
      plugin: vars.MOSQUITTO_PLUGIN,
      tcpPort: vars.MQTT_TCP_PORT,
      wsPort: vars.MQTT_WS_PORT,
      adminPassword: vars.MQTT_ADMIN_PASSWORD,
      backendPassword: vars.MQTT_BACKEND_PASSWORD,
    },
  };
}

// x.onrender.com -> https://x.onrender.com; full URLs pass through.
function withHttps(value) {
  if (typeof value !== 'string' || value === '' || /^https?:\/\//.test(value)) return value;
  return `https://${value}`;
}

// https://x.onrender.com -> wss://x.onrender.com/mqtt (same host, same port).
function mqttUrlFor(publicUrl) {
  if (!publicUrl) return 'ws://localhost:8080/mqtt';
  const url = new URL('/mqtt', publicUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
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
