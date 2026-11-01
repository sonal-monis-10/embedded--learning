import { MongoMemoryServer } from 'mongodb-memory-server';
import { loadConfig } from '../../utils/config.js';
import { createLogger } from '../../utils/logger.js';

// Starts a throwaway MongoDB for one test file (the first run downloads a
// mongod binary into ~/.cache). Tests never touch the real Atlas database.
export async function startTestDb() {
  const mongod = await MongoMemoryServer.create();
  const config = loadConfig({
    NODE_ENV: 'test',
    CORS_ORIGIN: 'http://localhost:5173',
    MONGODB_URI: mongod.getUri(),
    MONGODB_DB: 'oled-test',
  });
  return { mongod, config, logger: createLogger({ level: 'silent' }) };
}
