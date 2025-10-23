// src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwtAuth, loginHandler, logoutHandler } from './auth';
import { createGitHubFile, deleteGitHubFile, getFileSha, updateGitHubFile } from './github';
import { Subject, Topic, Article } from './types';
import { LexoRank } from '@dalet-oss/lexorank';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for your front end
app.use(
  '*',
  cors({
    origin: '*', // ⚠️ CHANGE THIS TO YOUR FRONTEND URL IN PRODUCTION!
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['POST', 'GET', 'PUT', 'DELETE'],
    credentials: true,
  })
);

// --- Schemas for Validation ---
const SubjectSchema = z.object({ title: z.string().min(1) });
const TopicSchema = z.object({ title: z.string().min(1), subjectId: z.number().int() });
const ArticleSchema = z.object({
  title: z.string().min(1),
  topicId: z.number().int(),
  content: z.string().min(1),
});
const ReorderSchema = z.object({
  id: z.number().int(),
  beforeRank: z.string().optional(),
  afterRank: z.string().optional(),
});

// Helper function to calculate new LexoRank
const calculateNewRank = (
  beforeRank: string | undefined,
  afterRank: string | undefined
): LexoRank | undefined => {
  const rankBefore = beforeRank ? LexoRank.parse(beforeRank) : null;
  const rankAfter = afterRank ? LexoRank.parse(afterRank) : null;

  if (rankBefore && rankAfter) {
    return rankBefore.between(rankAfter);
  } else if (rankBefore) {
    return rankBefore.genPrev();
  } else if (rankAfter) {
    return rankAfter.genNext();
  }
  return undefined;
};

// ----------------------------------------
// --- Public API Routes (Read-Only) ---
// ----------------------------------------

// GET /api/subjects
app.get('/api/subjects', async (c) => {
  const { results } = await c.env.bodhak
    .prepare('SELECT id, title, rank FROM subjects ORDER BY rank ASC')
    .all<Subject>();
  return c.json(results);
});

// GET /api/subjects/:subjectId/topics
app.get('/api/subjects/:subjectId/topics', async (c) => {
  const { subjectId } = c.req.param();
  const { results } = await c.env.bodhak
    .prepare(
      'SELECT id, subject_id, title, rank FROM topics WHERE subject_id = ? ORDER BY rank ASC'
    )
    .bind(subjectId)
    .all<Topic>();
  return c.json(results);
});

// GET /api/topics/:topicId/articles
app.get('/api/topics/:topicId/articles', async (c) => {
  const { topicId } = c.req.param();
  const { results } = await c.env.bodhak
    .prepare(
      'SELECT id, topic_id, title, file_path, rank FROM articles WHERE topic_id = ? ORDER BY rank ASC'
    )
    .bind(topicId)
    .all<Article>();
  // If GitHub repo owner/name are configured in environment, convert stored file_path
  // into a raw GitHub URL so clients can fetch the article content directly.
  const owner = c.env.GITHUB_REPO_OWNER || '';
  const repo = c.env.GITHUB_REPO_NAME || '';
  const branch = c.env.GITHUB_REPO_BRANCH ?? 'master';

  const mapped = results.map((r) => {
    if (owner && repo && r.file_path) {
      // Ensure no leading slash on file_path
      const fp = r.file_path.replace(/^\/+/, '');
      return {
        ...r,
        file_path: `https://raw.githubusercontent.com/${owner}/${repo}/refs/heads/${branch}/${fp}`,
      };
    }
    return r;
  });

  return c.json(mapped);
});

// ----------------------------------------
// --- Admin API Routes (Protected) ---
// ----------------------------------------
app.post('/api/admin/login', loginHandler);
app.post('/api/admin/logout', logoutHandler);

// Apply JWT authentication middleware to all admin routes
app.use('/api/admin/*', async (c, next) => {
  return jwtAuth(c.env.JWT_SECRET)(c, next);
});

