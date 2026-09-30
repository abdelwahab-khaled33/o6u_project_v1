/* eslint-disable react-hooks/set-state-in-effect -- this page fetches the doctor and subject lists on mount, then fetches one doctor's assignments whenever the selected doctor changes; the fetched data cannot be derived during render */
import { useCallback, useEffect, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Select } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { api } from '../../lib/api';
import { describeError, EmptyState, type AdminUser, type Subject } from './adminShared';
import {
  ASSIGNMENT_CONSEQUENCE,
  buildAssignmentBody,
  canSave,
  doctorOptionLabel,
  saveNotice,
} from './doctorAssignmentsModel';

type AssignmentRead = { doctor_id: string; subject_ids: string[] };
type AssignmentWrite = AssignmentRead & { removed_assignments: number };

/** One request's outcome, kept apart so a failure never masquerades as an empty result. */
type Settled<T> = { data: T | null; error: string | null };

async function settle<T>(load: Promise<T>): Promise<Settled<T>> {
  try {
    return { data: await load, error: null };
  } catch (caught) {
    return { data: null, error: describeError(caught) };
  }
}

/** Both list reads can fail independently, and losing one is not losing both. */
function joinFailures(...errors: Array<string | null>): string | null {
  const present = errors.filter((error): error is string => error !== null);
  return present.length === 0 ? null : present.join(' — ');
}

/**
 * `null` rather than `[]` for the subject catalogue, and the reason is the project's recurring
 * one: unknown is not zero. A failed catalogue read rendered as an empty list would show a
 * doctor with no boxes and then send `subject_ids: []` on the next save, clearing a doctor who
 * was teaching. `canSave` refuses to write while this is null.
 *
 * The doctor list does not get the same treatment, and deliberately: it has no write path of its
 * own, so a failed read costs the administrator a list rather than corrupting anything. It is
 * still an inline error rather than a silent empty state, because "no doctors exist" and "the
 * doctor list did not load" are different claims.
 */
