import { beforeAll, afterAll } from 'vitest';
import { startWranglerDev, stopWranglerDev } from './wranglerDev';

beforeAll(async () => {
  await startWranglerDev();
});

afterAll(async () => {
  await stopWranglerDev();
});
