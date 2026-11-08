import crypto from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { TEST_ADMIN_KEY, TEST_PROVISION_KEY } from './support/constants.js';

// Runs once before all test files: starts a throwaway MongoDB and sets the
// environment every test process inherits. Tests never read backend/.env
// and never touch Atlas. (The first run downloads mongod into ~/.cache.)
// TEST_MONGODB_URI uses an existing MongoDB instead: `make test-docker` sets
// it, because the in-memory server has no build for Alpine.
let mongod;

export async function globalSetup() {
  const external = process.env.TEST_MONGODB_URI;
  if (!external) mongod = await MongoMemoryServer.create();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    CORS_ORIGIN: 'http://localhost:5173',
    MONGODB_URI: external ?? mongod.getUri(),
    MONGODB_DB: 'oled-test',
    ADMIN_KEY: TEST_ADMIN_KEY,
    PROVISION_KEY: TEST_PROVISION_KEY,
    SECRETS_KEY: crypto.randomBytes(32).toString('base64'),
    CLEANUP_TZ: 'Asia/Kolkata',
    // The broker tests start their own Mosquitto on these ports.
    MQTT_ADMIN_PASSWORD: crypto.randomBytes(16).toString('hex'),
    MQTT_BACKEND_PASSWORD: crypto.randomBytes(16).toString('hex'),
    MQTT_TCP_PORT: '18883',
    MQTT_WS_PORT: '19001',
  });
}

export async function globalTeardown() {
  await mongod?.stop();
}
