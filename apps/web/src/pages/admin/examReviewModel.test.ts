import { describe, expect, it } from 'vitest';

import {
  answerabilityProblem,
  buildAdminEditBody,
  formatReviewGrade,
  toIsoOrNull,
  toLocalInputValue,
} from './examReviewModel';

const mcq = (over: Record<string, unknown> = {}) => ({
  id: 'q1',
  text: 'What is 2+2?',
  question_type: 'mcq',
  difficulty: 'easy',
  options: ['3', '4', '5'],
  correct_answer: '4',
  grade: '2.00',
  image_url: null,
  is_archived: false,
  ...over,
});

describe('answerabilityProblem', () => {
  it('accepts an MCQ whose answer is literally one of its options', () => {
    expect(answerabilityProblem(mcq())).toBeNull();
  });

  it('names an MCQ whose answer is outside its options', () => {
    const problem = answerabilityProblem(mcq({ correct_answer: 'Zeta' }));
    expect(problem).not.toBeNull();
    expect(problem as string).toContain('Zeta');
  });

  it('accepts a true/false answer in either case', () => {
    expect(answerabilityProblem(mcq({ question_type: 'true_false', correct_answer: 'true' }))).toBeNull();
    expect(answerabilityProblem(mcq({ question_type: 'true_false', correct_answer: 'FALSE' }))).toBeNull();
  });

  it('refuses a true/false answer that is neither boolean', () => {
    expect(answerabilityProblem(mcq({ question_type: 'true_false', correct_answer: 'maybe' }))).not.toBeNull();
  });

  it('names an archived question before any answer check', () => {
    const problem = answerabilityProblem(mcq({ is_archived: true, correct_answer: 'Zeta' }));
    expect(problem as string).toMatch(/archiv/i);
  });
});

describe('toIsoOrNull', () => {
  it('converts a datetime-local value to an ISO instant', () => {
    expect(toIsoOrNull('2026-10-05T09:00')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/);
  });

  it('returns null for a blank or unparseable value instead of sending garbage', () => {
    expect(toIsoOrNull('')).toBeNull();
    expect(toIsoOrNull('not-a-date')).toBeNull();
  });
});

describe('toLocalInputValue', () => {
  // The edit form pre-fills from the stored ISO instant. A datetime-local input only renders
  // YYYY-MM-DDTHH:MM, so the stored seconds are cut rather than shown shifted or rejected.
  it('trims a stored instant to the sixteen characters the input renders', () => {
    // Asserted in local terms, never absolute: 09:00Z is noon on a UTC+3 machine, so a
    // hardcoded wall time would pass here and fail anywhere else.
    const rendered = toLocalInputValue('2026-09-29T09:00:00.000Z');
    expect(rendered).toHaveLength(16);
    expect(toIsoOrNull(rendered)).toBe('2026-09-29T09:00:00.000Z');
  });

  it('returns a blank for a missing or unparseable stored value', () => {
    expect(toLocalInputValue(null)).toBe('');
    expect(toLocalInputValue('not-a-date')).toBe('');
  });
});

describe('formatReviewGrade', () => {
  it('renders a stored decimal with two digits', () => {
    expect(formatReviewGrade('2.00')).toBe('2.00');
    expect(formatReviewGrade(1.5)).toBe('1.50');
  });
});

describe('buildAdminEditBody', () => {
  it('sends only the fields the admin changed, with datetimes as ISO instants', () => {
    const body = buildAdminEditBody({
      title: 'New title',
      startTime: '2026-10-05T09:00',
      endTime: '',
      durationMinutes: '',
      pointsPerQuestion: '',
    });
    expect(body.title).toBe('New title');
    expect(body.start_time).toMatch(/2026-10-05T/);
    expect(body).not.toHaveProperty('end_time');
    expect(body).not.toHaveProperty('duration_minutes');
    expect(body).not.toHaveProperty('points_per_question');
  });

  it('sends numeric fields as numbers', () => {
    const body = buildAdminEditBody({
      title: '',
      startTime: '',
      endTime: '',
      durationMinutes: '90',
      pointsPerQuestion: '2.5',
    });
    expect(body).toEqual({ duration_minutes: 90, points_per_question: 2.5 });
  });

  it('sends nothing when nothing changed', () => {
    expect(buildAdminEditBody({ title: '', startTime: '', endTime: '', durationMinutes: '', pointsPerQuestion: '' })).toEqual({});
  });
});
