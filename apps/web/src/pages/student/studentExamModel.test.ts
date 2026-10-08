import { describe, expect, it } from 'vitest';

import {
  FORBIDDEN_STUDENT_KEYS,
  RUNNER_PAGE_SIZE,
  accessCodeInputProblem,
  accessCodeProblem,
  answerChoices,
  answeredIds,
  clampPage,
  clockOffsetMs,
  examRunProblem,
  flagProblem,
  formatCountdown,
  isTimeUp,
  normaliseAccessCode,
  pageOfIndex,
  pointsPerQuestion,
  progressSummary,
  remainingMs,
  submitBlockedNotice,
  submitConfirmCopy,
  toStudentExam,
  toStudentQuestion,
  totalPages,
  unansweredIds,
  wasAutoSubmitted,
  type StudentQuestion,
} from './studentExamModel';

const SERVER_QUESTION: StudentQuestion = {
  id: 'q1',
  question_type: 'mcq',
  text: 'Which option is right?',
  options: ['Alpha', 'Beta'],
  image_url: null,
  difficulty: 'hard',
  selected_answer: null,
  is_flagged: false,
  order: 1,
};

function question(overrides: Partial<StudentQuestion> = {}): StudentQuestion {
  return { ...SERVER_QUESTION, ...overrides };
}

function apiError(status: number, body: Record<string, unknown>) {
  const message = typeof body.error === 'string' ? body.error : '';
  return Object.assign(new Error(message), { status, payload: body, name: 'ApiError' });
}

function keysOf(value: object): string[] {
  return Object.keys(value).sort();
}

describe('toStudentQuestion', () => {
  it('keeps the nine keys the exam routes actually send', () => {
    expect(keysOf(toStudentQuestion(SERVER_QUESTION))).toEqual([
      'difficulty',
      'id',
      'image_url',
      'is_flagged',
      'options',
      'order',
      'question_type',
      'selected_answer',
      'text',
    ]);
  });

  it('drops correct_answer and grade even when the payload carries them', () => {
    const result = toStudentQuestion({ ...SERVER_QUESTION, correct_answer: 'Alpha', grade: '2.5' });
    expect(result).not.toHaveProperty('correct_answer');
    expect(result).not.toHaveProperty('grade');
  });

  it('drops every key named in FORBIDDEN_STUDENT_KEYS', () => {
    const forged: Record<string, unknown> = { ...SERVER_QUESTION };
    for (const key of FORBIDDEN_STUDENT_KEYS) forged[key] = 'leaked';
    const result = toStudentQuestion(forged) as unknown as Record<string, unknown>;
    for (const key of FORBIDDEN_STUDENT_KEYS) {
      expect(result).not.toHaveProperty(key);
    }
  });

  it('coerces options to a string array and drops a non-string entry', () => {
    expect(toStudentQuestion({ ...SERVER_QUESTION, options: ['Alpha', 7, null, 'Beta'] }).options).toEqual(['Alpha', 'Beta']);
  });

  it('coerces a missing image_url to null instead of undefined', () => {
    const raw = { ...SERVER_QUESTION } as Record<string, unknown>;
    delete raw.image_url;
    expect(toStudentQuestion(raw).image_url).toBeNull();
  });

  it('normalises a missing selected_answer to null so progress is countable', () => {
    const raw = { ...SERVER_QUESTION } as Record<string, unknown>;
    delete raw.selected_answer;
    expect(toStudentQuestion(raw).selected_answer).toBeNull();
  });

  it('rejects a payload that is not an object', () => {
    expect(() => toStudentQuestion(null)).toThrow(/unexpected question/i);
    expect(() => toStudentQuestion('q1')).toThrow(/unexpected question/i);
  });
});

