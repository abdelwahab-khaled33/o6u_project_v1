import { describe, it, expect, vi } from 'vitest';
import { checkPoolSufficiency } from '../services/exam-sampling.js';
import { canChangePasswordForCreate } from '../services/admin-management.js';
import {
  DEMO_PASSWORD,
  demoUsers,
  demoSubjects,
  demoSections,
  demoEnrollments,
  demoDoctorAssignments,
  demoQuestions,
  demoExams,
  examWindow,
  eligibilityUsernames,
  attemptPlanFor,
  attemptTimestamps,
  answeredCountFor,
  isAnswerCorrect,
  answerFor,
  shouldFlag,
  pickCompensationTargets,
} from './demo-seed-data.js';

vi.mock('../lib/prisma.js', () => ({ prisma: {} }));

const NOW = new Date('2026-10-20T12:00:00.000Z');

const usersByUsername = new Map(demoUsers.map((u) => [u.username, u]));

const examByKey = (key: string) => {
  const exam = demoExams.find((e) => e.key === key);
  if (!exam) throw new Error(`missing demo exam: ${key}`);
  return exam;
};

const bankOfOwner = (ownerUsername: string, subjectCode: string) =>
  demoQuestions.filter(
    (q) => q.ownerUsername === ownerUsername && q.subjectCode === subjectCode,
  );

describe('demo users', () => {
  it('shares one password inside the 8..72 bcrypt bound', () => {
    expect(DEMO_PASSWORD.length).toBeGreaterThanOrEqual(8);
    expect(DEMO_PASSWORD.length).toBeLessThanOrEqual(72);
  });

  it('includes at least one doctor, one TA and one student', () => {
    const roles = new Set(demoUsers.map((u) => u.role));
    expect(roles.has('doctor')).toBe(true);
    expect(roles.has('ta')).toBe(true);
    expect(roles.has('student')).toBe(true);
  });

  it('keeps usernames and student codes unique and complete', () => {
    const usernames = demoUsers.map((u) => u.username);
    expect(new Set(usernames).size).toBe(usernames.length);
    const codes = demoUsers.filter((u) => u.role === 'student').map((u) => u.student_code);
    expect(codes.every((c) => typeof c === 'string' && c.length > 0)).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
    expect(
      demoUsers.filter((u) => u.role !== 'student').every((u) => u.student_code == null),
    ).toBe(true);
  });

  it('stores a real name for every demo account', () => {
    expect(
      demoUsers.every((u) => u.full_name.trim().length >= 3),
    ).toBe(true);
  });

  it('marks students as unable to change their password through the shared rule', () => {
    expect(canChangePasswordForCreate('student', true)).toBe(false);
    expect(canChangePasswordForCreate('doctor', true)).toBe(true);
  });
});