export function AdminDoctorAssignmentsPage() {
  const [doctors, setDoctors] = useState<AdminUser[] | null>(null);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [doctorId, setDoctorId] = useState('');
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  // Whether the picker below is showing what the server holds, or showing nothing because the read
  // failed. `assigned` cannot answer that itself: an empty Set is the correct display for a doctor
  // with no subjects AND for a doctor whose subjects were never read, and the difference is the
  // difference between "saving clears this" and "saving would clear this".
  const [assignmentsLoaded, setAssignmentsLoaded] = useState(false);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadLists = useCallback(async () => {
    const [doctorResult, subjectResult] = await Promise.all([
      // No page/page_size: the route only pages when BOTH are present, and asking for a page of
      // doctors would silently hide every doctor past page one from an editor whose whole job is
      // to reach all of them. `role` is a real server-side filter, not a client-side one.
      settle(api.get<{ users: AdminUser[] }>('/admin/users?role=doctor').then((r) => r.users)),
      settle(api.get<{ subjects: Subject[] }>('/admin/subjects').then((r) => r.subjects)),
    ]);

    setDoctors(doctorResult.data);
    setSubjects(subjectResult.data);
    setListError(joinFailures(doctorResult.error, subjectResult.error));
  }, []);

  useEffect(() => { void loadLists(); }, [loadLists]);

  /** Returns what was applied and, separately, why it could not be. The caller needs both: a save
   *  that succeeded still needs its boxes re-read, and a save that failed still needs the refusal
   *  reason kept after the re-read has overwritten the shared error slot. */
  const loadAssignments = useCallback(async (id: string): Promise<{ data: AssignmentRead | null; error: string | null }> => {
    setLoadingAssignments(true);
    setLoadError(null);
    try {
      const data = await api.get<AssignmentRead>(`/admin/doctor-assignments/${id}`);
      setAssigned(new Set(data.subject_ids));
      setAssignmentsLoaded(true);
      return { data, error: null };
    } catch (caught) {
      // The route answers 404 for an unknown doctor and 400 for a non-doctor, using the same
      // wording as the write. Surfacing the server's own text is the point: an empty checkbox
      // list would read as "this doctor teaches nothing", which is a claim the request never made.
      const error = describeError(caught);
      setAssigned(new Set());
      setAssignmentsLoaded(false);
      return { data: null, error };
    } finally {
      setLoadingAssignments(false);
    }
  }, []);

  function selectDoctor(id: string) {
    setDoctorId(id);
    setNotice(null);
    setAssigned(new Set());
    setAssignmentsLoaded(false);
    if (id !== '') {
      void loadAssignments(id).then((result) => setLoadError(result.error));
    }
  }

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
    const body = buildAssignmentBody(doctorId, [...assigned]);
    if (body === null) return;

    setSaving(true);
    setNotice(null);
    let written: AssignmentWrite | null = null;
    let failure: string | null = null;
    try {
      written = await api.put<AssignmentWrite>('/admin/doctor-assignments', body);
    } catch (caught) {
      failure = describeError(caught);
    }

    // The re-read runs on the failure path too, and that is the reason this is not a `finally`
    // written for tidiness. The route validates inside its transaction and returns instead of
    // throwing, so a refused save leaves nothing behind — but "nothing behind" is a claim about the
    // server, and the boxes on screen are whatever the last read left there. Re-reading makes the
    // screen show what is actually stored after BOTH outcomes, so a refusal cannot leave a stale
    // selection on display for the next save to send. It is the same six refusals leaving the
    // database untouched that makes this safe: the screen is never describing a write that the
    // server quietly half-applied.
    const reread = await loadAssignments(body.doctor_id);

    // A refusal and an unreadable state are separate facts. When both happened, saying only the
    // first would imply the boxes on screen were confirmed.
    setLoadError(
      failure === null
        ? reread.error
        : reread.error === null
          ? failure
          : `${failure} The saved state could not be re-read either: ${reread.error}`,
    );
    // The notice reports the ids the PUT echoed back, not the ones that were requested: the server
    // deduplicates and the transaction is the authority on what exists afterwards.
    setNotice(written === null ? null : saveNotice(written.removed_assignments, written.subject_ids));
    setSaving(false);
  }

  const assignedCount = assigned.size;
  const saveDisabled = saving || loadingAssignments || !canSave({ doctorId, subjectsLoaded: subjects !== null, assignmentsLoaded });

  return (
    <Card>
      <h2>Doctor assignments</h2>
      <p className="page-intro">
        Choose a doctor, then tick the subjects they teach. An assignment is a permission: it decides which subjects the
        doctor can see and whose question bank they can manage.
      </p>
      <p className="muted">{ASSIGNMENT_CONSEQUENCE}</p>

      {listError && <Alert>{listError}</Alert>}
      {loadError && <Alert>{loadError}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <div className="form-stack">
        <Field label="Doctor" htmlFor="assignment-doctor">
          <Select id="assignment-doctor" value={doctorId} disabled={saving} onChange={(event) => selectDoctor(event.target.value)}>
            <option value="">Select a doctor</option>
            {(doctors ?? []).map((doctor) => (
              <option key={doctor.id} value={doctor.id}>{doctorOptionLabel(doctor)}</option>
            ))}
          </Select>
        </Field>

        {!doctorId ? (
          <EmptyState>Select a doctor to see the subjects they are assigned to.</EmptyState>
        ) : loadingAssignments ? (
          <div><Spinner label="Loading assignments" /> Loading assignments…</div>
        ) : !assignmentsLoaded ? (
          // No picker at all. This branch exists because the alternative was measured, not
          // imagined: an empty checkbox list plus an enabled save button is a request to clear the
          // doctor, and the read that failed is the only thing that says otherwise. The error
          // alert above carries the server's wording; this branch makes sure there is nothing
          // underneath it to click.
          <Alert>
            This doctor&rsquo;s subjects could not be read, so there is nothing here to change. Choose another doctor or
            reload the page — saving from this state would clear the doctor&rsquo;s subjects rather than edit them.
          </Alert>
        ) : subjects === null ? (
          <Alert>
            The subject list could not be loaded, so there is nothing safe to save here. Reload the page and try again —
            saving from this state would clear the doctor&rsquo;s subjects rather than change them.
          </Alert>
        ) : subjects.length === 0 ? (
          <EmptyState>There are no subjects yet, so there is nothing to assign. Create a subject first.</EmptyState>
        ) : (
          <fieldset className="fieldset-reset">
            <legend>Subjects assigned to this doctor</legend>
            <p className="muted">
              {assignedCount === 0
                ? 'None ticked. Saving now removes every subject from this doctor.'
                : `${assignedCount} subject${assignedCount === 1 ? '' : 's'} ticked.`}
            </p>
            {subjects.map((subject) => (
              <label className="checkbox-row" key={subject.id} htmlFor={`assignment-subject-${subject.id}`}>
                <input
                  id={`assignment-subject-${subject.id}`}
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

        <div className="row-actions">
          <Button onClick={() => { void save(); }} disabled={saveDisabled}>
            {saving ? 'Saving…' : 'Save assignments'}
          </Button>
          {doctorId && subjects !== null && assignedCount === 0 && (
            <span className="muted">Saving with nothing ticked clears every subject from this doctor.</span>
          )}
        </div>
      </div>
    </Card>
  );
}