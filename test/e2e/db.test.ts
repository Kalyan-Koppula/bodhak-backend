import fetch from 'node-fetch';
import { exec } from 'child_process';
import { promisify } from 'util';
import { describe, test, expect, beforeEach } from 'vitest';

const execP = promisify(exec);

// Helper to run SQL against the local D1 via wrangler CLI and return parsed JSON
async function runSql(sql: string) {
  // Escape double quotes in the SQL for CLI invocation
  const escaped = sql.replace(/"/g, '\\"');
  const cmd = `node ./node_modules/wrangler/bin/wrangler.js d1 execute bodhak --local --command "${escaped}" --json`;
  const { stdout } = await execP(cmd);
  const out = stdout || '';
  try {
    return JSON.parse(out);
  } catch (error_) {
    // Parsing stdout to JSON may fail if the CLI emits extra logs; we'll try to recover below
    // Try to extract a JSON object from stdout in case of logs
    const first = out.indexOf('{');
    const last = out.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      const sub = out.slice(first, last + 1);
      try {
        return JSON.parse(sub);
      } catch (error_) {
        // fallthrough to line-by-line parsing
      }
    }
    for (const line of out.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try {
        return JSON.parse(t);
      } catch (error_) {
        // ignore this line and continue
      }
    }
    return { raw: out };
  }
}

// Read admin credentials (env or .dev.vars)
async function getAdminCreds() {
  let adminUser = process.env.ADMIN_USERNAME;
  let adminPass = process.env.ADMIN_PASSWORD;
  if (!adminUser || !adminPass) {
    const fs = await import('node:fs');
    const content = fs.readFileSync('.dev.vars', 'utf8');
    const mUser = content.match(/ADMIN_USERNAME\s*=\s*"?([^"\n]+)"?/);
    const mPass = content.match(/ADMIN_PASSWORD\s*=\s*"?([^"\n]+)"?/);
    adminUser = mUser ? mUser[1] : adminUser;
    adminPass = mPass ? mPass[1] : adminPass;
  }
  return { adminUser, adminPass };
}

async function loginAndGetCookie() {
  const { adminUser, adminPass } = await getAdminCreds();
  const loginRes = await fetch('http://127.0.0.1:8787/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: adminUser, password: adminPass }),
  });
  if (loginRes.status !== 200) throw new Error('Login failed: ' + loginRes.status);
  const setCookie = loginRes.headers.get('set-cookie') || '';
  return setCookie.split(';')[0];
}