describe('answerChoices', () => {
  it('returns an MCQ question’s own options in the server’s order', () => {
    expect(answerChoices(question())).toEqual([
      { value: 'Alpha', label: 'Alpha' },
      { value: 'Beta', label: 'Beta' },
    ]);
  });

  it('keeps the server’s shuffle: option order is never re-sorted locally', () => {
    expect(answerChoices(question({ options: ['Beta', 'Alpha'] })).map((choice) => choice.value)).toEqual(['Beta', 'Alpha']);
  });

  it('answers a true/false question from the type, not from stored options', () => {
    expect(answerChoices(question({ question_type: 'true_false', options: [] }))).toEqual([
      { value: 'true', label: 'True' },
      { value: 'false', label: 'False' },
    ]);
  });

  it('exposes no value outside the question’s own options, whatever the answer key says', () => {
    const forged = { ...question(), correct_answer: 'Gamma' } as unknown as StudentQuestion;
    expect(answerChoices(forged).map((choice) => choice.value)).toEqual(['Alpha', 'Beta']);
  });

  it('keeps a selected answer that is a true/false literal selectable after a resume', () => {
    const resumed = question({ question_type: 'true_false', selected_answer: 'false' });
    expect(answerChoices(resumed).map((choice) => choice.value)).toContain('false');
  });
});

describe('formatCountdown', () => {
  it('renders minutes and seconds below an hour', () => {
    expect(formatCountdown(9 * 60 * 1000 + 5 * 1000)).toBe('9:05');
  });

  it('pads seconds so the clock does not jump width', () => {
    expect(formatCountdown(61 * 1000)).toBe('1:01');
    expect(formatCountdown(60 * 1000)).toBe('1:00');
  });

  it('adds an hours field at an hour or more', () => {
    expect(formatCountdown(60 * 60 * 1000)).toBe('1:00:00');
    expect(formatCountdown(2 * 60 * 60 * 1000 + 3 * 60 * 1000)).toBe('2:03:00');
  });

  it('rounds a partial second down and never shows a negative clock', () => {
    expect(formatCountdown(59_400)).toBe('0:59');
    expect(formatCountdown(-5000)).toBe('0:00');
    expect(formatCountdown(0)).toBe('0:00');
  });
});

describe('clockOffsetMs', () => {
  it('measures how far the server clock runs ahead of this browser', () => {
    expect(clockOffsetMs('2026-09-28T10:00:10.000Z', Date.parse('2026-09-28T10:00:00.000Z'))).toBe(10_000);
  });

  it('is negative when the server clock runs behind', () => {
    expect(clockOffsetMs('2026-09-28T09:59:50.000Z', Date.parse('2026-09-28T10:00:00.000Z'))).toBe(-10_000);
  });

  it('falls back to no offset when the server sent an unparseable time', () => {
    expect(clockOffsetMs('not-a-date', 1_000)).toBe(0);
  });
});

describe('remainingMs', () => {
  const now = Date.parse('2026-09-28T10:00:00.000Z');
  const deadline = '2026-09-28T10:30:00.000Z';

  it('subtracts the server deadline from the corrected clock', () => {
    expect(remainingMs(deadline, 0, now)).toBe(30 * 60 * 1000);
    expect(remainingMs(deadline, 60_000, now)).toBe(29 * 60 * 1000);
  });

  it('reports zero once the deadline has passed rather than a negative span', () => {
    expect(remainingMs(deadline, 0, Date.parse('2026-09-28T11:00:00.000Z'))).toBe(0);
  });

  it('reports zero when the attempt never received a deadline', () => {
    expect(remainingMs(null, 0, now)).toBe(0);
  });
});

describe('isTimeUp', () => {
  it('is true at zero and false while there is time left', () => {
    expect(isTimeUp(0)).toBe(true);
    expect(isTimeUp(-1)).toBe(true);
    expect(isTimeUp(1)).toBe(false);
  });
});

