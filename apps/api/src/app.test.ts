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
