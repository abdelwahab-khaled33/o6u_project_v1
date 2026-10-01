/**
 * Display logic for the TA's "Sections taught" card in the Users detail panel.
 *
 * A TA teaches sections, not subjects directly: each section row carries its own subject and
 * exactly one owning TA. This file only decides how the flat section list reads — one group
 * per taught subject, each naming the sections this TA teaches in it. Anything it cannot
 * attribute honestly (another TA's sections, a section pointing at an unknown subject) is
 * left out rather than guessed at.
 */

export type TaSectionGroup = {
  subject: { id: string; code: string; name: string };
  sections: Array<{ id: string; name: string }>;
};

export function groupTaSectionsBySubject(
  sections: ReadonlyArray<{
    id: string;
    name: string;
    subject_id: string;
    ta_id: string;
  }>,
  subjects: ReadonlyArray<{ id: string; code: string; name: string }>,
  taId: string,
): TaSectionGroup[] {
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const grouped = new Map<string, TaSectionGroup>();
  for (const section of sections) {
    if (section.ta_id !== taId) continue;
    const subject = subjectById.get(section.subject_id);
    if (!subject) continue;
    const existing = grouped.get(subject.id);
    if (existing) {
      existing.sections.push({ id: section.id, name: section.name });
    } else {
      grouped.set(subject.id, {
        subject: { id: subject.id, code: subject.code, name: subject.name },
        sections: [{ id: section.id, name: section.name }],
      });
    }
  }
  return [...grouped.values()]
    .map((group) => ({
      ...group,
      sections: [...group.sections].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.subject.code.localeCompare(b.subject.code));
}
