/* eslint-disable react-hooks/set-state-in-effect -- this page fetches from the API on mount and whenever a filter changes; the fetched data cannot be derived during render */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Input, Select } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { Table } from '../../components/ui/Table';
import { api } from '../../lib/api';
import { describeError, EmptyState, formatDateTime, formValue, plural, ROLE_OPTIONS, type AdminUser, type Section, type Subject } from './adminShared';
import {
  assignmentSectionForRole,
  buildAssignmentBody,
  canSave,
  saveNotice,
} from './doctorAssignmentsModel';
import {
  buildEnrollmentBodies,
  createPicksProblems,
  type SubjectPick,
} from './createUserAssignmentsModel';
import { groupTaSectionsBySubject, type TaSectionGroup } from './taSectionsModel';

const PAGE_SIZE = 25;

type Filters = { search: string; role: string; subject_id: string; section_id: string };

const NO_FILTERS: Filters = { search: '', role: '', subject_id: '', section_id: '' };

type UserListResponse = {
  users: AdminUser[];
  total: number;
  page: number;
  page_size: number;
};

type EnrollmentResponse = {
  enrollment: { student_id: string; subject_id: string };
  membership: { student_id: string; section_id: string };
  removed_memberships: number;
};

function CanChangePasswordField({ role, defaultChecked, id }: { role: string; defaultChecked: boolean; id: string }) {
  if (role === 'student') return null;
  return (
    <label className="flex items-center gap-[9px] font-semibold [&_input]:h-[17px] [&_input]:w-[17px] [&_input]:accent-[#455B8A]" htmlFor={id}>
      <input id={id} name="can_change_password" type="checkbox" defaultChecked={defaultChecked} />
      Can change password
    </label>
  );
}

