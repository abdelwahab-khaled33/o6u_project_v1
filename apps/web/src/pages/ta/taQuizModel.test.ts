import { describe, expect, it } from 'vitest';

import {
  authorLabel,
  buildQuizPayload,
  canManageRow,
  QUIZ_SOURCES,
  quizStatusNotice,
  rosterStudentsForSections,
  taQuizProblems,
  targetScopeOptions,
  TA_TARGET_SCOPES,
  type QuizForm,
  type RosterSection,
  type RosterStudent,
  type SharedQuestion,
} from './taQuizModel';

const SUBJECT = '11111111-1111-1111-1111-111111111111';
const SECTION_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const SECTION_B = 'bbbbbbbb-2222-2222-2222-222222222222';
const STUDENT_1 = 's0000001-1111-1111-1111-111111111111';
const STUDENT_2 = 's0000002-2222-2222-2222-222222222222';
const QUESTION_1 = 'q0000001-1111-1111-1111-111111111111';
const QUESTION_2 = 'q0000002-2222-2222-2222-222222222222';
const QUESTION_3 = 'q0000003-3333-3333-3333-333333333333';

function form(overrides: Partial<QuizForm> = {}): QuizForm {
  return {
    subjectId: SUBJECT,
    title: 'Week 3 quiz',
    poolIds: [QUESTION_1, QUESTION_2, QUESTION_3],
    mix: { easy: 1, medium: 1, hard: 1 },
    pointsPerQuestion: '2',
    durationMinutes: '30',
    startLocal: '2026-10-01T09:00',
    endLocal: '2026-10-01T11:00',
    quizSource: 'shared_bank',
    targetScope: 'sections',
    targetSectionIds: [SECTION_A],
    targetStudentIds: [],
    ...overrides,
  };
}

const bank: SharedQuestion[] = [
  { id: QUESTION_1, difficulty: 'easy' },
  { id: QUESTION_2, difficulty: 'medium' },
  { id: QUESTION_3, difficulty: 'hard' },
];

const sections: RosterSection[] = [
  { id: SECTION_A, subject_id: SUBJECT, name: 'Section A' },
  { id: SECTION_B, subject_id: SUBJECT, name: 'Section B' },
];

const students: RosterStudent[] = [
  { id: STUDENT_1, full_name: 'Ann', student_code: 'S1', section_id: SECTION_A, section_name: 'Section A' },
  { id: STUDENT_2, full_name: 'Bo', student_code: 'S2', section_id: SECTION_B, section_name: 'Section B' },
];