describe('subjects, sections and enrollments', () => {
  it('defines three subjects with unique codes', () => {
    const codes = demoSubjects.map((s) => s.code);
    expect(codes.length).toBe(3);
    expect(new Set(codes).size).toBe(3);
  });

  it('staffs every section with an existing TA and unique names per subject', () => {
    const triples = demoSections.map((s) => `${s.subjectCode}|${s.taUsername}|${s.name}`);
    expect(new Set(triples).size).toBe(triples.length);
    for (const section of demoSections) {
      const ta = usersByUsername.get(section.taUsername);
      expect(ta?.role).toBe('ta');
      expect(demoSubjects.some((s) => s.code === section.subjectCode)).toBe(true);
    }
  });

  it('gives every subject exactly two sections', () => {
    for (const subject of demoSubjects) {
      const sections = demoSections.filter((s) => s.subjectCode === subject.code);
      expect(sections.length).toBe(2);
    }
  });

  it('enrolls every student in exactly two subjects, each through a section of that subject', () => {
    const byStudent = new Map<string, string[]>();
    for (const row of demoEnrollments) {
      byStudent.set(row.studentUsername, [
        ...(byStudent.get(row.studentUsername) ?? []),
        row.subjectCode,
      ]);
    }
    const students = demoUsers.filter((u) => u.role === 'student');
    expect(byStudent.size).toBe(students.length);
    for (const student of students) {
      const subjects = byStudent.get(student.username) ?? [];
      expect(subjects.length).toBe(2);
      expect(new Set(subjects).size).toBe(2);
    }
    for (const row of demoEnrollments) {
      const section = demoSections.find(
        (s) => s.subjectCode === row.subjectCode && s.name === row.sectionName,
      );
      expect(section).toBeDefined();
    }
  });

  it('splits every subject evenly across its two sections', () => {
    for (const subject of demoSubjects) {
      const rows = demoEnrollments.filter((r) => r.subjectCode === subject.code);
      expect(rows.length).toBe(12);
      const perSection = new Map<string, number>();
      for (const row of rows) {
        perSection.set(row.sectionName, (perSection.get(row.sectionName) ?? 0) + 1);
      }
      expect([...perSection.values()]).toEqual([6, 6]);
    }
  });

  it('assigns each exam subject to a doctor holding that assignment', () => {
    for (const assignment of demoDoctorAssignments) {
      expect(usersByUsername.get(assignment.doctorUsername)?.role).toBe('doctor');
      expect(demoSubjects.some((s) => s.code === assignment.subjectCode)).toBe(true);
    }
    for (const exam of demoExams) {
      const owner = usersByUsername.get(exam.ownerUsername);
      expect(owner).toBeDefined();
      if (exam.type === 'doctor_exam') {
        expect(owner?.role).toBe('doctor');
        expect(
          demoDoctorAssignments.some(
            (a) =>
              a.doctorUsername === exam.ownerUsername && a.subjectCode === exam.subjectCode,
          ),
        ).toBe(true);
      } else {
        expect(owner?.role).toBe('ta');
        for (const name of exam.targetSections ?? []) {
          expect(
            demoSections.some(
              (s) =>
                s.subjectCode === exam.subjectCode && s.name === name && s.taUsername === exam.ownerUsername,
            ),
          ).toBe(true);
        }
      }
    }
  });
});

