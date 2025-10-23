// Per-worker setup file. Server start/stop is handled once for the whole run by
// `globalSetup`/`globalTeardown` so this file should not spawn `wrangler dev`.
// Keep this file for any per-worker initialization (DB cleanup, mocks, etc.).

export default undefined;
