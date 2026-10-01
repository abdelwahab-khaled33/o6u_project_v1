import { describe, expect, it } from 'vitest';

import {
  buildEnrollmentBodies,
  createPicksProblems,
  type SubjectPick,
} from './createUserAssignmentsModel';

const SUB_A = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', code: 'CS81143' };
const SUB_B = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', code: 'SEC4938' };
const SEC_A1 = { id: 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', subject_id: SUB_A.id };
const SEC_A2 = { id: 'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2', subject_id: SUB_A.id };
const SEC_B1 = { id: 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1', subject_id: SUB_B.id };
const STUDENT = '99999999-9999-4999-8999-999999999999';

describe('createPicksProblems', () => {
  it('accepts an empty pick list: subjects are optional at create time', () => {
    expect(createPicksProblems([], [SUB_A], [SEC_A1])).toEqual([]);
  });

  it('accepts several subjects each with its own section', () => {
    const picks: SubjectPick[] = [
      { subjectId: SUB_A.id, sectionId: SEC_A1.id },
      { subjectId: SUB_B.id, sectionId: SEC_B1.id },
    ];
    expect(createPicksProblems(picks, [SUB_A, SUB_B], [SEC_A1, SEC_A2, SEC_B1])).toEqual([]);
  });

  it('refuses a ticked subject with no section chosen', () => {
    const problems = createPicksProblems([{ subjectId: SUB_A.id, sectionId: '' }], [SUB_A], [SEC_A1]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('CS81143');
  });

  it('refuses a section that belongs to another subject', () => {
    const problems = createPicksProblems([{ subjectId: SUB_A.id, sectionId: SEC_B1.id }], [SUB_A, SUB_B], [SEC_B1]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('CS81143');
  });

  it('refuses an unknown subject id instead of sending it to the server', () => {
    const problems = createPicksProblems(
      [{ subjectId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', sectionId: SEC_A1.id }],
      [SUB_A],
      [SEC_A1],
    );
    expect(problems).toHaveLength(1);
  });
});

describe('buildEnrollmentBodies', () => {
  it('builds one enrollment body per picked subject', () => {
    expect(
      buildEnrollmentBodies(STUDENT, [
        { subjectId: SUB_A.id, sectionId: SEC_A1.id },
        { subjectId: SUB_B.id, sectionId: SEC_B1.id },
      ]),
    ).toEqual([
      { student_id: STUDENT, subject_id: SUB_A.id, section_id: SEC_A1.id },
      { student_id: STUDENT, subject_id: SUB_B.id, section_id: SEC_B1.id },
    ]);
  });

  it('refuses to build bodies with no student, instead of sending one the server rejects', () => {
    expect(buildEnrollmentBodies('', [{ subjectId: SUB_A.id, sectionId: SEC_A1.id }])).toBeNull();
    expect(buildEnrollmentBodies('   ', [{ subjectId: SUB_A.id, sectionId: SEC_A1.id }])).toBeNull();
  });
});
