import crypto from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { TEST_ADMIN_KEY, TEST_PROVISION_KEY } from './support/constants.js';

// Runs once before all test files: starts a throwaway MongoDB and sets the
// environment every test process inherits. Tests never read backend/.env
// and never touch Atlas. (The first run downloads mongod into ~/.cache.)
let mongod;

export async function globalSetup() {
  mongod = await MongoMemoryServer.create();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    CORS_ORIGIN: 'http://localhost:5173',
    MONGODB_URI: mongod.getUri(),
    MONGODB_DB: 'oled-test',
    ADMIN_KEY: TEST_ADMIN_KEY,
    PROVISION_KEY: TEST_PROVISION_KEY,
    SECRETS_KEY: crypto.randomBytes(32).toString('base64'),
    CLEANUP_TZ: 'Asia/Kolkata',
  });
}

export async function globalTeardown() {
  await mongod?.stop();
}
