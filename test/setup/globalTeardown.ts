import { stopWranglerDev } from './wranglerDev';

export default async function globalTeardown() {
  await stopWranglerDev();
}