// --- Subject Admin Routes ---
app.post('/api/admin/subjects', zValidator('json', SubjectSchema), async (c) => {
  const { title } = c.req.valid('json');

  const { results } = await c.env.bodhak
    .prepare('SELECT rank FROM subjects ORDER BY rank DESC LIMIT 1')
    .all();
  const lastRank = results[0] ? LexoRank.parse((results[0] as { rank: string }).rank) : null;
  const newRank = lastRank ? lastRank.genNext() : LexoRank.middle();

  await c.env.bodhak
    .prepare('INSERT INTO subjects (title, rank) VALUES (?, ?)')
    .bind(title, newRank.toString())
    .run();

  return c.json({ message: 'Subject created', rank: newRank.toString() }, 201);
});

app.put('/api/admin/subjects/:id', zValidator('json', SubjectSchema), async (c) => {
  const { id } = c.req.param();
  const { title } = c.req.valid('json');
  await c.env.bodhak.prepare('UPDATE subjects SET title = ? WHERE id = ?').bind(title, id).run();
  return c.json({ message: 'Subject updated' });
});

app.post('/api/admin/subjects/reorder', zValidator('json', ReorderSchema), async (c) => {
  const { id, beforeRank, afterRank } = c.req.valid('json');
  const newRank = calculateNewRank(beforeRank, afterRank);

  if (!newRank) return c.json({ error: 'Invalid reorder request' }, 400);

  await c.env.bodhak
    .prepare('UPDATE subjects SET rank = ? WHERE id = ?')
    .bind(newRank.toString(), id)
    .run();
  return c.json({ message: 'Subject reordered', newRank: newRank.toString() });
});

app.delete('/api/admin/subjects/:id', async (c) => {
  const { id } = c.req.param();
  await c.env.bodhak.prepare('DELETE FROM subjects WHERE id = ?').bind(id).run();
  return c.json({ message: 'Subject deleted' });
});

// --- Topic Admin Routes ---
app.post('/api/admin/topics', zValidator('json', TopicSchema), async (c) => {
  const { title, subjectId } = c.req.valid('json');

  const { results } = await c.env.bodhak
    .prepare('SELECT rank FROM topics WHERE subject_id = ? ORDER BY rank DESC LIMIT 1')
    .bind(subjectId)
    .all();
  const lastRank = results[0] ? LexoRank.parse((results[0] as { rank: string }).rank) : null;
  const newRank = lastRank ? lastRank.genNext() : LexoRank.middle();

  await c.env.bodhak
    .prepare('INSERT INTO topics (title, subject_id, rank) VALUES (?, ?, ?)')
    .bind(title, subjectId, newRank.toString())
    .run();
  return c.json({ message: 'Topic created', rank: newRank.toString() }, 201);
});

app.put('/api/admin/topics/:id', zValidator('json', TopicSchema), async (c) => {
  const { id } = c.req.param();
  const { title, subjectId } = c.req.valid('json');
  await c.env.bodhak
    .prepare('UPDATE topics SET title = ?, subject_id = ? WHERE id = ?')
    .bind(title, subjectId, id)
    .run();
  return c.json({ message: 'Topic updated' });
});

app.post('/api/admin/topics/reorder', zValidator('json', ReorderSchema), async (c) => {
  const { id, beforeRank, afterRank } = c.req.valid('json');
  const newRank = calculateNewRank(beforeRank, afterRank);

  if (!newRank) return c.json({ error: 'Invalid reorder request' }, 400);

  await c.env.bodhak
    .prepare('UPDATE topics SET rank = ? WHERE id = ?')
    .bind(newRank.toString(), id)
    .run();
  return c.json({ message: 'Topic reordered', newRank: newRank.toString() });
});

app.delete('/api/admin/topics/:id', async (c) => {
  const { id } = c.req.param();
  await c.env.bodhak.prepare('DELETE FROM topics WHERE id = ?').bind(id).run();
  return c.json({ message: 'Topic deleted' });
});

