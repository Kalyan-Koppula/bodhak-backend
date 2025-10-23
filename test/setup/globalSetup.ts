import { startWranglerDev } from './wranglerDev';

export default async function globalSetup() {
  // startWranglerDev returns once /health is reachable (or throws)
  await startWranglerDev();
}