describe('progress', () => {
  const three = [
    question({ id: 'a', selected_answer: 'Alpha' }),
    question({ id: 'b', selected_answer: null, is_flagged: true }),
    question({ id: 'c', selected_answer: 'Beta' }),
  ];

  it('counts answered, unanswered and flagged across the attempt', () => {
    expect(progressSummary(three)).toEqual({ total: 3, answered: 2, unanswered: 1, flagged: 1 });
  });

  it('counts an empty attempt as all unanswered', () => {
    expect(progressSummary([])).toEqual({ total: 0, answered: 0, unanswered: 0, flagged: 0 });
  });

  it('lists the unanswered ids in the attempt’s own order', () => {
    expect(unansweredIds(three)).toEqual(['b']);
    expect(answeredIds(three)).toEqual(['a', 'c']);
  });

  it('treats a true/false answer as answered', () => {
    expect(progressSummary([question({ question_type: 'true_false', selected_answer: 'false' })]).answered).toBe(1);
  });
});

describe('submitBlockedNotice', () => {
  it('reports the exact count the server sent, not a generic failure', () => {
    const notice = submitBlockedNotice(
      apiError(409, { error: 'All questions must be answered before submitting', unanswered_count: 3 }),
    );
    expect(notice?.count).toBe(3);
    expect(notice?.message).toBe('You still have 3 questions to answer. Nothing has been submitted — your answers are saved.');
  });

  it('uses the singular for one remaining question', () => {
    expect(
      submitBlockedNotice(
        apiError(409, { error: 'All questions must be answered before submitting', unanswered_count: 1 }),
      )?.message,
    ).toBe('You still have 1 question to answer. Nothing has been submitted — your answers are saved.');
  });

  it('returns null for any error that is not the unanswered 409', () => {
    expect(submitBlockedNotice(apiError(409, { error: 'Exam already submitted' }))).toBeNull();
    expect(
      submitBlockedNotice(apiError(400, { error: 'All questions must be answered before submitting', unanswered_count: 2 })),
    ).toBeNull();
    expect(submitBlockedNotice(new Error('network down'))).toBeNull();
  });

  it('ignores a count that is not a number rather than printing NaN', () => {
    expect(
      submitBlockedNotice(apiError(409, { error: 'All questions must be answered before submitting', unanswered_count: 'three' })),
    ).toBeNull();
  });
});

describe('normaliseAccessCode', () => {
  it('uppercases, because the alphabet is uppercase and the comparison is exact', () => {
    expect(normaliseAccessCode('wks2u8')).toBe('WKS2U8');
  });

  it('strips the spaces some keyboards and chat pastes insert', () => {
    expect(normaliseAccessCode(' wks 2u8 ')).toBe('WKS2U8');
  });

  it('truncates to the six characters the server will accept', () => {
    expect(normaliseAccessCode('wks2u8extra')).toBe('WKS2U8');
  });

  it('returns an empty string for an empty field', () => {
    expect(normaliseAccessCode('')).toBe('');
    expect(normaliseAccessCode('   ')).toBe('');
  });
});

describe('accessCodeInputProblem', () => {
  it('accepts a complete six-character code', () => {
    expect(accessCodeInputProblem('WKS2U8')).toBeNull();
  });

  it('asks for the rest while the code is short, so a half-typed code never costs an attempt', () => {
    expect(accessCodeInputProblem('')).toBe('Enter the 6-character access code.');
    expect(accessCodeInputProblem('WKS')).toBe('3 more characters to go.');
    expect(accessCodeInputProblem('WKS2U')).toBe('1 more character to go.');
  });

  it('accepts an over-long entry after normalising it, because it trims to six', () => {
    expect(accessCodeInputProblem('wks2u8extra')).toBeNull();
  });
});

