import { describe, expect, it } from 'vitest';

import { groupTaSectionsBySubject } from './taSectionsModel';

const TA = 'ta-ta-ta-ta-tata000001';
const OTHER = 'ta-ta-ta-ta-tata000002';
const SUB_A = { id: 'aaaaaaaa-aaaa-4111-8111-aaaaaaaaaaaa', code: 'CS81143', name: 'Subject A' };
const SUB_B = { id: 'bbbbbbbb-bbbb-4222-8222-bbbbbbbbbbbb', code: 'SEC4938', name: 'Subject B' };

const sec = (over: Record<string, unknown>) => ({
  id: 's',
  name: 'Group',
  subject_id: SUB_A.id,
  ta_id: TA,
  subject: { code: SUB_A.code, name: SUB_A.name },
  ...over,
});

describe('groupTaSectionsBySubject', () => {
  it('groups this TA sections under their subject with the section names', () => {
    const groups = groupTaSectionsBySubject(
      [
        sec({ id: 's1', name: 'Group 2' }),
        sec({ id: 's2', name: 'Group 1' }),
      ],
      [SUB_A],
      TA,
    );

    expect(groups).toEqual([
      {
        subject: SUB_A,
        sections: [
          { id: 's2', name: 'Group 1' },
          { id: 's1', name: 'Group 2' },
        ],
      },
    ]);
  });

  it('shows every taught subject with its own sections, ordered by subject code', () => {
    const groups = groupTaSectionsBySubject(
      [
        sec({ id: 'sb', subject_id: SUB_B.id, subject: { code: SUB_B.code, name: SUB_B.name } }),
        sec({ id: 'sa' }),
      ],
      [SUB_B, SUB_A],
      TA,
    );

    expect(groups.map((group) => group.subject.code)).toEqual(['CS81143', 'SEC4938']);
    expect(groups[1]?.sections).toEqual([{ id: 'sb', name: 'Group' }]);
  });

  it('hides sections taught by other TAs instead of attributing them here', () => {
    const groups = groupTaSectionsBySubject([sec({ id: 's1', ta_id: OTHER })], [SUB_A], TA);
    expect(groups).toEqual([]);
  });

  it('skips sections whose subject is unknown rather than rendering a header it cannot name', () => {
    const groups = groupTaSectionsBySubject(
      [sec({ id: 's1', subject_id: 'cccccccc-cccc-4333-8333-cccccccccccc' })],
      [SUB_A],
      TA,
    );
    expect(groups).toEqual([]);
  });
});
