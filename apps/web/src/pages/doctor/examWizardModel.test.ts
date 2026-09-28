import { describe, it, expect } from 'vitest';
import {
  buildExamPayload,
  checkPoolSufficiency,
  isoToLocal,
  localToIso,
  mixTotal,
  wizardProblems,
  type DifficultyMix,
  type PoolQuestion,
  type WizardForm,
} from './examWizardModel';

const MIX: DifficultyMix = { easy: 2, medium: 1, hard: 1 };

function question(id: string, difficulty: PoolQuestion['difficulty']): PoolQuestion {
  return { id, difficulty };
}

function pool(...entries: PoolQuestion[]): PoolQuestion[] {
  return entries;
}

function form(overrides: Partial<WizardForm> = {}): WizardForm {
  return {
    subjectId: 'subject-1',
    title: 'Compiler final',
    poolIds: ['q1', 'q2', 'q3', 'q4'],
    mix: MIX,
    pointsPerQuestion: '2',
    durationMinutes: '60',
    startLocal: '2026-10-01T09:00',
    endLocal: '2026-10-01T11:00',
    targetScope: 'subject',
    targetSectionIds: [],
    targetStudentIds: [],
    ...overrides,
  };
}

describe('checkPoolSufficiency', () => {
  it('accepts a pool that covers every requested tier', () => {
    const result = checkPoolSufficiency(
      pool(question('a', 'easy'), question('b', 'easy'), question('c', 'medium'), question('d', 'hard')),
      MIX,
    );
    expect(result).toEqual({ ok: true });
  });

  it('uses the server wording so the button and the 400 agree', () => {
    const result = checkPoolSufficiency(pool(question('a', 'easy'), question('b', 'easy')), MIX);
    expect(result).toEqual({
      ok: false,
      error: 'Pool has only 0 medium question(s) but 1 are required',
    });
  });

  it('ignores a tier that requests nothing', () => {
    const result = checkPoolSufficiency(pool(question('a', 'easy'), question('b', 'medium')), {
      easy: 2,
      medium: 0,
      hard: 0,
    });
    expect(result).toEqual({
      ok: false,
      error: 'Pool has only 1 easy question(s) but 2 are required',
    });
  });
});

describe('localToIso', () => {
  it('converts a datetime-local value the way the server requires', () => {
    const iso = localToIso('2026-10-01T09:00');
    expect(iso).not.toBeNull();
    expect(new Date(iso as string).toISOString()).toBe(iso);
  });

  it('rejects the empty string and a nonsense value', () => {
    expect(localToIso('')).toBeNull();
    expect(localToIso('not-a-date')).toBeNull();
  });
});

describe('isoToLocal', () => {
  it('round-trips a datetime-local value through the ISO form', () => {
    const local = '2026-10-01T09:00';
    expect(isoToLocal(new Date(local).toISOString())).toBe(local);
  });

  it('returns the empty string for a missing timestamp', () => {
    expect(isoToLocal(null)).toBe('');
  });
});