describe('accessCodeProblem', () => {
  it('explains a wrong code without logging the student out', () => {
    expect(accessCodeProblem(apiError(403, { error: 'Invalid access code' }))).toBe(
      'That access code is not right. Check the code your supervisor announced and try again.',
    );
  });

  it('passes the rate-limit message through, because it names the wait', () => {
    expect(
      accessCodeProblem(
        apiError(429, { error: 'ACCESS_CODE_RATE_LIMITED', message: 'Too many incorrect access-code attempts. Try again in one minute.' }),
      ),
    ).toBe('Too many incorrect access-code attempts. Try again in one minute.');
  });

  it('distinguishes an expired code from a wrong one', () => {
    expect(accessCodeProblem(apiError(403, { error: 'Access code has expired' }))).toBe(
      'This access code has expired. Ask your supervisor for a new one.',
    );
  });

  it('asks for the code when none was sent', () => {
    expect(accessCodeProblem(apiError(400, { error: 'A valid access code is required' }))).toBe(
      'Enter the 6-character access code your supervisor announced.',
    );
  });

  it('explains the lab network and Safe Exam Browser refusals', () => {
    expect(accessCodeProblem(apiError(403, { error: 'LAB_NETWORK_REQUIRED' }))).toBe(
      'This exam can only be taken from the university labs. Connect to the lab network and try again.',
    );
    expect(accessCodeProblem(apiError(403, { error: 'SEB_REQUIRED' }))).toBe(
      'This exam has to be opened in Safe Exam Browser. Close this tab and start again from the browser your lab provides.',
    );
  });

  it('reports an ended exam rather than blaming the code', () => {
    expect(accessCodeProblem(apiError(403, { error: 'Exam has ended' }))).toBe('This exam has ended. It is no longer available.');
  });

  it('returns null when the error is not one it explains', () => {
    expect(accessCodeProblem(apiError(500, { error: 'Internal Server Error' }))).toBeNull();
    expect(accessCodeProblem(new Error('offline'))).toBeNull();
  });
});

describe('examRunProblem', () => {
  it('tells a student whose session moved to ask for a release, in the server’s words', () => {
    expect(
      examRunProblem(apiError(409, { error: 'SESSION_ACTIVE_ELSEWHERE', message: 'Ask your supervisor to release your session' })),
    ).toBe('Ask your supervisor to release your session');
  });

  it('explains an invalid session token as a release too, since that is the only fix', () => {
    expect(examRunProblem(apiError(409, { error: 'SESSION_TOKEN_INVALID' }))).toBe(
      'Your exam session token is no longer valid. Ask your supervisor to release your session, then resume.',
    );
  });

  it('treats a deadline that has already auto-submitted as finished, not as an error', () => {
    expect(examRunProblem(apiError(409, { error: 'Deadline already passed; exam has been auto-submitted' }))).toBeNull();
    expect(examRunProblem(apiError(409, { error: 'Your time has already expired; this exam has been submitted' }))).toBeNull();
  });

  it('reports an auto-submission so the runner can show the finished state instead of a failure', () => {
    expect(wasAutoSubmitted(apiError(409, { error: 'Deadline already passed; exam has been auto-submitted' }))).toBe(true);
    expect(wasAutoSubmitted(apiError(409, { error: 'Deadline passed; exam has been auto-submitted' }))).toBe(true);
    expect(wasAutoSubmitted(apiError(409, { error: 'Your time has already expired; this exam has been submitted' }))).toBe(true);
    expect(wasAutoSubmitted(apiError(409, { error: 'Exam already submitted' }))).toBe(true);
    expect(wasAutoSubmitted(apiError(409, { error: 'This exam has already been submitted' }))).toBe(true);
    expect(wasAutoSubmitted(new Error('offline'))).toBe(false);
  });

  it('treats an attempt that a racing heartbeat or tab already finalised as finished mid-exam', () => {
    // Near the deadline the 30s heartbeat and the deadline submit can race: the heartbeat's lazy
    // finalisation wins, and the loser hears "Exam already submitted". For the running page that is
    // the outcome the student wanted, so the runner must show the finished state, never a failure.
    expect(examRunProblem(apiError(409, { error: 'Exam already submitted' }))).toBeNull();
    expect(examRunProblem(apiError(409, { error: 'This exam has already been submitted' }))).toBeNull();
  });

  it('falls back to the server message for a lab refusal mid-exam', () => {
    expect(examRunProblem(apiError(403, { error: 'LAB_NETWORK_REQUIRED' }))).toBe('This exam can only be taken from the university labs.');
  });

  it('returns null for an error it does not name', () => {
    expect(examRunProblem(apiError(500, { error: 'Internal Server Error' }))).toBeNull();
  });
});

