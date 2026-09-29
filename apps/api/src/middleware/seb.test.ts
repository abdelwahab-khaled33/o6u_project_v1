import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

const { prisma, envRef } = vi.hoisted(() => ({
  prisma: { exam: { findUnique: vi.fn() } },
  envRef: {
    sebKeys: [] as string[],
    nodeEnv: 'development',
  },
}));

vi.mock('../lib/prisma.js', () => ({ prisma }));
vi.mock('../config/env.js', () => ({
  env: {
    get sebKeys() {
      return envRef.sebKeys;
    },
    get nodeEnv() {
      return envRef.nodeEnv;
    },
  },
}));

import express from 'express';
import request from 'supertest';
import { requireSeb } from './seb.js';

const EXAM = '11111111-1111-4111-8111-111111111111';
const KEY = 'browser-exam-key';
const URL_PATH = `/api/v1/student/exams/${EXAM}/answer`;
// computeRequestUrl rebuilds the absolute URL from the Host header, so the digest has to
// be built from the same one. Left unset, supertest sends 127.0.0.1:<random port>.
const HOST = '127.0.0.1';

const digestFor = (key: string) =>
  crypto.createHash('sha256').update(`http://${HOST}${URL_PATH}${key}`).digest('hex');

const app = express();
app.use(express.json());
app.all('/api/v1/student/exams/:examId/answer', requireSeb, (_req, res) => {
  res.json({ ok: true });
});

beforeEach(() => {
  prisma.exam.findUnique.mockReset().mockResolvedValue({ type: 'doctor_exam' });
  envRef.sebKeys = [KEY];
  envRef.nodeEnv = 'development';
});

describe('requireSeb', () => {
  it('accepts the correct request hash', async () => {
    const res = await request(app)
      .get(URL_PATH)
      .set('Host', HOST)
      .set('X-SafeExamBrowser-RequestHash', digestFor(KEY));

    expect(res.status).toBe(200);
  });

  it('rejects a hash that is right except for its last character', async () => {
    const good = digestFor(KEY);
    const bad = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0');

    const res = await request(app)
      .get(URL_PATH)
      .set('Host', HOST)
      .set('X-SafeExamBrowser-RequestHash', bad);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('SEB_REQUIRED');
  });

  it('rejects a missing header', async () => {
    const res = await request(app).get(URL_PATH).set('Host', HOST);
    expect(res.status).toBe(403);
  });

  it('rejects a truncated hash without throwing', async () => {
    const res = await request(app)
      .get(URL_PATH)
      .set('Host', HOST)
      .set('X-SafeExamBrowser-RequestHash', digestFor(KEY).slice(0, 10));

    expect(res.status).toBe(403);
  });

  it('compares the digest in constant time', async () => {
    // The status assertions above all pass with `===` as well, so on their own they pin
    // nothing. This is the one that does: the comparison must reach timingSafeEqual.
    const spy = vi.spyOn(crypto, 'timingSafeEqual');

    await request(app)
      .get(URL_PATH)
      .set('Host', HOST)
      .set('X-SafeExamBrowser-RequestHash', digestFor(KEY));

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('still compares in constant time for a rejected hash', async () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');

    await request(app)
      .get(URL_PATH)
      .set('Host', HOST)
      .set('X-SafeExamBrowser-RequestHash', digestFor(KEY).replace(/^./, '0'));

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('lets a TA quiz through without a SEB header', async () => {
    prisma.exam.findUnique.mockResolvedValue({ type: 'ta_quiz' });

    const res = await request(app).get(URL_PATH).set('Host', HOST);

    expect(res.status).toBe(200);
  });
});
