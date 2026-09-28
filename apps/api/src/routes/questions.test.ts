import { describe, expect, it } from 'vitest';
import { normalizeQuestionAnswer } from './questions.js';

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