describe('flagProblem', () => {
  it('returns null so a failed flag never blocks the answer it was saved with', () => {
    expect(flagProblem(new Error('offline'))).toBeNull();
  });
});

describe('pointsPerQuestion', () => {
  it('reads the decimal column, which JSON hands over as a string', () => {
    expect(pointsPerQuestion('2')).toBe(2);
    expect(pointsPerQuestion('2.50')).toBe(2.5);
  });

  it('falls back to zero for a value that is not a number', () => {
    expect(pointsPerQuestion('n/a')).toBe(0);
  });
});

describe('runner pagination', () => {
  it('keeps five questions per page', () => {
    expect(RUNNER_PAGE_SIZE).toBe(5);
  });

  it('counts pages with a partial last page', () => {
    expect(totalPages(0)).toBe(1);
    expect(totalPages(4)).toBe(1);
    expect(totalPages(5)).toBe(1);
    expect(totalPages(6)).toBe(2);
    expect(totalPages(11)).toBe(3);
  });

  it('maps a question index to its page', () => {
    expect(pageOfIndex(0)).toBe(0);
    expect(pageOfIndex(4)).toBe(0);
    expect(pageOfIndex(5)).toBe(1);
    expect(pageOfIndex(10)).toBe(2);
  });

  it('clamps a page into range', () => {
    expect(clampPage(0, 3)).toBe(0);
    expect(clampPage(5, 3)).toBe(2);
    expect(clampPage(-1, 3)).toBe(0);
  });
});

describe('submitConfirmCopy', () => {
  it('states every question is answered when nothing is blank', () => {
    expect(submitConfirmCopy(4, 4)).toBe('You have answered 4 of 4 questions. Every question is answered.');
  });

  it('names the blank count and the refusal for several blanks', () => {
    expect(submitConfirmCopy(2, 4)).toBe(
      'You have answered 2 of 4 questions. 2 questions are still blank, so the server will refuse the submission until you answer them.',
    );
  });

  it('uses the singular for one blank question', () => {
    expect(submitConfirmCopy(3, 4)).toBe(
      'You have answered 3 of 4 questions. 1 question is still blank, so the server will refuse the submission until you answer it.',
    );
  });
});

describe('toStudentExam', () => {
  const summary = {
    id: 'e1',
    title: 'Live Verification Exam',
    type: 'doctor_exam',
    subject: { id: 's1', code: 'CS101', name: 'Intro' },
    duration_minutes: 60,
    start_time: '2026-09-28T09:45:40.474Z',
    end_time: '2026-09-28T11:45:40.474Z',
    points_per_question: '2',
    status: 'not_started',
  };

  it('keeps the nine keys the student list actually returns', () => {
    expect(keysOf(toStudentExam(summary))).toEqual([
      'duration_minutes',
      'end_time',
      'id',
      'points_per_question',
      'start_time',
      'status',
      'subject',
      'title',
      'type',
    ]);
  });

  it('drops an access code that the list should never carry', () => {
    const forged = { ...summary, access_code: 'WKS2U8', access_code_hash: 'abc' };
    const result = toStudentExam(forged) as unknown as Record<string, unknown>;
    expect(result).not.toHaveProperty('access_code');
    expect(result).not.toHaveProperty('access_code_hash');
  });

  it('keeps the exam status, which is how the list tells start from resume', () => {
    expect(toStudentExam(summary).status).toBe('not_started');
    expect(toStudentExam({ ...summary, status: 'in_progress' }).status).toBe('in_progress');
  });
});
