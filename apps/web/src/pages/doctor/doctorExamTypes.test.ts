import { describe, it, expect } from 'vitest';
import {
  editOutcomeExplainer,
  editOutcomeNotice,
  pointsValue,
  canDeleteExam,
  isUpcoming,
} from './doctorExamTypes';

describe('editOutcomeNotice', () => {
  it('says an approved exam goes back for approval, because exams.ts resets it to pending_approval', () => {
    expect(editOutcomeNotice('approved', 'Compiler final'))
      .toBe('Updated "Compiler final". It is back with the administrator for approval.');
  });

  it('does not claim an approval queue for a rejected exam, which exams.ts leaves rejected', () => {
    const notice = editOutcomeNotice('rejected', 'Compiler final');
    expect(notice).toBe('Updated "Compiler final". It is still rejected, so it has not gone back for approval.');
    expect(notice).not.toContain('back with the administrator for approval');
  });

  it('says a pending exam is still waiting rather than newly submitted', () => {
    expect(editOutcomeNotice('pending_approval', 'Compiler final'))
      .toBe('Updated "Compiler final". It is still waiting for an administrator to approve it.');
  });

  it('names the status it kept for any other status', () => {
    expect(editOutcomeNotice('draft', 'Compiler final'))
      .toBe('Updated "Compiler final". Its status is still Draft.');
  });
});

describe('editOutcomeExplainer', () => {
  it('describes the reset for an approved exam', () => {
    expect(editOutcomeExplainer('approved'))
      .toContain('sends this exam back to an administrator for approval');
  });

  it('tells a rejected exam that saving is not a way back, and says what is', () => {
    const text = editOutcomeExplainer('rejected');
    expect(text).toContain('does not put a rejected exam back in the queue');
    expect(text).toContain('Delete this exam and create a new one');
    expect(text).not.toContain('sends this exam back to an administrator for approval');
  });

  it('tells a pending exam that it stays in the queue', () => {
    expect(editOutcomeExplainer('pending_approval')).toContain('still waiting for an administrator');
  });

  it('always mentions that saving clears generated attempts, which exams.ts does unconditionally', () => {
    for (const status of ['approved', 'rejected', 'pending_approval', 'draft'] as const) {
      expect(editOutcomeExplainer(status)).toContain('clears the attempts already generated');
    }
  });

  it('falls back to describing the current status before the exam has loaded', () => {
    expect(editOutcomeExplainer(null)).toContain('clears the attempts already generated');
  });
});

describe('pointsValue', () => {
  it('reads the Decimal the API sends as a string', () => {
    expect(pointsValue('3')).toBe(3);
    expect(pointsValue('2.50')).toBe(2.5);
    expect(pointsValue(3)).toBe(3);
  });

  it('does not produce NaN for something unparseable', () => {
    expect(pointsValue('nonsense')).toBe(0);
  });
});

describe('isUpcoming and canDeleteExam', () => {
  const now = Date.parse('2026-10-01T09:00:00.000Z');

  it('agrees with the server on whether an exam has started', () => {
    expect(isUpcoming('2026-10-01T10:00:00.000Z', now)).toBe(true);
    expect(isUpcoming('2026-10-01T08:00:00.000Z', now)).toBe(false);
  });

  it('allows deleting an approved exam only while it has not started', () => {
    expect(canDeleteExam({ start_time: '2026-10-01T10:00:00.000Z', status: 'approved' }, now)).toBe(true);
    expect(canDeleteExam({ start_time: '2026-10-01T08:00:00.000Z', status: 'approved' }, now)).toBe(false);
  });

  it('allows deleting an exam that was never approved, however old', () => {
    expect(canDeleteExam({ start_time: '2026-09-01T08:00:00.000Z', status: 'rejected' }, now)).toBe(true);
  });
});
