import { describe, it, expect } from 'vitest';
import { adminExamListQuerySchema } from './admin-exams.js';

describe('adminExamListQuerySchema', () => {
  it('accepts each real exam status, so the approval screen can filter by it', () => {
    for (const status of ['pending_approval', 'approved', 'rejected']) {
      const parsed = adminExamListQuerySchema.safeParse({ status });
      expect(parsed.success, status).toBe(true);
    }
  });

  it('accepts an absent status', () => {
    expect(adminExamListQuerySchema.safeParse({}).success).toBe(true);
  });

  it("accepts the empty string, because the UI's \"All statuses\" option sends it", () => {
    // The exams screen has an "All statuses" option whose option value is the empty
    // string, so a bare z.enum(...).optional() would answer 400 to a request the
    // front end genuinely makes. This case is the reason the union is explicit.
    expect(adminExamListQuerySchema.safeParse({ status: '' }).success).toBe(true);
  });

  it('rejects a misspelled status instead of silently ignoring it', () => {
    // The bug this pins: the route used to fall through to "no filter" for any
    // unrecognised value, so a typo on the approval screen quietly widened the
    // result set to every exam in the term.
    expect(adminExamListQuerySchema.safeParse({ status: 'aproveed' }).success).toBe(false);
  });

  it('rejects the statuses that only exist on the owner-side exam list', () => {
    // /exams accepts these because an exam can pass through them, but the admin
    // approval screen must not be filterable by them.
    for (const status of ['draft', 'locked', 'closed']) {
      expect(adminExamListQuerySchema.safeParse({ status }).success, status).toBe(false);
    }
  });
});
