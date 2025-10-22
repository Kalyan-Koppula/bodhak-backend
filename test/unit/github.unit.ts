import { describe, test, expect, vi, beforeEach, afterAll } from 'vitest';
import * as github from '../../src/github';

// We'll mock global fetch
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

describe('github helpers', () => {
  const fakeEnv: any = {
    GITHUB_REPO_OWNER: 'owner',
    GITHUB_REPO_NAME: 'repo',
    GITHUB_TOKEN: 'token',
  };

  test('getFileSha returns sha when 200', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sha: 'abc' }),
    });
    const sha = await github.getFileSha(fakeEnv, 'path');
    expect(sha).toBe('abc');
  });

  test('getFileSha returns null when 404', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({ ok: false, status: 404 });
    const sha = await github.getFileSha(fakeEnv, 'path');
    expect(sha).toBeNull();
  });

  test('createGitHubFile throws on non-ok', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ msg: 'err' }),
    });
    await expect(github.createGitHubFile(fakeEnv, 'p', 'c', 'm')).rejects.toThrow();
  });

  test('updateGitHubFile throws on non-ok', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ msg: 'err' }),
    });
    await expect(github.updateGitHubFile(fakeEnv, 'p', 'c', 'm', 'sha')).rejects.toThrow();
  });

  test('deleteGitHubFile throws on non-ok', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ msg: 'err' }),
    });
    await expect(github.deleteGitHubFile(fakeEnv, 'p', 'sha', 'm')).rejects.toThrow();
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});