function CreateUserCard({ subjects, sections, onCreated }: { subjects: Subject[]; sections: Section[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<string>('student');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pickedSubjects, setPickedSubjects] = useState<Set<string>>(new Set());
  const [sectionBySubject, setSectionBySubject] = useState<Record<string, string>>({});

  function selectRole(next: string) {
    setRole(next);
    setPickedSubjects(new Set());
    setSectionBySubject({});
  }

  function togglePickedSubject(id: string) {
    setNote(null);
    setPickedSubjects((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function chooseSection(subjectId: string, sectionId: string) {
    setNote(null);
    setSectionBySubject((current) => ({ ...current, [subjectId]: sectionId }));
  }

  // The form reads picks from state rather than FormData: the per-subject section selects only
  // exist for ticked subjects, so an uncontrolled read could not tell "unticked" from "missing".
  const picks: SubjectPick[] = [...pickedSubjects].map((subjectId) => ({
    subjectId,
    sectionId: sectionBySubject[subjectId] ?? '',
  }));
  const pickProblems = role === 'student' ? createPicksProblems(picks, subjects, sections) : [];

  function resetPicks() {
    setPickedSubjects(new Set());
    setSectionBySubject({});
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pickProblems.length > 0) return;
    setSaving(true);
    setError(null);
    setCreated(null);
    setNote(null);
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      username: formValue(form, 'username').trim(),
      full_name: formValue(form, 'full_name').trim(),
      role: formValue(form, 'role'),
      password: formValue(form, 'password'),
      is_active: form.get('is_active') === 'on',
    };
    const studentCode = formValue(form, 'student_code').trim();
    if (studentCode) payload.student_code = studentCode;
    if (role !== 'student') payload.can_change_password = form.get('can_change_password') === 'on';
    try {
      const result = await api.post<{ user: AdminUser }>('/admin/users', payload);
      const createdRole = result.user.role;
      const createdId = result.user.id;

      // POST /admin/users writes the account row only, so the subjects picked above become
      // follow-up requests against the id the POST echoed back. Each enrollment is its own
      // PUT because the route enrolls exactly one subject per call; the calls are sequential
      // so the first refusal stops the chain with the count of what actually landed.
      if (createdRole === 'student' && picks.length > 0) {
        const bodies = buildEnrollmentBodies(createdId, picks);
        let saved = 0;
        let failure: string | null = null;
        if (bodies !== null) {
          for (const body of bodies) {
            try {
              await api.put('/admin/enrollments', body);
              saved += 1;
            } catch (caught) {
              failure = describeError(caught);
              break;
            }
          }
        }
        if (failure === null) {
          setCreated(`Created ${result.user.username} (student). Enrolled in ${bodies?.length ?? 0} subject${saved === 1 ? '' : 's'}.`);
        } else {
          setNote(
            `Created ${result.user.username} (student), but only ${saved} of ${picks.length} enrollments saved: ${failure} ` +
            `Open the user to finish the enrollment.`,
          );
        }
      } else if (createdRole === 'doctor' && pickedSubjects.size > 0) {
        const body = buildAssignmentBody(createdId, [...pickedSubjects]);
        try {
          if (body === null) throw new Error('No doctor to assign.');
          const written = await api.put<{ subject_ids: string[] }>('/admin/doctor-assignments', body);
          setCreated(`Created ${result.user.username} (doctor). Assigned ${written.subject_ids.length} subject${written.subject_ids.length === 1 ? '' : 's'}.`);
        } catch (caught) {
          setNote(`Created ${result.user.username} (doctor), but saving subjects failed: ${describeError(caught)} Open the user to assign subjects.`);
        }
      } else {
        setCreated(`Created ${result.user.username} (${createdRole}).`);
      }
      setOpen(false);
      resetPicks();
      onCreated();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-5 grid gap-[18px]">
        {created && <Alert variant="success">{created}</Alert>}
        {note && <Alert variant="info">{note}</Alert>}
        <div><Button onClick={() => { setOpen(true); setCreated(null); setNote(null); }}>Create user</Button></div>
      </div>
    );
  }

  return (
    <form className="mt-5 grid gap-[18px]" onSubmit={(event) => { void submit(event); }}>
      <h3>Create user</h3>
      {error && <Alert>{error}</Alert>}
      <Field label="Username" htmlFor="new-username">
        <Input id="new-username" name="username" maxLength={100} required />
      </Field>
      <Field label="Full name" htmlFor="new-full-name">
        <Input id="new-full-name" name="full_name" required />
      </Field>
      <Field label="Role" htmlFor="new-role">
        <Select id="new-role" name="role" value={role} onChange={(event) => selectRole(event.target.value)}>
          {ROLE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        </Select>
      </Field>
      {role === 'student' && (
        <Field label="Student code" htmlFor="new-student-code">
          <Input id="new-student-code" name="student_code" maxLength={50} />
        </Field>
      )}
      {role === 'student' && (
        <fieldset className="m-0 grid gap-2.5 border-0 p-0">
          <legend>Enroll in subjects (optional)</legend>
          {subjects.length === 0 ? (
            <p className="font-normal text-muted">There are no subjects yet. Create the account bare and enroll it later.</p>
          ) : (
            <>
              {pickProblems.length > 0 && (
                <ul className="m-0 grid gap-1 pl-5 font-normal text-muted">
                  {pickProblems.map((problem) => <li key={problem}>{problem}</li>)}
                </ul>
              )}
              {subjects.map((subject) => {
                const ticked = pickedSubjects.has(subject.id);
                const subjectSections = sections.filter((section) => section.subject_id === subject.id);
                return (
                  <div key={subject.id}>
                    <label className="flex items-center gap-[9px] font-semibold [&_input]:h-[17px] [&_input]:w-[17px] [&_input]:accent-[#455B8A]" htmlFor={`new-enroll-${subject.id}`}>
                      <input
                        id={`new-enroll-${subject.id}`}
                        type="checkbox"
                        checked={ticked}
                        onChange={() => togglePickedSubject(subject.id)}
                      />
                      {subject.code} &mdash; {subject.name}
                    </label>
                    {ticked && (
                      <Field label={`Section in ${subject.code}`} htmlFor={`new-enroll-section-${subject.id}`}>
                        <Select
                          id={`new-enroll-section-${subject.id}`}
                          value={sectionBySubject[subject.id] ?? ''}
                          onChange={(event) => chooseSection(subject.id, event.target.value)}
                        >
                          <option value="">Select a section</option>
                          {subjectSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
                        </Select>
                      </Field>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </fieldset>
      )}
      {role === 'doctor' && (
        <fieldset className="m-0 grid gap-2.5 border-0 p-0">
          <legend>Subjects taught (optional)</legend>
          {subjects.length === 0 ? (
            <p className="font-normal text-muted">There are no subjects yet. Create the account bare and assign subjects later.</p>
          ) : (
            subjects.map((subject) => (
              <label className="flex items-center gap-[9px] font-semibold [&_input]:h-[17px] [&_input]:w-[17px] [&_input]:accent-[#455B8A]" key={subject.id} htmlFor={`new-teach-${subject.id}`}>
                <input
                  id={`new-teach-${subject.id}`}
                  type="checkbox"
                  checked={pickedSubjects.has(subject.id)}
                  onChange={() => togglePickedSubject(subject.id)}
                />
                {subject.code} &mdash; {subject.name}
              </label>
            ))
          )}
        </fieldset>
      )}
      <Field label="Password (8 to 72 characters)" htmlFor="new-password">
        <Input id="new-password" name="password" type="password" minLength={8} maxLength={72} required />
      </Field>
      <CanChangePasswordField role={role} defaultChecked id="new-can-change-password" />
      <label className="flex items-center gap-[9px] font-semibold [&_input]:h-[17px] [&_input]:w-[17px] [&_input]:accent-[#455B8A]" htmlFor="new-is-active">
        <input id="new-is-active" name="is_active" type="checkbox" defaultChecked /> Active
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving || pickProblems.length > 0}>{saving ? 'Creating…' : 'Create user'}</Button>
        <Button type="button" variant="secondary" onClick={() => { setOpen(false); setError(null); resetPicks(); }}>Cancel</Button>
      </div>
    </form>
  );
}

function ResetPasswordCard({ user, onReset }: { user: AdminUser; onReset: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setDone(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api.post(`/admin/users/${user.id}/reset-password`, { new_password: formValue(form, 'new_password') });
      setDone(`Password reset for ${user.username}.`);
      formElement.reset();
      onReset();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="mt-5 grid gap-[18px]" onSubmit={(event) => { void submit(event); }}>
      <h4>Reset password for {user.username}</h4>
      {error && <Alert>{error}</Alert>}
      {done && <Alert variant="success">{done}</Alert>}
      <Field label="New password (8 to 72 characters)" htmlFor={`reset-password-${user.id}`}>
        <Input id={`reset-password-${user.id}`} name="new_password" type="password" minLength={8} maxLength={72} required />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Reset password'}</Button>
      </div>
    </form>
  );
}

function EnrollmentCard({ user, subjects, sections }: { user: AdminUser; subjects: Subject[]; sections: Section[] }) {
  const [subjectId, setSubjectId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const sectionsForSubject = useMemo(
    () => sections.filter((section) => section.subject_id === subjectId),
    [sections, subjectId],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setResult(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await api.put<EnrollmentResponse>('/admin/enrollments', {
        student_id: user.id,
        subject_id: formValue(form, 'subject_id'),
        section_id: formValue(form, 'section_id'),
      });
      const removed = response.removed_memberships;
      setResult(removed > 0
        ? `Saved. ${plural(removed, 'previous section membership')} in this subject ${removed === 1 ? 'was' : 'were'} removed, so the student now belongs to exactly one section.`
        : 'Saved. The student belongs to exactly one section in this subject.');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  }

  if (user.role !== 'student') {
    return (
      <section className="mt-5 grid gap-[18px]">
        <h4>Enrollment</h4>
        <p className="font-normal text-muted">Enrollment applies to users with the student role. This account has the {user.role} role.</p>
      </section>
    );
  }

  return (
    <form className="mt-5 grid gap-[18px]" onSubmit={(event) => { void submit(event); }}>
      <h4>Enrollment</h4>
      <p className="font-normal text-muted">Each student belongs to exactly one section per enrolled subject. Saving moves the student out of any other section of the same subject.</p>
      {error && <Alert>{error}</Alert>}
      {result && <Alert variant="success">{result}</Alert>}
      <Field label="Subject" htmlFor={`enrollment-subject-${user.id}`}>
        <Select
          id={`enrollment-subject-${user.id}`}
          name="subject_id"
          value={subjectId}
          required
          onChange={(event) => { setSubjectId(event.target.value); setSectionId(''); }}
        >
          <option value="" disabled>Select a subject</option>
          {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.code} — {subject.name}</option>)}
        </Select>
      </Field>
      <Field label="Section" htmlFor={`enrollment-section-${user.id}`}>
        <Select
          id={`enrollment-section-${user.id}`}
          name="section_id"
          value={sectionId}
          required
          disabled={!subjectId || sectionsForSubject.length === 0}
          onChange={(event) => setSectionId(event.target.value)}
        >
          <option value="" disabled>{subjectId ? 'Select a section' : 'Select a subject first'}</option>
          {sectionsForSubject.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
        </Select>
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving || !subjectId || !sectionId}>{saving ? 'Saving…' : 'Save enrollment'}</Button>
      </div>
    </form>
  );
}

/**
 * The subjects a doctor teaches, edited from inside the Users detail panel. This is the same
 * editor as AdminDoctorAssignmentsPage with the doctor fixed: the same GET read, the same PUT
 * write through buildAssignmentBody (so multi-subject selection is native — one checkbox per
 * subject), and the same guards. `assigned === empty` and "never read" share a rendering, so
 * the picker and the save button only exist after a successful read; anything else would turn
 * a failed GET into a silent clear of everything the doctor teaches.
 */
function DoctorSubjectsCard({ userId, username }: { userId: string; username: string }) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [assignmentsLoaded, setAssignmentsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadAll = useCallback(async (): Promise<string | null> => {
    setLoading(true);
    try {
      const [subjectResult, assignmentResult] = await Promise.all([
        api.get<{ subjects: Subject[] }>('/admin/subjects'),
        api.get<{ doctor_id: string; subject_ids: string[] }>(`/admin/doctor-assignments/${userId}`),
      ]);
      setSubjects(subjectResult.subjects);
      setAssigned(new Set(assignmentResult.subject_ids));
      setAssignmentsLoaded(true);
      setError(null);
      return null;
    } catch (caught) {
      setSubjects(null);
      setAssigned(new Set());
      setAssignmentsLoaded(false);
      const failure = describeError(caught);
      setError(failure);
      return failure;
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  function toggleSubject(id: string) {
    setNotice(null);
    setAssigned((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    const body = buildAssignmentBody(userId, [...assigned]);
    if (body === null) return;

    setSaving(true);
    setNotice(null);
    let written: { subject_ids: string[]; removed_assignments: number } | null = null;
    let failure: string | null = null;
    try {
      written = await api.put<{ subject_ids: string[]; removed_assignments: number }>('/admin/doctor-assignments', body);
    } catch (caught) {
      failure = describeError(caught);
    }

    const rereadError = await loadAll();
    setError(
      failure === null
        ? rereadError
        : rereadError === null
          ? failure
          : `${failure} The saved state could not be re-read either: ${rereadError}`,
    );
    setNotice(written === null ? null : saveNotice(written.removed_assignments, written.subject_ids));
    setSaving(false);
  }

  const assignedCount = assigned.size;
  const saveDisabled = saving || loading || !canSave({ doctorId: userId, subjectsLoaded: subjects !== null, assignmentsLoaded });

  return (
    <section className="mt-5 grid gap-[18px]">
      <h4>Subjects taught</h4>
      {loading ? (
        <div><Spinner label="Loading subjects" /> Loading subjects…</div>
      ) : (
        <>
          {error && <Alert>{error}</Alert>}
          {notice && <Alert variant="success">{notice}</Alert>}
          {!assignmentsLoaded || subjects === null ? (
            <Alert>
              This doctor&rsquo;s subjects could not be read, so there is nothing here to change — saving from this
              state would clear the doctor&rsquo;s subjects rather than edit them.
            </Alert>
          ) : subjects.length === 0 ? (
            <EmptyState>There are no subjects yet, so there is nothing to assign. Create a subject first.</EmptyState>
          ) : (
            <fieldset className="m-0 grid gap-2.5 border-0 p-0">
              <legend>Subjects assigned to {username}</legend>
              <p className="font-normal text-muted">
                {assignedCount === 0
                  ? 'None ticked. A doctor may teach several subjects — tick every one that applies. Saving with nothing ticked removes every subject from this doctor.'
                  : `${assignedCount} subject${assignedCount === 1 ? '' : 's'} ticked. A doctor may teach several subjects — tick every one that applies.`}
              </p>
              {subjects.map((subject) => (
                <label className="flex items-center gap-[9px] font-semibold [&_input]:h-[17px] [&_input]:w-[17px] [&_input]:accent-[#455B8A]" key={subject.id} htmlFor={`user-subject-${userId}-${subject.id}`}>
                  <input
                    id={`user-subject-${userId}-${subject.id}`}
                    type="checkbox"
                    checked={assigned.has(subject.id)}
                    disabled={saving}
                    onChange={() => toggleSubject(subject.id)}
                  />
                  {subject.code} &mdash; {subject.name}
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => { void save(); }} disabled={saveDisabled}>{saving ? 'Saving…' : 'Save subjects'}</Button>
          </div>
        </>
      )}
    </section>
  );
}

type StudentEnrollmentRead = {
  student_id: string;
  enrollments: Array<{
    subject: { id: string; code: string; name: string };
    section: { id: string; name: string } | null;
  }>;
};

/**
 * The subjects a student is enrolled in, read-only. The section is shown per subject because
 * enrollment here is always subject-plus-section; a null section is rendered as its own fact
 * ("no section recorded") rather than dropping the row, so a broken enrollment cannot hide.
 */
function StudentEnrollmentsCard({ userId }: { userId: string }) {
  const [enrollments, setEnrollments] = useState<StudentEnrollmentRead['enrollments'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await api.get<StudentEnrollmentRead>(`/admin/enrollments/${userId}`);
        if (!cancelled) {
          setEnrollments(data.enrollments);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setEnrollments(null);
          setError(describeError(caught));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <section className="mt-5 grid gap-[18px]">
      <h4>Enrolled subjects</h4>
      {loading ? (
        <div><Spinner label="Loading enrollments" /> Loading enrollments…</div>
      ) : error !== null ? (
        <Alert>{error}</Alert>
      ) : enrollments !== null && enrollments.length > 0 ? (
        <ul className="m-0 grid max-h-[340px] list-none gap-0.5 overflow-y-auto rounded-md border border-[#dfe5f0] bg-white p-1.5 [&_li:hover]:bg-[#edf0f6] [&_li]:rounded [&_li]:px-[7px] [&_li]:py-[5px]">
          {enrollments.map((enrollment) => (
            <li key={enrollment.subject.id}>
              {enrollment.subject.code} &mdash; {enrollment.subject.name}
              <span className="font-normal text-muted"> — {enrollment.section ? enrollment.section.name : 'no section recorded'}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>This student is not enrolled in any subject yet.</EmptyState>
      )}
    </section>
  );
}

/**
 * The subjects a TA teaches with their sections, read-only. Grouped by subject so each
 * subject heads exactly the sections this TA teaches in it; sections owned by other TAs
 * never appear here, and the grouping helper (unit-tested) is what guarantees that.
 */
function TaSectionsCard({ userId, username }: { userId: string; username: string }) {
  const [groups, setGroups] = useState<TaSectionGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [subjectResult, sectionResult] = await Promise.all([
          api.get<{ subjects: Subject[] }>('/admin/subjects'),
          api.get<{ sections: Section[] }>('/admin/sections'),
        ]);
        if (!cancelled) {
          setGroups(groupTaSectionsBySubject(sectionResult.sections, subjectResult.subjects, userId));
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setGroups(null);
          setError(describeError(caught));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <section className="mt-5 grid gap-[18px]">
      <h4>Sections taught</h4>
      {loading ? (
        <div><Spinner label="Loading sections" /> Loading sections…</div>
      ) : error !== null ? (
        <Alert>{error}</Alert>
      ) : groups !== null && groups.length > 0 ? (
        <div className="mt-5 grid gap-[18px]">
          {groups.map((group) => (
            <div key={group.subject.id}>
              <p className="font-bold">{group.subject.code} &mdash; {group.subject.name}</p>
              <ul className="m-0 grid max-h-[340px] list-none gap-0.5 overflow-y-auto rounded-md border border-[#dfe5f0] bg-white p-1.5 [&_li:hover]:bg-[#edf0f6] [&_li]:rounded [&_li]:px-[7px] [&_li]:py-[5px]">
                {group.sections.map((section) => <li key={section.id}>{section.name}</li>)}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState>{`${username} does not teach any section yet.`}</EmptyState>
      )}
    </section>
  );
}

function UserDetailCard({
  user,
  subjects,
  sections,
  onSaved,
  onClose,
}: {
  user: AdminUser;
  subjects: Subject[];
  sections: Section[];
  onSaved: (updated: AdminUser) => void;
  onClose: () => void;
}) {
  const [role, setRole] = useState<AdminUser['role']>(user.role);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setDone(null);
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      full_name: formValue(form, 'full_name').trim(),
      role: formValue(form, 'role'),
      is_active: form.get('is_active') === 'on',
    };
    const studentCode = formValue(form, 'student_code').trim();
    payload.student_code = studentCode === '' ? null : studentCode;
    if (role !== 'student') payload.can_change_password = form.get('can_change_password') === 'on';
    try {
      const result = await api.patch<{ user: AdminUser }>(`/admin/users/${user.id}`, payload);
      setDone('Saved.');
      onSaved(result.user);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mt-2 border-t-4 border-t-accent">
      <div className="flex items-center justify-between gap-3">
        <h3>User detail — {user.username}</h3>
        <Button variant="text" onClick={onClose}>Close</Button>
      </div>
      <form className="mt-5 grid gap-[18px]" onSubmit={(event) => { void submit(event); }}>
        {error && <Alert>{error}</Alert>}
        {done && <Alert variant="success">{done}</Alert>}
        <Field label="Full name" htmlFor={`detail-full-name-${user.id}`}>
          <Input id={`detail-full-name-${user.id}`} name="full_name" defaultValue={user.full_name} required />
        </Field>
        <Field label="Role" htmlFor={`detail-role-${user.id}`}>
          <Select
            id={`detail-role-${user.id}`}
            name="role"
            value={role}
            onChange={(event) => setRole(event.target.value as AdminUser['role'])}
          >
            {ROLE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </Select>
        </Field>
        <Field label="Student code" htmlFor={`detail-student-code-${user.id}`}>
          <Input id={`detail-student-code-${user.id}`} name="student_code" defaultValue={user.student_code ?? ''} maxLength={50} />
        </Field>
        <CanChangePasswordField role={role} defaultChecked={user.can_change_password} id={`detail-can-change-password-${user.id}`} />
        <label className="flex items-center gap-[9px] font-semibold [&_input]:h-[17px] [&_input]:w-[17px] [&_input]:accent-[#455B8A]" htmlFor={`detail-is-active-${user.id}`}>
          <input id={`detail-is-active-${user.id}`} name="is_active" type="checkbox" defaultChecked={user.is_active} /> Active
        </label>
        <p className="font-normal text-muted">Created {formatDateTime(user.created_at)}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          <Link to={`/admin/permissions?user=${user.id}`}>Permission overrides for {user.username}</Link>
        </div>
      </form>
      <ResetPasswordCard user={user} onReset={() => onSaved(user)} />
      {assignmentSectionForRole(user.role) === 'student-enrollments' && (
        <StudentEnrollmentsCard key={`enrollments-${user.id}`} userId={user.id} />
      )}
      <EnrollmentCard user={user} subjects={subjects} sections={sections} />
      {assignmentSectionForRole(user.role) === 'doctor-subjects' && (
        <DoctorSubjectsCard key={user.id} userId={user.id} username={user.username} />
      )}
      {assignmentSectionForRole(user.role) === 'ta-sections' && (
        <TaSectionsCard key={`sections-${user.id}`} userId={user.id} username={user.username} />
      )}
    </Card>
  );
}

export function AdminUsersPage() {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [searchDraft, setSearchDraft] = useState('');
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminUser | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadStructure = useCallback(async () => {
    const [subjectResult, sectionResult] = await Promise.all([
      api.get<{ subjects: Subject[] }>('/admin/subjects'),
      api.get<{ sections: Section[] }>('/admin/sections'),
    ]);
    setSubjects(subjectResult.subjects);
    setSections(sectionResult.sections);
  }, []);

  const loadUsers = useCallback(async () => {
    const query = new URLSearchParams();
    if (filters.search) query.set('search', filters.search);
    if (filters.role) query.set('role', filters.role);
    if (filters.subject_id) query.set('subject_id', filters.subject_id);
    if (filters.section_id) query.set('section_id', filters.section_id);
    query.set('page', String(page));
    query.set('page_size', String(PAGE_SIZE));
    try {
      const result = await api.get<UserListResponse>(`/admin/users?${query.toString()}`);
      setTotal(result.total);
      const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
      if (result.users.length === 0 && page > lastPage) {
        setPage(lastPage);
        return;
      }
      setUsers(result.users);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { void loadStructure(); }, [loadStructure]);
  useEffect(() => { void loadUsers(); }, [loadUsers]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadUsers(), loadStructure()]);
  }, [loadUsers, loadStructure]);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sectionsForFilter = useMemo(
    () => sections.filter((section) => !filters.subject_id || section.subject_id === filters.subject_id),
    [sections, filters.subject_id],
  );

  function applyFilters(next: Filters) {
    setLoading(true);
    setPage(1);
    setFilters(next);
  }

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applyFilters({ ...filters, search: searchDraft.trim() });
  }

  function updateFilter(key: keyof Filters, value: string) {
    const next: Filters = { ...filters, [key]: value };
    if (key === 'subject_id') next.section_id = '';
    applyFilters(next);
  }

  async function toggleActive(user: AdminUser) {
    setBusyId(user.id);
    setError(null);
    try {
      await api.patch(`/admin/users/${user.id}`, { is_active: !user.is_active });
      await refreshAll();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusyId(null);
    }
  }

  function handleSaved(updated: AdminUser) {
    setDetail((current) => (current && current.id === updated.id ? updated : current));
    setNotice(`Saved ${updated.username}.`);
    void refreshAll();
  }

  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);

  return (
    <Card>
      <h2>Users</h2>
      <p className="font-normal text-muted">Search and filter server-side, then open a user to edit the account, reset its password, manage enrollment, or assign a doctor&rsquo;s subjects.</p>
      <div className="mt-5 grid gap-[18px]">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert variant="success" >{notice}</Alert>}

        <form className="flex flex-wrap items-end gap-3 rounded-[14px] border border-[#dfe5f0] bg-white p-4 shadow-[0_4px_14px_rgb(36_52_80/7%)]" onSubmit={applySearch}>
          <Field label="Search users" htmlFor="user-search">
            <Input
              id="user-search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Username, full name or student code"
            />
          </Field>
          <Field label="Role" htmlFor="user-role-filter">
            <Select id="user-role-filter" value={filters.role} onChange={(event) => updateFilter('role', event.target.value)}>
              <option value="">All roles</option>
              {ROLE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </Select>
          </Field>
          <Field label="Subject" htmlFor="user-subject-filter">
            <Select id="user-subject-filter" value={filters.subject_id} onChange={(event) => updateFilter('subject_id', event.target.value)}>
              <option value="">All subjects</option>
              {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.code} — {subject.name}</option>)}
            </Select>
          </Field>
          <Field label="Section" htmlFor="user-section-filter">
            <Select id="user-section-filter" value={filters.section_id} onChange={(event) => updateFilter('section_id', event.target.value)}>
              <option value="">All sections</option>
              {sectionsForFilter.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
            </Select>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="secondary">Search</Button>
            <Button type="button" variant="text" onClick={() => { setSearchDraft(''); applyFilters(NO_FILTERS); }}>Clear filters</Button>
          </div>
        </form>

        <CreateUserCard subjects={subjects} sections={sections} onCreated={() => { void refreshAll(); }} />

        {detail && (
          <UserDetailCard
            key={detail.id}
            user={detail}
            subjects={subjects}
            sections={sections}
            onSaved={handleSaved}
            onClose={() => setDetail(null)}
          />
        )}

        {loading ? (
          <div><Spinner label="Loading users" /> Loading users…</div>
        ) : users.length === 0 ? (
          <EmptyState>No users match these filters.</EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Full name</th>
                  <th>Role</th>
                  <th>Student code</th>
                  <th>Active</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.username}</td>
                    <td>{user.full_name}</td>
                    <td>{user.role}</td>
                    <td>{user.student_code ?? '—'}</td>
                    <td>{user.is_active ? 'Yes' : 'No'}</td>
                    <td>{formatDateTime(user.created_at)}</td>
                    <td>
                      <div className="table-actions flex flex-wrap items-center gap-2">
                        <Button variant="secondary" onClick={() => { setDetail(user); setResetTarget(null); }}>Open</Button>
                        <Button variant="secondary" onClick={() => { setResetTarget(user); setDetail(null); }}>Reset password</Button>
                        <Button
                          variant={user.is_active ? 'danger' : 'primary'}
                          disabled={busyId === user.id}
                          onClick={() => { void toggleActive(user); }}
                        >
                          {user.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-normal text-muted">Showing {from}–{to} of {total} users</span>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" disabled={page <= 1} onClick={() => { setLoading(true); setPage((current) => Math.max(1, current - 1)); }}>Previous</Button>
                <span className="font-normal text-muted">Page {page} of {lastPage}</span>
                <Button variant="secondary" disabled={page >= lastPage} onClick={() => { setLoading(true); setPage((current) => Math.min(lastPage, current + 1)); }}>Next</Button>
              </div>
            </div>
          </>
        )}

        {resetTarget && (
          <ResetPasswordCard user={resetTarget} onReset={() => { void refreshAll(); }} />
        )}
      </div>
    </Card>
  );
}
