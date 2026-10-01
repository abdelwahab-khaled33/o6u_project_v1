import { describe, it, expect } from 'vitest';
import { EXAM_DETAIL_SELECT, EXAM_LIST_SELECT, EXAM_SECRET_FIELDS } from './exam-selects.js';

const selects = {
  detail: EXAM_DETAIL_SELECT,
  list: EXAM_LIST_SELECT,
};

describe('exam serialization selects never expose access-code secrets', () => {
  for (const [name, select] of Object.entries(selects)) {
    for (const secret of EXAM_SECRET_FIELDS) {
      it(`${name} select omits ${secret}`, () => {
        expect(Object.keys(select)).not.toContain(secret);
      });
    }
  }

  it('exposes no key that matches a secret name at any depth', () => {
    const walk = (value: unknown): string[] => {
      if (Array.isArray(value)) return value.flatMap(walk);
      if (value && typeof value === 'object') {
        return Object.entries(value).flatMap(([key, nested]) => [key, ...walk(nested)]);
      }
      return [];
    };
    for (const select of Object.values(selects)) {
      for (const key of walk(select)) {
        expect(EXAM_SECRET_FIELDS).not.toContain(key);
      }
    }
  });
});

describe('exam serialization selects keep what the screens need', () => {
  it('detail keeps the scheduling, grading and ownership fields plus its relations', () => {
    for (const field of [
      'id',
      'subject_id',
      'type',
      'owner_id',
      'title',
      'status',
      'rejection_reason',
      'approved_at',
      'start_time',
      'end_time',
      'duration_minutes',
      'difficulty_mix',
      'points_per_question',
      'target_scope',
      'quiz_source',
      'subject',
      'owner',
      'pool_questions',
      'target_sections',
      'target_students',
    ]) {
      expect(Object.keys(EXAM_DETAIL_SELECT)).toContain(field);
    }
  });

  it('detail still shows the code expiry, so an owner can tell a code exists without reading it', () => {
    expect(Object.keys(EXAM_DETAIL_SELECT)).toContain('access_code_expires_at');
  });

  it('list carries the list-screen columns and the attempt count', () => {
    for (const field of [
      'id',
      'title',
      'type',
      'status',
      'rejection_reason',
      'start_time',
      'end_time',
      'duration_minutes',
      'difficulty_mix',
      'points_per_question',
      'target_scope',
      'subject',
      'owner',
      '_count',
    ]) {
      expect(Object.keys(EXAM_LIST_SELECT)).toContain(field);
    }
    expect(Object.keys(EXAM_LIST_SELECT._count.select)).toEqual(['pool_questions', 'student_exams']);
  });

  it('list does not carry the per-question pool, which only the detail screen renders', () => {
    expect(Object.keys(EXAM_LIST_SELECT)).not.toContain('pool_questions');
    expect(Object.keys(EXAM_DETAIL_SELECT)).toContain('pool_questions');
  });

  it('detail pool questions carry is_archived, so an exam referencing an archived question can name its cause', () => {
    // DELETE /question-bank/:id is a soft delete, so the ExamQuestion join row
    // survives while GET /question-bank filters the row out. Without this flag the
    // wizard renders no checkbox for the id, the coverage check miscounts, and the
    // submit fails 400 with no stated cause.
    expect(Object.keys(EXAM_DETAIL_SELECT.pool_questions.include.question.select)).toContain(
      'is_archived',
    );
  });

  it('detail pool questions carry the review fields, so an admin can verify correctness without the bank', () => {
    // The admin review screen reads GET /exams/:id, and admins are 403 on every question-bank
    // route: without these fields the only correctness check available would be the bare text.
    // The route stays owner-or-admin only, so students never see these keys.
    for (const field of ['options', 'correct_answer', 'grade', 'image_url']) {
      expect(Object.keys(EXAM_DETAIL_SELECT.pool_questions.include.question.select)).toContain(field);
    }
  });
});
