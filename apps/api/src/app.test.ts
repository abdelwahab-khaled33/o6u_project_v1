import { describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) },
}));

vi.mock('./lib/prisma.js', () => ({ prisma }));

import request from 'supertest';
import { createApp } from './app.js';

const app = createApp();

describe('app error handling', () => {
  it('answers a malformed JSON body with 400, not 500', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"username":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Malformed request body' });
  });

  it('does not echo the submitted body back in the error', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"password":"s3cret-not-valid-json');

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('s3cret-not-valid-json');
  });

  it('still serves the health route', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
  });

  it('still answers 401 for a protected route with no token', async () => {
    const res = await request(app).get('/api/v1/subjects');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required' });
  });
});

describe('unknown routes', () => {
  // Express's default 404 is an HTML page built from the request path, which the typed
  // JSON client cannot parse, and which reflects attacker-controlled text back into a
  // browser. The API surface is JSON everywhere else, so 404 belongs there too.
  it('answers an unknown API path with JSON, not HTML', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.type).toBe('application/json');
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('answers an unknown method on a known path with JSON', async () => {
    const res = await request(app).delete('/api/v1/health');

    expect(res.status).toBe(404);
    expect(res.type).toBe('application/json');
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('does not reflect the requested path into the body', async () => {
    const res = await request(app).get('/api/v1/<script>alert(1)</script>');

    expect(res.status).toBe(404);
    expect(res.text).not.toContain('<script>');
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('still 401s rather than 404s on a protected path with no token', async () => {
    // The 404 handler is terminal, so it must not be reachable before the routers run.
    const res = await request(app).get('/api/v1/exams/11111111-1111-4111-8111-111111111111');
    expect(res.status).toBe(401);
  });
});