// --- Article Admin Routes (with GitHub) ---
app.post('/api/admin/articles', zValidator('json', ArticleSchema), async (c) => {
  const { title, topicId, content } = c.req.valid('json');

  const slug = title.replaceAll(/[^a-z0-9]/gi, '_').toLowerCase();
  const filePath = `articles/${slug}-${Date.now()}.json`;

  try {
    const useMockGH = c.req.header('x-test-mock-gh') === '1';
    // 1. Push content to GitHub (skip in tests when we set the test header)
    if (!useMockGH) {
      await createGitHubFile(c.env, filePath, content, `Added new article: ${title}`);
    }

    // 2. Insert metadata into D1 database
    const { results } = await c.env.bodhak
      .prepare('SELECT rank FROM articles WHERE topic_id = ? ORDER BY rank DESC LIMIT 1')
      .bind(topicId)
      .all();
    const lastRank = results[0] ? LexoRank.parse((results[0] as { rank: string }).rank) : null;
    const newRank = lastRank ? lastRank.genNext() : LexoRank.middle();

    await c.env.bodhak
      .prepare('INSERT INTO articles (title, topic_id, file_path, rank) VALUES (?, ?, ?, ?)')
      .bind(title, topicId, filePath, newRank.toString())
      .run();

    return c.json({ message: 'Article created', filePath, rank: newRank.toString() }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to create article: ${message}` }, 500);
  }
});

app.put('/api/admin/articles/:id', zValidator('json', ArticleSchema), async (c) => {
  const { id } = c.req.param();
  const { title, topicId, content } = c.req.valid('json');

  try {
    const firstRow = await c.env.bodhak
      .prepare('SELECT file_path FROM articles WHERE id = ?')
      .bind(id)
      .first<{ file_path: string }>();
    if (!firstRow) {
      return c.json({ error: 'Article not found.' }, 404);
    }
    const filePath = firstRow.file_path;

    // 1. Get SHA for the existing file to update it.
    const useMockGH = c.req.header('x-test-mock-gh') === '1';
    let fileSha: string | null = null;
    if (!useMockGH) {
      fileSha = (await getFileSha(c.env, filePath)) ?? null;
      if (!fileSha) return c.json({ error: 'GitHub file not found for article.' }, 404);

      // 2. Update the file on GitHub
      await updateGitHubFile(c.env, filePath, content, `Updated article: ${title}`, fileSha);
    }

    // 3. Update the D1 database
    await c.env.bodhak
      .prepare('UPDATE articles SET title = ?, topic_id = ? WHERE id = ?')
      .bind(title, topicId, id)
      .run();
    return c.json({ message: 'Article updated' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to update article: ${message}` }, 500);
  }
});

app.post('/api/admin/articles/reorder', zValidator('json', ReorderSchema), async (c) => {
  const { id, beforeRank, afterRank } = c.req.valid('json');
  const newRank = calculateNewRank(beforeRank, afterRank);

  if (!newRank) return c.json({ error: 'Invalid reorder request' }, 400);

  await c.env.bodhak
    .prepare('UPDATE articles SET rank = ? WHERE id = ?')
    .bind(newRank.toString(), id)
    .run();
  return c.json({ message: 'Article reordered', newRank: newRank.toString() });
});

app.delete('/api/admin/articles/:id', async (c) => {
  const { id } = c.req.param();

  try {
    const firstRow = await c.env.bodhak
      .prepare('SELECT file_path FROM articles WHERE id = ?')
      .bind(id)
      .first<{ file_path: string }>();
    if (!firstRow) {
      return c.json({ error: 'Article record not found.' }, 404);
    }
    const filePath = firstRow.file_path;

    // 1. Get the file SHA to delete the file from GitHub
    const useMockGH = c.req.header('x-test-mock-gh') === '1';
    if (!useMockGH) {
      const fileSha = await getFileSha(c.env, filePath);
      if (fileSha) {
        await deleteGitHubFile(c.env, filePath, fileSha, 'Deleted article');
      }
    }

    // 2. Delete the record from D1 database
    await c.env.bodhak.prepare('DELETE FROM articles WHERE id = ?').bind(id).run();

    return c.json({ message: 'Article deleted' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to delete article: ${message}` }, 500);
  }
});

export default app;

// Export helper for unit tests
export { calculateNewRank };
