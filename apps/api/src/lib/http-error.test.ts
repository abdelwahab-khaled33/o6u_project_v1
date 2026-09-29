import { describe, expect, it } from 'vitest';
import { resolveErrorResponse } from './http-error.js';

describe('resolveErrorResponse', () => {
  it('keeps a 5xx as a server fault and never leaks the internal message', () => {
    const res = resolveErrorResponse(new Error('connection string user:hunter2@db exploded'));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal Server Error' });
  });

  it('honours a statusCode thrown by a service instead of flattening it to 500', () => {
    const res = resolveErrorResponse(Object.assign(new Error('Exam not found'), { statusCode: 404 }));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Exam not found' });
  });

  it('honours a 4xx statusCode the way it honours statusCode 404', () => {
    const res = resolveErrorResponse(Object.assign(new Error('points is required'), { statusCode: 400 }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'points is required' });
  });

  it('falls back to the http-errors status property when there is no statusCode', () => {
    const res = resolveErrorResponse(Object.assign(new Error('Conflict'), { status: 409 }));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Conflict' });
  });

  it('replaces the body-parser parse message, which echoes the raw request body', () => {
    const res = resolveErrorResponse(
      Object.assign(new Error("Unexpected token n in JSON at position 1: '{not json'"), {
        status: 400,
        type: 'entity.parse.failed',
      }),
    );
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Malformed request body' });
  });

  it('does not echo the body for other body-parser failures either', () => {
    const res = resolveErrorResponse(
      Object.assign(new Error('request entity too large: the secret admin token'), {
        status: 413,
        type: 'entity.too.large',
      }),
    );
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Malformed request body' });
  });

  it('never answers a non-4xx status from an error handler', () => {
    // A thrown error must not be able to make the API claim success.
    expect(resolveErrorResponse(Object.assign(new Error('nope'), { statusCode: 200 })).status).toBe(500);
    expect(resolveErrorResponse(Object.assign(new Error('nope'), { statusCode: 302 })).status).toBe(500);
  });

  it('ignores a non-numeric status instead of trusting it', () => {
    const res = resolveErrorResponse(Object.assign(new Error('weird'), { statusCode: '404' }));
    expect(res.status).toBe(500);
  });

  it('stays a server fault for a 5xx statusCode so it is still logged', () => {
    const res = resolveErrorResponse(Object.assign(new Error('db down'), { statusCode: 503 }));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal Server Error' });
  });

  it('survives a thrown value that is not an Error at all', () => {
    expect(resolveErrorResponse(undefined).status).toBe(500);
    expect(resolveErrorResponse('just a string').status).toBe(500);
    expect(resolveErrorResponse(null).status).toBe(500);
  });

  it('still returns a usable message for a 4xx that carries none', () => {
    const res = resolveErrorResponse({ statusCode: 400 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad Request' });
  });
});

// ---------------------------------------------------------------------------
// A multipart upload rejected by multer is the client's fault in every case: the
// wrong field name, no file, or a file past the size limit. multer throws a
// MulterError with a `code` and no status, so before this it arrived here as an
// untyped error and every one of them was answered 500 -- a client sending a
// correctly-formed request to the wrong field was told the server had broken.
// ---------------------------------------------------------------------------
describe('resolveErrorResponse with multer upload errors', () => {
  const multerError = (code: string, message: string) =>
    Object.assign(new Error(message), { name: 'MulterError', code });

  it('answers 400 for an unexpected file field instead of a 500', () => {
    const res = resolveErrorResponse(multerError('LIMIT_UNEXPECTED_FILE', 'Unexpected file field'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/file field|field name/i);
  });

  it('names the field the caller actually used, so the mismatch is actionable', () => {
    const res = resolveErrorResponse(
      multerError('LIMIT_UNEXPECTED_FILE', 'Unexpected field'),
    );
    expect(res.body.error).not.toBe('');
    expect(res.body.error).not.toMatch(/Unexpected field$/);
  });

  it('answers 400 when no file was sent at all', () => {
    const res = resolveErrorResponse(multerError('LIMIT_UNEXPECTED_FILE', 'No file'));
    expect(res.status).toBe(400);
  });

  it('answers 413 for a file past the size limit, which is a different fix for the caller', () => {
    const res = resolveErrorResponse(multerError('LIMIT_FILE_SIZE', 'File too large'));
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/i);
  });

  it('never answers 500 for any multer code', () => {
    // The point of the mapping: these are all client mistakes, and a 500 hides that.
    for (const code of ['LIMIT_UNEXPECTED_FILE', 'LIMIT_FILE_SIZE', 'LIMIT_PART_COUNT', 'LIMIT_FIELD_KEY', 'LIMIT_FIELD_VALUE']) {
      expect(resolveErrorResponse(multerError(code, 'whatever')).status).toBeLessThan(500);
    }
  });

  it('does not echo the raw multer message, which carries the filename back', () => {
    const res = resolveErrorResponse(
      multerError('LIMIT_UNEXPECTED_FILE', 'Unexpected file field. Got "file" but expected "image"'),
    );
    expect(res.body.error).not.toMatch(/Got "file"/);
  });

  it('leaves an ordinary error untouched -- the name check must not catch everything', () => {
    // A service that happened to set code: 'LIMIT_FILE_SIZE' on its own error object
    // must not be mistaken for multer. Only the MulterError name counts.
    const impostor = Object.assign(new Error('db down'), { code: 'LIMIT_FILE_SIZE' });
    expect(resolveErrorResponse(impostor).status).toBe(500);
  });
});
