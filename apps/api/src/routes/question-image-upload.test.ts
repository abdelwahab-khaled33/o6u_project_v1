import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const { prisma, authRef } = vi.hoisted(() => ({
  authRef: { current: null as { userId: string; role: string } | null },
  prisma: {
    question: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    subject: { findMany: vi.fn() },
    section: { count: vi.fn() },
    doctorAssignment: { count: vi.fn() },
  },
}));

vi.mock('../lib/prisma.js', () => ({ prisma }));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: { auth?: unknown }, _res: unknown, next: () => void) => {
    req.auth = authRef.current;
    next();
  },
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import express from 'express';
import request from 'supertest';
import { resolveErrorResponse } from '../lib/http-error.js';
import { questionBankRouter } from './questions.js';

const app = express();
app.use(express.json());
app.use('/question-bank', questionBankRouter);
// The real error handler, copied from app.ts rather than mocked: multer rejects a bad
// upload by throwing, and Express 4 does not catch a thrown middleware error, so without
// this the request would hang rather than answer. Mounting it here is what makes the
// upload-failure cases below observable at all.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const { status, body } = resolveErrorResponse(err);
  res.status(status).json(body);
});

const uploadDir = path.resolve(process.cwd(), 'uploads', 'images');
const DOCTOR = 'doc-1';

const html = Buffer.from('<!DOCTYPE html><script>alert(document.domain)</script>');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const stored = () =>
  readdirSync(uploadDir).filter((n) => /\.(html?|svg|php|cjs|mjs)$/i.test(n));

beforeEach(() => {
  authRef.current = { userId: DOCTOR, role: 'doctor' };
  prisma.doctorAssignment.count.mockReset().mockResolvedValue(1);
});

describe('POST /question-bank/images', () => {
  it('refuses HTML bytes uploaded as evil.html with a declared image/png', async () => {
    // This is the stored-XSS shape: the multipart part's Content-Type and the filename
    // are both chosen by the client, so the old allowlist-on-declared-type plus
    // extension-from-originalname stored a .html that /uploads served as text/html from
    // the API origin, with no token required to read it back.
    const res = await request(app)
      .post('/question-bank/images')
      .attach('image', html, { filename: 'evil.html', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Only PNG/JPEG/WEBP/GIF images are allowed' });
    expect(stored()).toEqual([]);
  });

  it('refuses an SVG uploaded as evil.svg with a declared image/png', async () => {
    const res = await request(app)
      .post('/question-bank/images')
      .attach('image', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), {
        filename: 'evil.svg',
        contentType: 'image/png',
      });

    expect(res.status).toBe(400);
    expect(stored()).toEqual([]);
  });

  it('stores a real image under a .png extension even when the filename says .html', async () => {
    const before = new Set(readdirSync(uploadDir));
    const res = await request(app)
      .post('/question-bank/images')
      .attach('image', png, { filename: 'evil.html', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.imageUrl).toMatch(/^\/uploads\/images\/[0-9a-f-]{36}\.png$/);
    const added = readdirSync(uploadDir).filter((n) => !before.has(n));
    for (const name of added) rmSync(path.join(uploadDir, name), { force: true });
  });

  it('ignores the declared Content-Type entirely, so a lying client gains nothing', async () => {
    const res = await request(app)
      .post('/question-bank/images')
      .attach('image', png, { filename: 'ok.png', contentType: 'text/html' });

    // The bytes are a PNG, so this is accepted: the point is that the declared type is
    // no longer what decides, in either direction.
    expect(res.status).toBe(201);
    const name = path.basename(res.body.imageUrl as string);
    rmSync(path.join(uploadDir, name), { force: true });
  });

  it('never writes a path-traversing filename to disk', async () => {
    const before = new Set(readdirSync(uploadDir));
    const res = await request(app)
      .post('/question-bank/images')
      .attach('image', png, { filename: '../../../../apps/api/.env.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    const name = path.basename(res.body.imageUrl as string);
    expect(name).toMatch(/^[0-9a-f-]{36}\.png$/);
    for (const added of readdirSync(uploadDir).filter((n) => !before.has(n))) {
      rmSync(path.join(uploadDir, added), { force: true });
    }
  });
});

describe('uploads directory', () => {
  it('holds no file with a script-capable extension left over from a probe', () => {
    expect(stored()).toEqual([]);
  });
});

// A multer rejection is a client mistake, and it used to reach the client as a 500 --
// which tells the caller the server broke and gives them nothing to act on. These are
// driven through the real route because a green test on resolveErrorResponse alone would
// not show that the thrown MulterError actually reaches it.
describe('a rejected upload is the caller’s fault, and says so', () => {
  it('answers 400 when the file is posted under the wrong field name', async () => {
    const res = await request(app)
      .post('/question-bank/images')
      .attach('file', png, { filename: 'ok.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/field name/i);
  });

  it('answers 413 for a file past the size limit, which is a different fix', async () => {
    const oversize = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await request(app)
      .post('/question-bank/images')
      .attach('image', oversize, { filename: 'big.png', contentType: 'image/png' });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/i);
  });

  it('still accepts the same file under the right field name, so the refusals are not the route', async () => {
    const res = await request(app)
      .post('/question-bank/images')
      .attach('image', png, { filename: 'ok.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    rmSync(path.join(uploadDir, path.basename(res.body.imageUrl as string)), { force: true });
  });
});

// A green test on sniffImage alone would still pass while the route kept trusting
// req.file.originalname, which is the shape of bug this project has hit repeatedly. So
// every script-capable extension is driven through the real route, and the claim is
// about what lands on disk, not about what the source text says.
describe('every script-capable extension is refused at the route', () => {
  it.each(['evil.html', 'evil.htm', 'evil.svg', 'evil.xhtml', 'evil.php', 'evil.svgz'])(
    'writes no file for %s carrying HTML or SVG bytes',
    async (filename) => {
      const res = await request(app)
        .post('/question-bank/images')
        .attach('image', html, { filename, contentType: 'image/png' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Only PNG/JPEG/WEBP/GIF images are allowed' });
      expect(stored()).toEqual([]);
    },
  );

  it('stores the same bytes as a .png when the name is harmless, proving the extension came from the content', async () => {
    const before = new Set(readdirSync(uploadDir));
    const res = await request(app)
      .post('/question-bank/images')
      .attach('image', html, { filename: 'notes.txt', contentType: 'text/plain' });

    // HTML bytes are not an image whatever the name says, so this must be refused too --
    // the acceptlist is on the bytes, not on a blocklist of extensions.
    expect(res.status).toBe(400);
    expect(readdirSync(uploadDir).filter((n) => !before.has(n))).toEqual([]);
  });
});