describe('wizardProblems', () => {
  const bank = pool(
    question('q1', 'easy'),
    question('q2', 'easy'),
    question('q3', 'medium'),
    question('q4', 'hard'),
  );

  it('accepts a complete form', () => {
    expect(wizardProblems(form(), bank)).toEqual([]);
  });

  it('requires a subject', () => {
    expect(wizardProblems(form({ subjectId: '' }), bank)).toContain('Choose the subject this exam belongs to.');
  });

  it('enforces the title bounds the API declares', () => {
    expect(wizardProblems(form({ title: 'a' }), bank)).toContain('Title must be at least 2 characters.');
    expect(wizardProblems(form({ title: 'x'.repeat(151) }), bank)).toContain('Title must be 150 characters or fewer.');
  });

  it('measures the trimmed title, not the raw one', () => {
    expect(wizardProblems(form({ title: '  Compiler final  ' }), bank)).toEqual([]);
  });

  it('requires at least one question in the pool', () => {
    expect(wizardProblems(form({ poolIds: [] }), bank)).toContain('Select at least one question for the pool.');
  });

  it('requires the difficulty mix to ask for something', () => {
    const problems = wizardProblems(form({ mix: { easy: 0, medium: 0, hard: 0 } }), bank);
    expect(problems).toContain('The difficulty mix must ask for at least one question.');
  });

  it('counts only the selected questions, never the whole bank', () => {
    const plenty = pool(
      question('q1', 'easy'),
      question('q3', 'medium'),
      question('q4', 'hard'),
      question('q9', 'medium'),
      question('q10', 'hard'),
    );
    const selected = form({ mix: { easy: 1, medium: 1, hard: 1 }, poolIds: ['q1'] });
    expect(wizardProblems(selected, plenty))
      .toContain('Pool has only 0 medium question(s) but 1 are required');
  });

  it('rejects a points value that is not a number at all', () => {
    expect(wizardProblems(form({ pointsPerQuestion: '' }), bank))
      .toContain('Points per question must be a number.');
  });

  it('rejects a points value below the smallest one the score column can hold', () => {
    // Exam.points_per_question is @db.Decimal(6, 2), so anything under 0.005 is stored as 0 and the
    // exam is silently worth nothing. Proven live: posting 0.001 answers 201 and reads back "0".
    // toContain on an array is strict membership, not a substring match, so the full sentence is
    // spelled out here rather than truncated at a word boundary.
    const outOfRange = 'Points per question must be between 0.01 and 9999.99.';
    expect(wizardProblems(form({ pointsPerQuestion: '0.001' }), bank)).toContain(outOfRange);
    expect(wizardProblems(form({ pointsPerQuestion: '0' }), bank)).toContain(outOfRange);
    expect(wizardProblems(form({ pointsPerQuestion: '-1' }), bank)).toContain(outOfRange);
  });

  it('rejects a points value the score column cannot hold, which the server answers 500', () => {
    // Proven live: posting 99999.99 answers 500 "Internal Server Error", because the Zod schema lets
    // the value through and the column then refuses it.
    expect(wizardProblems(form({ pointsPerQuestion: '99999.99' }), bank))
      .toContain('Points per question must be between 0.01 and 9999.99.');
  });

  it('accepts both ends of the range the score column can hold', () => {
    expect(wizardProblems(form({ pointsPerQuestion: '0.01' }), bank)).toEqual([]);
    expect(wizardProblems(form({ pointsPerQuestion: '9999.99' }), bank)).toEqual([]);
  });

  it('rejects a points value with more decimal places than the score column keeps', () => {
    // Proven live: posting 1.005 answers 201 and reads back "1.01", so the doctor is told one number
    // and the students are scored on another.
    const tooPrecise = 'Points per question is stored with 2 decimal places, so give it at most 2.';
    expect(wizardProblems(form({ pointsPerQuestion: '1.005' }), bank)).toContain(tooPrecise);
    expect(wizardProblems(form({ pointsPerQuestion: '2.345' }), bank)).toContain(tooPrecise);
  });

  it('accepts one or two decimal places, and a whole number', () => {
    expect(wizardProblems(form({ pointsPerQuestion: '2' }), bank)).toEqual([]);
    expect(wizardProblems(form({ pointsPerQuestion: '2.5' }), bank)).toEqual([]);
    expect(wizardProblems(form({ pointsPerQuestion: '2.50' }), bank)).toEqual([]);
  });

  it('enforces the duration ceiling the API declares', () => {
    expect(wizardProblems(form({ durationMinutes: '361', endLocal: '2026-10-01T20:00' }), bank))
      .toContain('Duration must be a whole number of minutes between 1 and 360.');
  });

  it('rejects an end time that is not after the start time', () => {
    const problems = wizardProblems(form({ endLocal: '2026-10-01T08:00' }), bank);
    expect(problems).toContain('The end time must be after the start time.');
  });

  it('rejects a duration longer than the start/end window', () => {
    const problems = wizardProblems(form({ durationMinutes: '180' }), bank);
    expect(problems).toContain('Duration cannot be longer than the window between the start and end times.');
  });

  it('allows a duration exactly equal to the window', () => {
    expect(wizardProblems(form({ durationMinutes: '120' }), bank)).toEqual([]);
  });

  it('requires the ids the chosen target scope actually uses', () => {
    expect(wizardProblems(form({ targetScope: 'sections' }), bank))
      .toContain('Choose at least one section, or switch the target back to the whole subject.');
    expect(wizardProblems(form({ targetScope: 'student_list' }), bank))
      .toContain('Choose at least one student, or switch the target back to the whole subject.');
  });

  it('reports every unmet requirement at once rather than stopping at the first', () => {
    const problems = wizardProblems(form({ subjectId: '', title: '', poolIds: [] }), bank);
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe('buildExamPayload', () => {
  it('sends question_pool_ids, not question_ids', () => {
    const payload = buildExamPayload(form());
    expect(payload).toHaveProperty('question_pool_ids', ['q1', 'q2', 'q3', 'q4']);
    expect(payload).not.toHaveProperty('question_ids');
  });

  it('sends points_per_question as a number even though the API returns it as a string', () => {
    const payload = buildExamPayload(form({ pointsPerQuestion: '2.5' }));
    expect(payload.points_per_question).toBe(2.5);
    expect(typeof payload.points_per_question).toBe('number');
  });

  it('sends duration_minutes as a number', () => {
    const payload = buildExamPayload(form());
    expect(payload.duration_minutes).toBe(60);
    expect(typeof payload.duration_minutes).toBe('number');
  });

  it('sends start_time and end_time as ISO strings, never as the raw datetime-local value', () => {
    const payload = buildExamPayload(form());
    expect(payload.start_time).toBe(new Date('2026-10-01T09:00').toISOString());
    expect(payload.end_time).toBe(new Date('2026-10-01T11:00').toISOString());
    expect(String(payload.start_time)).toMatch(/Z$/);
  });

  it('trims the title', () => {
    expect(buildExamPayload(form({ title: '  Compiler final  ' })).title).toBe('Compiler final');
  });

  it('sends the difficulty mix as three numbers', () => {
    expect(buildExamPayload(form()).difficulty_mix).toEqual({ easy: 2, medium: 1, hard: 1 });
  });

  it('omits the target id lists for the whole-subject scope', () => {
    const payload = buildExamPayload(form());
    expect(payload.target_scope).toBe('subject');
    expect(payload).not.toHaveProperty('target_section_ids');
    expect(payload).not.toHaveProperty('target_student_ids');
  });

  it('sends the section ids when the scope is sections', () => {
    const payload = buildExamPayload(form({ targetScope: 'sections', targetSectionIds: ['s1', 's2'] }));
    expect(payload.target_section_ids).toEqual(['s1', 's2']);
    expect(payload).not.toHaveProperty('target_student_ids');
  });

  it('sends the student ids when the scope is a student list', () => {
    const payload = buildExamPayload(form({ targetScope: 'student_list', targetStudentIds: ['u1'] }));
    expect(payload.target_student_ids).toEqual(['u1']);
  });

  it('never sends quiz_source, because a doctor exam is not a TA quiz', () => {
    expect(buildExamPayload(form())).not.toHaveProperty('quiz_source');
  });

  it('never sends the subject on an update, because PATCH omits subject_id', () => {
    expect(buildExamPayload(form(), { includeSubject: false })).not.toHaveProperty('subject_id');
    expect(buildExamPayload(form())).toHaveProperty('subject_id', 'subject-1');
  });
});

describe('mixTotal', () => {
  it('adds the three tiers', () => {
    expect(mixTotal({ easy: 2, medium: 1, hard: 1 })).toBe(4);
    expect(mixTotal({ easy: 0, medium: 0, hard: 0 })).toBe(0);
  });
});
