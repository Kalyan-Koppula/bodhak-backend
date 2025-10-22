import { spawn, ChildProcess } from 'child_process';
import fetch from 'node-fetch';

let proc: ChildProcess | null = null;

export async function startWranglerDev(): Promise<void> {
  if (proc) return;
  proc = spawn('node', ['./node_modules/wrangler/bin/wrangler.js', 'dev'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, MOCK_GITHUB: '1' },
  });

  // Wait for the dev server to be up by polling /
  const start = Date.now();
  while (Date.now() - start < 30000) {
    try {
      const res = await fetch('http://127.0.0.1:8787/');
      if (res.ok) return;
    } catch (e) {
      // ignore
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