describe('demo questions', () => {
  it('gives every doctor a twelve-question bank in a 4/4/4 mix on their subject', () => {
    for (const assignment of demoDoctorAssignments) {
      const bank = bankOfOwner(assignment.doctorUsername, assignment.subjectCode);
      expect(bank.length).toBe(12);
      expect(bank.every((q) => q.ownerType === 'doctor')).toBe(true);
      for (const tier of ['easy', 'medium', 'hard'] as const) {
        expect(bank.filter((q) => q.difficulty === tier).length).toBe(4);
      }
    }
  });

  it('gives every TA six shared questions in a 2/2/2 mix on each subject they staff', () => {
    const pairs = new Set(demoSections.map((s) => `${s.taUsername}|${s.subjectCode}`));
    expect(pairs.size).toBeGreaterThanOrEqual(3);
    for (const pair of pairs) {
      const [ta = '', subject = ''] = pair.split('|');
      const bank = bankOfOwner(ta, subject);
      expect(bank.length).toBe(6);
      expect(bank.every((q) => q.ownerType === 'ta_shared')).toBe(true);
      for (const tier of ['easy', 'medium', 'hard'] as const) {
        expect(bank.filter((q) => q.difficulty === tier).length).toBe(2);
      }
    }
  });

  it('keeps every MCQ answer inside its own option list with 2..8 options', () => {
    for (const q of demoQuestions) {
      if (q.questionType === 'mcq') {
        expect(q.options.length).toBeGreaterThanOrEqual(2);
        expect(q.options.length).toBeLessThanOrEqual(8);
        expect(q.options).toContain(q.correctAnswer);
        expect(new Set(q.options).size).toBe(q.options.length);
      } else {
        expect(q.correctAnswer === 'true' || q.correctAnswer === 'false').toBe(true);
        expect(q.options).toEqual([]);
      }
    }
  });

  it('keeps question texts unique within each subject', () => {
    const keys = demoQuestions.map((q) => `${q.subjectCode}|${q.text}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every question a positive grade', () => {
    expect(demoQuestions.every((q) => q.grade > 0)).toBe(true);
  });
});

describe('demo exams', () => {
  it('covers approved, pending and rejected statuses plus past, future and open windows', () => {
    const statuses = new Set(demoExams.map((e) => e.status));
    expect(statuses.has('approved')).toBe(true);
    expect(statuses.has('pending_approval')).toBe(true);
    expect(statuses.has('rejected')).toBe(true);
    const kinds = new Set(demoExams.map((e) => e.window.kind));
    expect(kinds.has('ended')).toBe(true);
    expect(kinds.has('future')).toBe(true);
    expect(kinds.has('open')).toBe(true);
    expect(demoExams.some((e) => e.type === 'ta_quiz')).toBe(true);
    expect(demoExams.some((e) => e.rejectionReason != null)).toBe(true);
  });

  it('keeps exam titles unique', () => {
    const titles = demoExams.map((e) => e.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('gives every exam a well-formed window with a duration that fits inside it', () => {
    for (const exam of demoExams) {
      const { start, end } = examWindow(NOW, exam.window);
      expect(start.getTime()).toBeLessThan(end.getTime());
      const windowMinutes = (end.getTime() - start.getTime()) / 60_000;
      expect(exam.durationMinutes).toBeGreaterThan(0);
      expect(exam.durationMinutes).toBeLessThanOrEqual(windowMinutes);
    }
  });

  it('places each window kind on the correct side of now', () => {
    for (const exam of demoExams) {
      const { start, end } = examWindow(NOW, exam.window);
      if (exam.window.kind === 'ended') expect(end.getTime()).toBeLessThan(NOW.getTime());
      if (exam.window.kind === 'future') expect(start.getTime()).toBeGreaterThan(NOW.getTime());
      if (exam.window.kind === 'open') {
        expect(start.getTime()).toBeLessThan(NOW.getTime());
        expect(end.getTime()).toBeGreaterThan(NOW.getTime());
      }
    }
  });

  it('passes the real pool-sufficiency rule against the owning bank', () => {
    for (const exam of demoExams) {
      const bank = bankOfOwner(exam.ownerUsername, exam.subjectCode);
      expect(bank.length).toBeGreaterThanOrEqual(
        exam.mix.easy + exam.mix.medium + exam.mix.hard,
      );
      const result = checkPoolSufficiency(bank, exam.mix);
      expect(result.ok).toBe(true);
    }
  });

  it('keeps points inside the Decimal(6,2) storage bound with at most two decimals', () => {
    for (const exam of demoExams) {
      expect(exam.pointsPerQuestion).toBeGreaterThanOrEqual(0.01);
      expect(exam.pointsPerQuestion).toBeLessThanOrEqual(9999.99);
      const decimals = String(exam.pointsPerQuestion).split('.')[1] ?? '';
      expect(decimals.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('open TA quiz (browser-takeable in production)', () => {
  const openQuiz = () => {
    const exam = demoExams.find(
      (e) => e.type === 'ta_quiz' && e.status === 'approved' && e.window.kind === 'open',
    );
    if (!exam) throw new Error('missing the open TA quiz');
    return exam;
  };

  it('exists as the only approved exam a normal browser can start in production', () => {
    const openTaQuizzes = demoExams.filter(
      (e) => e.type === 'ta_quiz' && e.status === 'approved' && e.window.kind === 'open',
    );
    expect(openTaQuizzes.length).toBe(1);
    expect(openTaQuizzes[0]?.quizSource).toBe('own_questions');
  });

  it('targets one section its owning TA staffs and fits the mix inside that TA own bank', () => {
    const exam = openQuiz();
    expect(bankOfOwner(exam.ownerUsername, exam.subjectCode).length).toBeGreaterThanOrEqual(
      exam.mix.easy + exam.mix.medium + exam.mix.hard,
    );
    const eligible = eligibilityUsernames(exam, demoEnrollments, demoSections);
    expect(eligible.length).toBe(6);
  });

  it('plans two resumable in-progress attempts and the rest not started', () => {
    const exam = openQuiz();
    const eligible = eligibilityUsernames(exam, demoEnrollments, demoSections);
    const plan = attemptPlanFor(exam, eligible);
    expect(Object.values(plan).filter((v) => v === 'in_progress').length).toBe(2);
    expect(Object.values(plan).filter((v) => v === 'not_started').length).toBe(4);
  });

  it('gives in-progress attempts a started time inside the window and a future deadline', () => {
    const exam = openQuiz();
    const { start, end } = examWindow(NOW, exam.window);
    expect(start.getTime()).toBeLessThan(NOW.getTime());
    expect(end.getTime()).toBeGreaterThan(NOW.getTime());
    for (const idx of [0, 1]) {
      const ts = attemptTimestamps(NOW, { start, end }, exam.durationMinutes, 'in_progress', idx);
      expect(ts.startedAt?.getTime()).toBeGreaterThan(start.getTime());
      expect(ts.startedAt?.getTime()).toBeLessThan(NOW.getTime());
      expect(ts.deadline?.getTime()).toBeGreaterThan(NOW.getTime());
      expect(ts.deadline?.getTime()).toBeLessThanOrEqual(end.getTime());
    }
  });
});

describe('attempt plans', () => {
  it('plans attempts only for approved exams', () => {
    for (const exam of demoExams) {
      if (exam.attemptPlan) expect(exam.status).toBe('approved');
      else expect(exam.status).not.toBe('approved');
    }
  });

  it('never plans more attempts than there are eligible students', () => {
    for (const exam of demoExams) {
      if (!exam.attemptPlan) continue;
      const eligible = eligibilityUsernames(exam, demoEnrollments, demoSections);
      const planned = Object.values(exam.attemptPlan).reduce((a, b) => a + b, 0);
      expect(planned).toBeLessThanOrEqual(eligible.length);
    }
  });

  it('fills the plan over eligible students in order and defaults the rest to not_started', () => {
    const students = Array.from({ length: 14 }, (_, i) => `stu${String(i + 1).padStart(2, '0')}`);
    const plan = attemptPlanFor(examByKey('final-cs415'), students);
    expect(plan.stu01).toBe('submit');
    expect(plan.stu07).toBe('submit');
    expect(plan.stu08).toBe('auto_submitted');
    expect(plan.stu12).toBe('auto_submitted');
    expect(plan.stu13).toBe('not_started');
    expect(plan.stu14).toBe('not_started');
    const open = attemptPlanFor(examByKey('practice-cs301'), students);
    expect(open.stu01).toBe('in_progress');
    expect(open.stu03).toBe('in_progress');
    expect(open.stu04).toBe('not_started');
  });

  it('schedules timestamps inside the window with a deadline that respects the duration', () => {
    for (const exam of demoExams) {
      if (!exam.attemptPlan) continue;
      const window = examWindow(NOW, exam.window);
      const eligible = eligibilityUsernames(exam, demoEnrollments, demoSections);
      const plan = attemptPlanFor(exam, eligible);
      let idx = 0;
      for (const username of eligible) {
        const entry = plan[username];
        if (entry == null) throw new Error(`attempt plan missing for ${username}`);
        const ts = attemptTimestamps(NOW, window, exam.durationMinutes, entry, idx);
        if (ts.startedAt) {
          expect(ts.startedAt.getTime()).toBeGreaterThanOrEqual(window.start.getTime());
          expect(ts.startedAt.getTime()).toBeLessThanOrEqual(window.end.getTime());
        }
        if (ts.deadline) {
          expect(ts.deadline.getTime()).toBeGreaterThanOrEqual(ts.startedAt!.getTime());
          expect(ts.deadline.getTime()).toBeLessThanOrEqual(window.end.getTime());
        }
        if (entry === 'submit') {
          expect(ts.submittedAt!.getTime()).toBeGreaterThanOrEqual(ts.startedAt!.getTime());
          expect(ts.submittedAt!.getTime()).toBeLessThanOrEqual(ts.deadline!.getTime());
        }
        if (entry === 'auto_submitted') {
          expect(ts.submittedAt!.getTime()).toBe(ts.deadline!.getTime());
        }
        if (entry === 'in_progress') {
          expect(ts.deadline!.getTime()).toBeGreaterThan(NOW.getTime());
          expect(ts.heartbeatAt!.getTime()).toBe(NOW.getTime());
          expect(ts.submittedAt).toBeNull();
        }
        if (entry === 'not_started') {
          expect(ts.startedAt).toBeNull();
        }
        idx += 1;
      }
    }
  });
});

describe('answer planning', () => {
  it('answers every question for submits, partial answers for autos, none for not_started', () => {
    expect(answeredCountFor('submit', 0, 4)).toBe(4);
    expect(answeredCountFor('not_started', 3, 4)).toBe(0);
    const autoCounts = [0, 1, 2].map((i) => answeredCountFor('auto_submitted', i, 4));
    expect(autoCounts).toEqual([1, 2, 0]);
    expect(answeredCountFor('auto_submitted', 5, 1)).toBeLessThanOrEqual(1);
    expect(answeredCountFor('in_progress', 0, 4)).toBe(1);
    expect(answeredCountFor('in_progress', 1, 4)).toBe(2);
  });

  it('produces a varied, non-extreme grade spread across the planned submits', () => {
    const exam = examByKey('final-cs415');
    const questionCount = exam.mix.easy + exam.mix.medium + exam.mix.hard;
    const points = exam.pointsPerQuestion;
    const totals = new Set<number>();
    for (let studentIdx = 0; studentIdx < 7; studentIdx++) {
      let total = 0;
      for (let order = 0; order < questionCount; order++) {
        if (isAnswerCorrect(studentIdx, order)) total += points;
      }
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThan(questionCount * points);
      totals.add(total);
    }
    expect(totals.size).toBeGreaterThanOrEqual(2);
  });

  it('never returns the correct answer as a wrong pick and always stays inside the options', () => {
    const mcqSnapshot = {
      question_type: 'mcq' as const,
      options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
      correct_answer: 'Beta',
    };
    for (let salt = 0; salt < 8; salt++) {
      const studentIdx = salt;
      const order = salt % 4;
      const answer = answerFor(mcqSnapshot, studentIdx, order);
      if (isAnswerCorrect(studentIdx, order)) {
        expect(answer).toBe('Beta');
      } else {
        expect(mcqSnapshot.options).toContain(answer);
        expect(answer).not.toBe('Beta');
      }
    }
    const tfSnapshot = {
      question_type: 'true_false' as const,
      options: [] as string[],
      correct_answer: 'true',
    };
    for (let salt = 0; salt < 8; salt++) {
      const answer = answerFor(tfSnapshot, salt, 3);
      expect(['true', 'false']).toContain(answer);
      if (!isAnswerCorrect(salt, 3)) expect(answer).toBe('false');
    }
  });

  it('flags questions only on in-progress attempts', () => {
    expect(shouldFlag('not_started', 0, 0)).toBe(false);
    expect(shouldFlag('submit', 1, 1)).toBe(false);
    expect(shouldFlag('auto_submitted', 2, 2)).toBe(false);
    const flags: boolean[] = [];
    for (let studentIdx = 0; studentIdx < 4; studentIdx++) {
      for (let order = 0; order < 4; order++) {
        flags.push(shouldFlag('in_progress', studentIdx, order));
      }
    }
    expect(flags.some(Boolean)).toBe(true);
  });
});

describe('pickCompensationTargets', () => {
  const rows = [
    { studentExamId: 's1', questionId: 'qA', selectedAnswer: 'wrong', correctAnswer: 'right' },
    { studentExamId: 's2', questionId: 'qA', selectedAnswer: null, correctAnswer: 'right' },
    { studentExamId: 's3', questionId: 'qB', selectedAnswer: 'wrong', correctAnswer: 'right' },
    { studentExamId: 's1', questionId: 'qB', selectedAnswer: 'right', correctAnswer: 'right' },
    { studentExamId: 's2', questionId: 'qB', selectedAnswer: 'right', correctAnswer: 'right' },
    { studentExamId: 's3', questionId: 'qA', selectedAnswer: 'right', correctAnswer: 'right' },
    { studentExamId: 's1', questionId: 'qC', selectedAnswer: 'right', correctAnswer: 'right' },
    { studentExamId: 's2', questionId: 'qC', selectedAnswer: 'right', correctAnswer: 'right' },
    { studentExamId: 's3', questionId: 'qC', selectedAnswer: 'right', correctAnswer: 'right' },
  ];

  it('credits the most-wrong question with up to two attempts and a different question with one', () => {
    const picked = pickCompensationTargets(rows);
    expect(picked.fullCredit).toBeDefined();
    expect(picked.fullCredit!.questionId).toBe('qA');
    expect(picked.fullCredit!.studentExamIds).toEqual(['s1', 's2']);
    expect(picked.setPoints).toBeDefined();
    expect(picked.setPoints!.questionId).toBe('qB');
    expect(picked.setPoints!.studentExamIds).toEqual(['s3']);
  });

  it('returns nothing when every attempt answered correctly', () => {
    const clean = rows.map((r) => ({ ...r, selectedAnswer: 'right' }));
    const picked = pickCompensationTargets(clean);
    expect(picked.fullCredit).toBeUndefined();
    expect(picked.setPoints).toBeUndefined();
  });

  it('falls back to full credit alone when only one question has wrong answers', () => {
    const single = rows.filter((r) => r.questionId === 'qA');
    const picked = pickCompensationTargets(single);
    expect(picked.fullCredit).toBeDefined();
    expect(picked.setPoints).toBeUndefined();
  });
});
