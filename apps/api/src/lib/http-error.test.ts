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
