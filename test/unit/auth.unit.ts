import { describe, test, expect, vi } from 'vitest';
import { loginHandler, logoutHandler, jwtAuth } from '../../src/auth';

// We'll create minimal stubs for Hono Context
function makeCtx(env: any = {}) {
  let cookieSet: Record<string, string> = {};
  const c: any = {
    env,
    req: {
      json: async () => ({ username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }),
      header: (name: string) => null,
    },
    res: {},
    set: vi.fn(),
    json: (body: any, status?: number) => ({ body, status: status ?? 200 }),
  };
  return c;
}

describe('auth handlers', () => {
  test('loginHandler succeeds with correct credentials', async () => {
    const env = { ADMIN_USERNAME: 'u', ADMIN_PASSWORD: 'p', JWT_SECRET: 's' } as any;
    const c = makeCtx(env);
    const res = await loginHandler(c);
    expect(res).toHaveProperty('body');
    expect(res.body).toHaveProperty('message');
  });

  test('logoutHandler returns success', async () => {
    const c = makeCtx();
    const res = await logoutHandler(c as any);
    expect(res).toHaveProperty('body');
    expect(res.body).toHaveProperty('message');
  });

  test('jwtAuth returns middleware function', () => {
    const mw = jwtAuth('secret');
    expect(typeof mw).toBe('function');
  });
});
