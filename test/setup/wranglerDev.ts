import { spawn, ChildProcess, exec } from 'node:child_process';
import fetch from 'node-fetch';
import { promisify } from 'node:util';

const execP = promisify(exec);
let proc: ChildProcess | null = null;

export async function startWranglerDev(): Promise<void> {
  if (proc) return;

  // Ensure local D1 migrations are applied so the local binding exists
  try {
    // Use the local wrangler binary to avoid global deps
    await execP('wrangler d1 migrations apply bodhak --local');
  } catch (err) {
    // Log migration errors but continue; tests may still run against an existing DB
    // eslint-disable-next-line no-console
    console.warn('Local migrations may have failed or already applied:', err);
  }

  proc = spawn('npm', ['run', 'dev:local'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, MOCK_GITHUB: '1' },
  });

  // Wait for the dev server to be up by polling /health
  const start = Date.now();
  const timeout = 60000; // 60s
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch('http://127.0.0.1:8787/health');
      if (res.ok) return;
    } catch (e) {
      // Log a debug message and continue polling
      // eslint-disable-next-line no-console
      console.debug('Waiting for dev server, fetch error:', String(e));
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Wrangler dev did not start in time');
}

export async function stopWranglerDev(): Promise<void> {
  if (!proc) return;
  proc.kill();
  proc = null;
}
