import { config } from 'dotenv';
import { resolve } from 'node:path';
import { prisma } from './data/prisma.js';
import { createApp } from './app.js';
import { loadEnvironment } from './config/env.js';

const projectRoot = resolve(__dirname, '../../..');
config({ path: resolve(projectRoot, '.env') });

async function startServer() {
  const environment = loadEnvironment();
  const app = createApp();

  await prisma.$connect();
  const server = app.listen(environment.PORT, '0.0.0.0', () => {
    console.info(`API listening on port ${environment.PORT}`);
  });

  async function shutdown() {
    server.close();
    await prisma.$disconnect();
  }

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

startServer().catch((error: unknown) => {
  console.error('Failed to start the API.', error);
  process.exitCode = 1;
});
