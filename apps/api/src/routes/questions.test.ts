import { describe, expect, it } from 'vitest';
import { normalizeQuestionAnswer, normalizeImageUrl } from './questions.js';

const mcq = (options: string[] | undefined, correct_answer: string) =>
  normalizeQuestionAnswer({ question_type: 'mcq', options, correct_answer });
const tf = (correct_answer: string) =>
  normalizeQuestionAnswer({ question_type: 'true_false', options: undefined, correct_answer });

describe('normalizeQuestionAnswer', () => {
  it('accepts an MCQ answer that is one of the options', () => {
    expect(mcq(['Alpha', 'Beta', 'Gamma'], 'Beta')).toEqual({ ok: true, correct_answer: 'Beta' });
  });

  it('rejects an MCQ answer that is not one of the options', () => {
    const r = mcq(['Alpha', 'Beta'], 'Zeta');
    expect(r).toEqual({ ok: false, error: 'Correct answer must be one of the options' });
  });

  it('rejects an MCQ answer that only matches after trimming', () => {
    // A student submits the stored option verbatim, so " Beta " could never be answered.
    expect(mcq(['Alpha', ' Beta'], 'Beta').ok).toBe(false);
  });

  it('rejects an MCQ with no options at all', () => {
    expect(mcq(undefined, 'Beta')).toEqual({ ok: false, error: 'options are required for MCQ questions' });
  });

  it('rejects an MCQ with a single option, which is not a question', () => {
    expect(mcq(['Only'], 'Only').ok).toBe(false);
  });

  it('accepts true and false for a true_false question', () => {
    expect(tf('true')).toEqual({ ok: true, correct_answer: 'true' });
    expect(tf('false')).toEqual({ ok: true, correct_answer: 'false' });
  });

  it('lowercases a true_false answer so a student can actually match it', () => {
    // Stored verbatim it used to read "TRUE" while the option list is ['true','false'].
    expect(tf('TRUE')).toEqual({ ok: true, correct_answer: 'true' });
    expect(tf('False')).toEqual({ ok: true, correct_answer: 'false' });
  });

  it('rejects a true_false answer that is neither true nor false', () => {
    expect(tf('banana')).toEqual({ ok: false, error: 'Correct answer must be true or false' });
    expect(tf('1')).toEqual({ ok: false, error: 'Correct answer must be true or false' });
  });

  it('ignores options supplied to a true_false question instead of trusting them', () => {
    const r = normalizeQuestionAnswer({
      question_type: 'true_false', options: ['Alpha', 'Beta'], correct_answer: 'true',
    });
    expect(r).toEqual({ ok: true, correct_answer: 'true' });
  });
});

// image_url is rendered as <img src> on the student runner with no token, so a value that
// is not a path this API itself minted is both a rendering risk and a way to point a
// student's exam at a third-party host. The upload route answers with exactly
// /uploads/images/<uuid>.<ext>, and nothing else may be stored.
const GOOD = '/uploads/images/6f1c2a80-1111-4222-8333-444455556666.png';
const img = (value: string | null | undefined) => normalizeImageUrl(value);

describe('normalizeImageUrl', () => {
  it('accepts the path the upload route returns', () => {
    expect(img(GOOD)).toEqual({ ok: true, image_url: GOOD });
  });

  it('accepts each sniffed image extension', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp']) {
      expect(img(`/uploads/images/6f1c2a80-1111-4222-8333-444455556666.${ext}`).ok).toBe(true);
    }
  });

  it('accepts null and undefined as "no image"', () => {
    expect(img(null)).toEqual({ ok: true, image_url: null });
    expect(img(undefined)).toEqual({ ok: true, image_url: null });
  });

  it('accepts an empty string as "no image"', () => {
    expect(img('')).toEqual({ ok: true, image_url: null });
  });

  it('rejects a javascript: URL', () => {
    const r = img('javascript:alert(1)');
    expect(r.ok).toBe(false);
  });

  it('rejects a data: URL carrying markup', () => {
    expect(img('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==').ok).toBe(false);
  });

  it('rejects an absolute URL to another host', () => {
    // A TA or doctor pointing every student's exam at an external tracker.
    expect(img('https://evil.example/beacon.png').ok).toBe(false);
  });

  it('rejects a protocol-relative URL', () => {
    expect(img('//evil.example/beacon.png').ok).toBe(false);
  });

  it('rejects a traversal out of the uploads directory', () => {
    expect(img('/uploads/images/../../.env').ok).toBe(false);
    expect(img('/uploads/../images/6f1c2a80-1111-4222-8333-444455556666.png').ok).toBe(false);
  });

  it('rejects any other path on this origin', () => {
    expect(img('/api/v1/admin/users').ok).toBe(false);
    expect(img('/uploads/images/').ok).toBe(false);
  });

  it('rejects an allowed directory with a non-image extension', () => {
    // The upload route can only ever write a sniffed extension, so .html here means the
    // value did not come from the upload route.
    expect(img('/uploads/images/6f1c2a80-1111-4222-8333-444455556666.html').ok).toBe(false);
    expect(img('/uploads/images/6f1c2a80-1111-4222-8333-444455556666.svg').ok).toBe(false);
  });

  it('rejects a filename that is not a uuid', () => {
    expect(img('/uploads/images/anything.png').ok).toBe(false);
    expect(img('/uploads/images/6f1c2a80.png').ok).toBe(false);
  });

  it('rejects a filename that is a uuid but with no extension', () => {
    expect(img('/uploads/images/6f1c2a80-1111-4222-8333-444455556666').ok).toBe(false);
  });

  it('rejects an upper-case extension rather than normalising it silently', () => {
    // accept() is case-insensitive, so this is the one shape that could slip through a
    // naive suffix check and land as an unknown content type on the static mount.
    expect(img('/uploads/images/6f1c2a80-1111-4222-8333-444455556666.PNG').ok).toBe(false);
  });

  it('names the reason so a doctor can tell a typo from a policy refusal', () => {
    const r = img('https://evil.example/beacon.png');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toContain('/uploads/images/');
  });
});