// Helper: find subject by title via public API (polls until found or timeout)
async function findSubject(title: string, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await fetch('http://127.0.0.1:8787/api/subjects');
    if (res.ok) {
      const arr = await res.json();
      const found = Array.isArray(arr) ? arr.find((s: any) => s.title === title) : undefined;
      if (found) return found;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

// Helper: find topic by title for a given subject via public API
async function findTopic(subjectId: number | string, title: string, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await fetch(`http://127.0.0.1:8787/api/subjects/${subjectId}/topics`);
    if (res.ok) {
      const arr = await res.json();
      const found = Array.isArray(arr) ? arr.find((t: any) => t.title === title) : undefined;
      if (found) return found;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

// Helper: find article by title for a given topic via public API
async function findArticle(topicId: number | string, title: string, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await fetch(`http://127.0.0.1:8787/api/topics/${topicId}/articles`);
    if (res.ok) {
      const arr = await res.json();
      const found = Array.isArray(arr) ? arr.find((a: any) => a.title === title) : undefined;
      if (found) return found;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

// Retry helper to wait for a row to appear in D1 (handles small timing windows)
async function waitForRow(sql: string, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const r = await runSql(sql);
    if (r && Array.isArray(r.results) && r.results.length > 0) return r;
    await new Promise((r) => setTimeout(r, 350));
  }
  return null;
}

describe('D1 integration tests (isolated endpoints)', () => {
  // Reset DB before each test to ensure isolation
  beforeEach(async () => {
    await runSql('DELETE FROM articles;');
    await runSql('DELETE FROM topics;');
    await runSql('DELETE FROM subjects;');
    // Allow a short settle time after deletions
    await new Promise((r) => setTimeout(r, 200));
  });

  test('GET /api/subjects reads subjects from DB', async () => {
    await runSql("INSERT INTO subjects (title, rank) VALUES ('S1', 'a');");
    const res = await fetch('http://127.0.0.1:8787/api/subjects');
    expect(res.status).toBe(200);
    const body = await res.json();
    const combined = JSON.stringify(body);
    expect(combined).toContain('S1');
  });

  test('GET /api/subjects/:id/topics returns topics for subject', async () => {
    const cookie = await loginAndGetCookie();
    const subRes = await fetch('http://127.0.0.1:8787/api/admin/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'S2' }),
    });
    expect(subRes.status).toBe(201);
    const subj = await findSubject('S2');
    const subjectId: any = subj?.id ?? null;
    expect(subjectId).not.toBeNull();

    // create topic via admin endpoint
    const topRes = await fetch('http://127.0.0.1:8787/api/admin/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'T1', subjectId }),
    });
    expect(topRes.status).toBe(201);
    // create a second topic so reorder can compute a new rank
    const topRes2 = await fetch('http://127.0.0.1:8787/api/admin/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'T2', subjectId }),
    });
    expect(topRes2.status).toBe(201);
    const res = await fetch(`http://127.0.0.1:8787/api/subjects/${subjectId}/topics`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('T1');

    // retrieve created topics via public API to get their ranks
    const t1obj = await findTopic(subjectId, 'T1');
    const t2obj = await findTopic(subjectId, 'T2');
    const tid = t1obj?.id ?? null;
    const afterRank = t2obj?.rank ?? undefined;
    const reorderRes2 = await fetch('http://127.0.0.1:8787/api/admin/topics/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ id: tid, afterRank }),
    });
    expect(reorderRes2.status).toBe(200);
    const b2 = await reorderRes2.json();
    expect(b2).toHaveProperty('newRank');
  });

  test('Unauthenticated admin routes are blocked', async () => {
    const res = await fetch('http://127.0.0.1:8787/api/admin/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X' }),
    });
    expect(res.status).toBe(401);
  });

  test('Authenticated admin can update and delete subject', async () => {
    const cookie = await loginAndGetCookie();
    const subRes = await fetch('http://127.0.0.1:8787/api/admin/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'S3' }),
    });
    expect(subRes.status).toBe(201);
    const subj = await findSubject('S3');
    let subjectId: any = subj?.id ?? null;
    expect(subjectId).not.toBeNull();

    // Update
    const updateRes = await fetch(`http://127.0.0.1:8787/api/admin/subjects/${subjectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'S3-updated' }),
    });
    expect(updateRes.status).toBe(200);
    const after = await runSql(`SELECT title FROM subjects WHERE id = ${subjectId} LIMIT 1;`);
    expect(JSON.stringify(after)).toContain('S3-updated');

    // Delete
    const delRes = await fetch(`http://127.0.0.1:8787/api/admin/subjects/${subjectId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(delRes.status).toBe(200);
    const afterDel = await runSql(`SELECT id FROM subjects WHERE id = ${subjectId} LIMIT 1;`);
    expect(JSON.stringify(afterDel)).not.toContain(String(subjectId));
  });

  test('Authenticated admin can create subject via endpoint', async () => {
    const cookie = await loginAndGetCookie();
    const createRes = await fetch('http://127.0.0.1:8787/api/admin/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'S-create' }),
    });
    expect(createRes.status).toBe(201);
    const check = await runSql("SELECT title FROM subjects WHERE title = 'S-create' LIMIT 1;");
    expect(JSON.stringify(check)).toContain('S-create');
  });

  test('Authenticated admin can create topic via endpoint', async () => {
    const cookie = await loginAndGetCookie();
    // create a subject via admin so the app sees it
    const subRes = await fetch('http://127.0.0.1:8787/api/admin/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'S-topic' }),
    });
    expect(subRes.status).toBe(201);
    const s = await findSubject('S-topic');
    const subjectId: any = s?.id ?? null;
    expect(subjectId).not.toBeNull();

    const createRes = await fetch('http://127.0.0.1:8787/api/admin/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'T-create', subjectId }),
    });
    expect(createRes.status).toBe(201);
    const check = await runSql(`SELECT title FROM topics WHERE title = 'T-create' LIMIT 1;`);
    expect(JSON.stringify(check)).toContain('T-create');
  });

  test('GET /api/topics/:topicId/articles returns articles for topic', async () => {
    // prepare subject and topic
    const cookie = await loginAndGetCookie();
    const subRes = await fetch('http://127.0.0.1:8787/api/admin/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'S-arts' }),
    });
    expect(subRes.status).toBe(201);
    const subj = await findSubject('S-arts');
    const subjectId = subj?.id ?? null;
    expect(subjectId).not.toBeNull();
    const topRes = await fetch('http://127.0.0.1:8787/api/admin/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'T-arts', subjectId }),
    });
    expect(topRes.status).toBe(201);
    const t = await findTopic(subjectId, 'T-arts');
    const topicId = t?.id ?? null;
    expect(topicId).not.toBeNull();

    // insert article row directly
    await runSql(
      `INSERT INTO articles (topic_id, title, file_path, rank) VALUES (${topicId}, 'A1', 'fp', 'a');`
    );
    const res = await fetch(`http://127.0.0.1:8787/api/topics/${topicId}/articles`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain('A1');
  });

  test('Reorder subjects and topics endpoints return newRank', async () => {
    // create two subjects
    const cookie = await loginAndGetCookie();
    const r1 = await fetch('http://127.0.0.1:8787/api/admin/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'R1' }),
    });
    expect(r1.status).toBe(201);
    const r2 = await fetch('http://127.0.0.1:8787/api/admin/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'R2' }),
    });
    expect(r2.status).toBe(201);
    const r1obj = await findSubject('R1');
    const r2obj = await findSubject('R2');
    expect(r1obj).not.toBeNull();
    expect(r2obj).not.toBeNull();
    const idToMove = r1obj?.id ?? null;
    const reorderRes = await fetch('http://127.0.0.1:8787/api/admin/subjects/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ id: idToMove, afterRank: r2obj?.rank ?? undefined }),
    });
    expect(reorderRes.status).toBe(200);
    const body = await reorderRes.json();
    expect(body).toHaveProperty('newRank');

    // topics reorder: create subject+topics
    const tr = await fetch('http://127.0.0.1:8787/api/admin/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'TRS' }),
    });
    expect(tr.status).toBe(201);
    const subj = await findSubject('TRS');
    const subjId = subj?.id ?? null;
    // topics were created via admin endpoints above
    const t1 = await fetch('http://127.0.0.1:8787/api/admin/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 't1', subjectId: subjId }),
    });
    expect(t1.status).toBe(201);
    const t2 = await fetch('http://127.0.0.1:8787/api/admin/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 't2', subjectId: subjId }),
    });
    expect(t2.status).toBe(201);
    const tObj = await findTopic(subjId, 't1');
    const tid = tObj?.id ?? null;
    const reorderRes2 = await fetch('http://127.0.0.1:8787/api/admin/topics/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ id: tid, afterRank: undefined }),
    });
    expect(reorderRes2.status).toBe(200);
    const b2 = await reorderRes2.json();
    expect(b2).toHaveProperty('newRank');
  });

  test('Authenticated admin can create, update, and delete article (GitHub mocked)', async () => {
    const cookie = await loginAndGetCookie();

    // create subject
    const subRes = await fetch('http://127.0.0.1:8787/api/admin/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'ArtSub' }),
    });
    expect(subRes.status).toBe(201);
    const subj = await findSubject('ArtSub');
    const subjectId = subj?.id ?? null;
    expect(subjectId).not.toBeNull();

    // create topic
    const topRes = await fetch('http://127.0.0.1:8787/api/admin/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'ArtTopic', subjectId }),
    });
    expect(topRes.status).toBe(201);
    const t = await findTopic(subjectId, 'ArtTopic');
    const topicId = t?.id ?? null;
    expect(topicId).not.toBeNull();

    // create article via admin (this should call mocked createGitHubFile)
    const artRes = await fetch('http://127.0.0.1:8787/api/admin/articles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-test-mock-gh': '1' },
      body: JSON.stringify({ title: 'MyArticle', topicId, content: '{"hello":"world"}' }),
    });
    if (artRes.status !== 201) {
      const err = await artRes.json().catch(() => ({ raw: 'non-json' }));
      console.error('Article create failed:', err);
      throw new Error('Article create failed: ' + JSON.stringify(err));
    }
    const created = await artRes.json();
    expect(created).toHaveProperty('filePath');

    // find article in DB
    const art = await findArticle(topicId, 'MyArticle');
    const articleId = art?.id ?? null;
    const filePath = art?.file_path ?? null;
    expect(articleId).not.toBeNull();
    expect(filePath).not.toBeNull();

    // update article via admin (should use mocked getFileSha + updateGitHubFile)
    const updRes = await fetch(`http://127.0.0.1:8787/api/admin/articles/${articleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-test-mock-gh': '1' },
      body: JSON.stringify({ title: 'MyArticle', topicId, content: '{"hello":"updated"}' }),
    });
    expect(updRes.status).toBe(200);

    // delete article via admin (should call mocked deleteGitHubFile)
    const delRes = await fetch(`http://127.0.0.1:8787/api/admin/articles/${articleId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie, 'x-test-mock-gh': '1' },
    });
    expect(delRes.status).toBe(200);
    const check = await runSql(`SELECT id FROM articles WHERE id = ${articleId} LIMIT 1;`);
    expect(check?.results?.length ?? 0).toBe(0);
  });
});