describe('QUIZ_SOURCES', () => {
  it('is exactly the two values the API enum accepts', () => {
    // Confirmed live: POST /exams as a TA with quiz_source 'live' is 400 "Invalid enum value.
    // Expected 'shared_bank' | 'own_questions'". The UI must not invent a third.
    expect(QUIZ_SOURCES.map((source) => source.value)).toEqual(['shared_bank', 'own_questions']);
  });

  it('gives every source a label and an explanation', () => {
    for (const source of QUIZ_SOURCES) {
      expect(source.label.length).toBeGreaterThan(0);
      expect(source.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('TA_TARGET_SCOPES', () => {
  it('never offers a whole-subject target', () => {
    // exams.ts:88 refuses target_scope 'subject' for a TA, so a selectable option would be a dead end.
    expect(TA_TARGET_SCOPES.map((scope) => scope.value)).toEqual(['sections', 'student_list']);
  });
});

describe('taQuizProblems', () => {
  it('is empty for a valid quiz', () => {
    expect(taQuizProblems(form(), bank, { sections, students })).toEqual([]);
  });

  it('demands a subject, a title and a pool', () => {
    const problems = taQuizProblems(
      form({ subjectId: '', title: 'x', poolIds: [] }),
      bank,
      { sections, students },
    );
    expect(problems).toContain('Choose the subject this quiz belongs to.');
    expect(problems).toContain('Title must be at least 2 characters.');
    expect(problems).toContain('Select at least one question for the pool.');
  });

  it('mirrors the pool sufficiency wording of the server', () => {
    const problems = taQuizProblems(
      form({ mix: { easy: 2, medium: 2, hard: 2 } }),
      bank,
      { sections, students },
    );
    expect(problems).toContain('Pool has only 1 easy question(s) but 2 are required');
  });

  it('counts the selection, not the whole bank', () => {
    // The single most dangerous bug here is counting the bank instead of the pool, which would let a
    // one-question pool pass a three-question mix.
    const problems = taQuizProblems(
      form({ poolIds: [QUESTION_1], mix: { easy: 1, medium: 1, hard: 1 } }),
      bank,
      { sections, students },
    );
    expect(problems).toContain('Pool has only 0 medium question(s) but 1 are required');
  });

  it('asks for at least one section when sections are targeted, and says nothing about a subject', () => {
    const problems = taQuizProblems(form({ targetSectionIds: [] }), bank, { sections, students });
    expect(problems).toContain('Choose at least one of your sections.');
    expect(problems.join(' ')).not.toContain('whole subject');
  });

  it('asks for at least one student when a student list is targeted', () => {
    const problems = taQuizProblems(
      form({ targetScope: 'student_list', targetSectionIds: [], targetStudentIds: [] }),
      bank,
      { sections, students },
    );
    expect(problems).toContain('Choose at least one student.');
  });

  it('complains about a missing section when the roster could not be loaded', () => {
    const problems = taQuizProblems(form({ targetSectionIds: [] }), bank, { sections: [], students: [] });
    expect(problems).toContain(
      'No section of this subject is assigned to you yet, so there is nobody to target.',
    );
  });

  it('complains about a missing student list when the roster is empty', () => {
    const problems = taQuizProblems(
      form({ targetScope: 'student_list', targetSectionIds: [], targetStudentIds: [] }),
      bank,
      { sections, students: [] },
    );
    expect(problems).toContain(
      'No student is enrolled in this subject through your sections, so there is nobody to target.',
    );
  });

  it('requires at least one question in the difficulty mix', () => {
    const problems = taQuizProblems(
      form({ mix: { easy: 0, medium: 0, hard: 0 } }),
      bank,
      { sections, students },
    );
    expect(problems).toContain('The difficulty mix must ask for at least one question.');
  });

  it('reports a pool that is not the caller\'s own while quiz_source is own_questions', () => {
    // exams.ts:68 refuses any pool question the TA did not personally add, so the picker is filtered on
    // the server's is_mine and a mix the caller's own questions cannot cover must be a visible problem
    // rather than a 400 at submit time.
    const problems = taQuizProblems(
      form({ quizSource: 'own_questions', mix: { easy: 0, medium: 0, hard: 1 } }),
      [{ id: QUESTION_1, difficulty: 'easy', is_mine: true }, { id: QUESTION_3, difficulty: 'hard', is_mine: false }],
      { sections, students },
    );
    expect(problems).toContain('Pool has only 0 hard question(s) but 1 are required');
  });

  it('does not report that problem when quiz_source is the shared bank', () => {
    // Same bank and same mix as the case above, which is the whole point: the same mix the caller's own
    // questions cannot cover is perfectly valid when the pool is the shared bank.
    const problems = taQuizProblems(
      form({ quizSource: 'shared_bank', mix: { easy: 0, medium: 0, hard: 1 } }),
      [{ id: QUESTION_1, difficulty: 'easy', is_mine: true }, { id: QUESTION_3, difficulty: 'hard', is_mine: false }],
      { sections, students },
    );
    expect(problems).toEqual([]);
  });

  it('keeps the points bounds that protect the Decimal(6,2) column', () => {
    // 0.001 answers 201 and reads back "0" against the running server, so a positive-only check is not enough.
    expect(taQuizProblems(form({ pointsPerQuestion: '0.001' }), bank, { sections, students }))
      .toContain('Points per question must be between 0.01 and 9999.99.');
    expect(taQuizProblems(form({ pointsPerQuestion: '100000' }), bank, { sections, students }))
      .toContain('Points per question must be between 0.01 and 9999.99.');
    expect(taQuizProblems(form({ pointsPerQuestion: '1.005' }), bank, { sections, students }))
      .toContain('Points per question is stored with 2 decimal places, so give it at most 2.');
  });

  it('rejects a duration outside 1..360 and a non-integer duration', () => {
    expect(taQuizProblems(form({ durationMinutes: '0' }), bank, { sections, students }))
      .toContain('Duration must be a whole number of minutes between 1 and 360.');
    expect(taQuizProblems(form({ durationMinutes: '12.5' }), bank, { sections, students }))
      .toContain('Duration must be a whole number of minutes between 1 and 360.');
  });

  it('rejects an end time that is not after the start', () => {
    const problems = taQuizProblems(
      form({ startLocal: '2026-10-01T11:00', endLocal: '2026-10-01T09:00' }),
      bank,
      { sections, students },
    );
    expect(problems).toContain('The end time must be after the start time.');
  });

  it('rejects a duration longer than the open window', () => {
    const problems = taQuizProblems(
      form({ startLocal: '2026-10-01T09:00', endLocal: '2026-10-01T09:30', durationMinutes: '60' }),
      bank,
      { sections, students },
    );
    expect(problems).toContain('Duration cannot be longer than the window between the start and end times.');
  });

  it('rejects a missing start or end time', () => {
    const problems = taQuizProblems(
      form({ startLocal: '', endLocal: '' }),
      bank,
      { sections, students },
    );
    expect(problems).toContain('Set both a start time and an end time.');
  });
});

describe('buildQuizPayload', () => {
  it('sends type quiz and the chosen quiz_source', () => {
    const payload = buildQuizPayload(form(), { includeSubject: true });
    expect(payload.type).toBe('quiz');
    expect(payload.quiz_source).toBe('shared_bank');
    expect(payload.subject_id).toBe(SUBJECT);
  });

  it('omits subject_id when editing, because an exam cannot move between subjects', () => {
    const payload = buildQuizPayload(form(), { includeSubject: false });
    expect(payload.subject_id).toBeUndefined();
    expect('subject_id' in payload).toBe(false);
  });

  it('converts the datetime-local values to ISO strings', () => {
    const payload = buildQuizPayload(form(), { includeSubject: true });
    expect(payload.start_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(payload.end_time).getTime()).toBeGreaterThan(new Date(payload.start_time).getTime());
  });

  it('sends the mix, the pool and the points as numbers', () => {
    const payload = buildQuizPayload(form({ pointsPerQuestion: '1.5' }), { includeSubject: true });
    expect(payload.difficulty_mix).toEqual({ easy: 1, medium: 1, hard: 1 });
    expect(payload.question_pool_ids).toEqual([QUESTION_1, QUESTION_2, QUESTION_3]);
    expect(payload.points_per_question).toBe(1.5);
    expect(payload.duration_minutes).toBe(30);
  });

  it('sends the section ids for a section target and no student ids', () => {
    const payload = buildQuizPayload(form(), { includeSubject: true });
    expect(payload.target_scope).toBe('sections');
    expect(payload.target_section_ids).toEqual([SECTION_A]);
    expect('target_student_ids' in payload).toBe(false);
  });

  it('sends the student ids for a student-list target and no section ids', () => {
    const payload = buildQuizPayload(
      form({ targetScope: 'student_list', targetSectionIds: [], targetStudentIds: [STUDENT_1, STUDENT_2] }),
      { includeSubject: true },
    );
    expect(payload.target_scope).toBe('student_list');
    expect(payload.target_student_ids).toEqual([STUDENT_1, STUDENT_2]);
    expect('target_section_ids' in payload).toBe(false);
  });

  it('trims the title', () => {
    expect(buildQuizPayload(form({ title: '  Week 3 quiz  ' }), { includeSubject: true }).title)
      .toBe('Week 3 quiz');
  });

  it('throws rather than sending a half-filled form', () => {
    expect(() => buildQuizPayload(form({ startLocal: '' }), { includeSubject: true })).toThrow();
  });
});

describe('rosterStudentsForSections', () => {
  it('keeps only the students in the chosen sections', () => {
    expect(rosterStudentsForSections(students, [SECTION_A]).map((student) => student.id)).toEqual([STUDENT_1]);
  });

  it('returns nobody when no section is chosen', () => {
    expect(rosterStudentsForSections(students, [])).toEqual([]);
  });

  it('de-duplicates when the same student arrives twice', () => {
    const duplicated = [...students, ...students, ...students];
    expect(rosterStudentsForSections(duplicated, [SECTION_A, SECTION_A])).toHaveLength(1);
  });

  it('keeps a student once when they somehow appear in two chosen sections', () => {
    const first = students.find((student) => student.id === STUDENT_1)!;
    const shared = { ...first, section_id: SECTION_B };
    expect(rosterStudentsForSections([first, shared], [SECTION_A, SECTION_B])).toHaveLength(1);
  });
});

describe('targetScopeOptions', () => {
  it('labels both targets', () => {
    const options = targetScopeOptions();
    expect(options.map((option) => option.value)).toEqual(['sections', 'student_list']);
    for (const option of options) expect(option.label.length).toBeGreaterThan(0);
  });
});

describe('authorLabel', () => {
  it('names the author the server sent', () => {
    expect(authorLabel({ author: { id: 'u1', full_name: 'Live ta' } })).toBe('Live ta');
  });

  it('says so plainly when there is no author, rather than rendering null', () => {
    expect(authorLabel({ author: null })).toBe('Unknown author');
  });
});

describe('canManageRow', () => {
  it('is exactly the server flag and never a client-side comparison', () => {
    // The rule is "a TA may only edit their own questions". Nothing in the browser can establish that,
    // so the flag the server computed with the same canEditQuestion that guards PATCH and DELETE is the
    // only input. Comparing author.id with the signed-in user would be a second, drifting authority.
    expect(canManageRow({ can_edit: true, author: { id: 'me', full_name: 'Me' } })).toBe(true);
    expect(canManageRow({ can_edit: false, author: { id: 'me', full_name: 'Me' } })).toBe(false);
  });

  it('treats a missing flag as no', () => {
    expect(canManageRow({ author: { id: 'me', full_name: 'Me' } })).toBe(false);
  });
});

describe('quizStatusNotice', () => {
  it('never promises an administrator approval step for a TA quiz', () => {
    // Verified live: a TA quiz lands with status 'approved' and approved_by set to the TA, and PATCH
    // computes doctorEditsApproved only for role === 'doctor', so editing keeps it approved.
    for (const notice of [quizStatusNotice('Q', { editing: false }), quizStatusNotice('Q', { editing: true })]) {
      expect(notice).not.toMatch(/administrator/i);
      expect(notice).not.toMatch(/approv/i);
    }
  });

  it('says Created, not Updated, on the create path whatever status came back', () => {
    // This is the branch the first version got wrong. Branching on the status meant the create path
    // never reached the "Created" sentence, because a TA quiz is always created approved — confirmed live,
    // POST /exams as a TA returns status 'approved'. A unit test that only passed null could not see it;
    // the browser did, and it rendered "Updated" immediately after creating a quiz.
    for (const status of ['approved', 'pending_approval', 'draft']) {
      expect(quizStatusNotice('Week 3 quiz', { editing: false, status })).toMatch(/^Created "Week 3 quiz"\./);
    }
  });

  it('explains the immediate effect of creating a quiz', () => {
    expect(quizStatusNotice('Week 3 quiz', { editing: false, status: 'approved' }))
      .toMatch(/students reach it with an access code/i);
  });

  it('says Updated on the edit path', () => {
    expect(quizStatusNotice('Week 3 quiz', { editing: true, status: 'approved' }))
      .toMatch(/^Updated "Week 3 quiz"\./);
  });

  it('explains that saving an edit keeps the quiz live and clears its attempts', () => {
    const notice = quizStatusNotice('Week 3 quiz', { editing: true, status: 'approved' });
    expect(notice).toContain('attempts already generated for it are cleared');
  });
});
