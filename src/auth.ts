// src/auth.ts
import { MiddlewareHandler, Context } from 'hono';
import { sign, verify } from 'hono/jwt';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

// Middleware to check for admin JWT
export const jwtAuth =
  (secret: string): MiddlewareHandler =>
  async (c, next) => {
    const token = getCookie(c, 'token');
    if (!token) {
      return c.json({ error: 'Unauthorized: No token provided' }, 401);
    }

    try {
      const payload = await verify(token, secret);
      c.set('jwtPayload', payload);
      await next();
    } catch (err) {
      // Log verification errors for debugging; don't silently swallow them
      // eslint-disable-next-line no-console
      console.error('JWT verification failed:', err);
      return c.json({ error: 'Unauthorized: Invalid token' }, 401);
    }
  };

// Login route handler
export const loginHandler = async (c: Context) => {
  const { username, password } = await c.req.json();

  if (username === c.env.ADMIN_USERNAME && password === c.env.ADMIN_PASSWORD) {
    const token = await sign(
      {
        sub: c.env.ADMIN_USERNAME,
        role: 'admin',
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      },
      c.env.JWT_SECRET
    );

    setCookie(c, 'token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 60 * 60 * 24,
    });

    return c.json({ message: 'Login successful' });
  }

  return c.json({ error: 'Invalid credentials' }, 401);
};

// Logout route handler
export const logoutHandler = async (c: Context) => {
  deleteCookie(c, 'token');
  return c.json({ message: 'Logout successful' });
};
