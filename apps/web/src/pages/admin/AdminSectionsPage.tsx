/* eslint-disable react-hooks/set-state-in-effect -- this page fetches from the API on mount and whenever a filter changes; the fetched data cannot be derived during render */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Input, Select } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { Table } from '../../components/ui/Table';
import { api } from '../../lib/api';
import { describeError, EmptyState, formValue, type AdminUser, type Section, type Subject } from './adminShared';

export function AdminSectionsPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [tas, setTas] = useState<AdminUser[]>([]);
  const [filterSubject, setFilterSubject] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Section | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [sectionResult, subjectResult, userResult] = await Promise.all([
        api.get<{ sections: Section[] }>('/admin/sections'),
        api.get<{ subjects: Subject[] }>('/admin/subjects'),
        api.get<{ users: AdminUser[] }>('/admin/users?role=ta'),
      ]);
      setSections(sectionResult.sections);
      setSubjects(subjectResult.subjects);
      setTas(userResult.users);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!creating && !editing) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      if (editing) {
        await api.patch(`/admin/sections/${editing.id}`, {
          name: formValue(form, 'name').trim(),
          ta_id: formValue(form, 'ta_id'),
        });
        setNotice(`Saved ${editing.name}.`);
      } else {
        await api.post('/admin/sections', {
          name: formValue(form, 'name').trim(),
          subject_id: formValue(form, 'subject_id'),
          ta_id: formValue(form, 'ta_id'),
        });
        setNotice('Created section.');
      }
      setEditing(null);
      setCreating(false);
      setLoading(true);
      await loadData();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSection(section: Section) {
    setBusyId(section.id);
    setError(null);
    setNotice(null);
    try {
      await api.delete(`/admin/sections/${section.id}`);
      setNotice(`Deleted ${section.name}.`);
      setConfirmDelete(null);
      setLoading(true);
      await loadData();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusyId(null);
    }
  }

  const visibleSections = useMemo(
    () => sections.filter((section) => !filterSubject || section.subject_id === filterSubject),
    [sections, filterSubject],
  );
  const editingSubject = editing ? subjects.find((subject) => subject.id === editing.subject_id) : undefined;

  return (
    <Card>
      <h2>Sections</h2>
      <p className="page-intro">
        Filter sections by subject and create sections with an assigned TA. A section always belongs to one subject: to move it, create a new section. Deletion is refused while memberships or exam targets still depend on it.
      </p>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      {editing && (
        <form className="form-stack" onSubmit={(event) => { void submit(event); }}>
          <h3>Edit section — {editing.name}</h3>
          <p className="page-intro">
            Subject: {editingSubject ? `${editingSubject.code} — ${editingSubject.name}` : editing.subject.code}
          </p>
          <Field label="Name" htmlFor="edit-section-name">
            <Input id="edit-section-name" name="name" defaultValue={editing.name} required />
          </Field>
          <Field label="TA" htmlFor="edit-section-ta">
            <Select id="edit-section-ta" name="ta_id" defaultValue={editing.ta_id}>
              {tas.map((ta) => <option key={ta.id} value={ta.id}>{ta.full_name}</option>)}
            </Select>
          </Field>
          <div className="row-actions">
            <Button type="submit" disabled={saving || tas.length === 0}>{saving ? 'Saving…' : 'Save section'}</Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      )}

      {creating && (
        <form className="form-stack" onSubmit={(event) => { void submit(event); }}>
          <h3>Create section</h3>
          <Field label="Name" htmlFor="section-name">
            <Input id="section-name" name="name" required />
          </Field>
          <Field label="Subject" htmlFor="section-subject">
            <Select id="section-subject" name="subject_id" required defaultValue="">
              <option value="" disabled>Select a subject</option>
              {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.code} — {subject.name}</option>)}
            </Select>
          </Field>
          <Field label="TA" htmlFor="section-ta">
            <Select id="section-ta" name="ta_id" required defaultValue="">
              <option value="" disabled>Select a TA</option>
              {tas.map((ta) => <option key={ta.id} value={ta.id}>{ta.full_name}</option>)}
            </Select>
          </Field>
          <div className="row-actions">
            <Button type="submit" disabled={saving || subjects.length === 0 || tas.length === 0}>{saving ? 'Saving…' : 'Save section'}</Button>
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </form>
      )}

      <div className="form-stack">
        {!creating && !editing && <div><Button onClick={() => setCreating(true)}>Create section</Button></div>}
        <Field label="Filter by subject" htmlFor="section-subject-filter">
          <Select id="section-subject-filter" value={filterSubject} onChange={(event) => setFilterSubject(event.target.value)}>
            <option value="">All subjects</option>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.code} — {subject.name}</option>)}
          </Select>
        </Field>
        {loading ? (
          <div><Spinner label="Loading sections" /> Loading sections…</div>
        ) : visibleSections.length === 0 ? (
          <EmptyState>{sections.length === 0 ? 'No sections found.' : 'No sections match this subject.'}</EmptyState>
        ) : (
          <Table>
            <thead><tr><th>Section</th><th>Subject</th><th>Assigned TA</th><th>Members</th><th>Actions</th></tr></thead>
            <tbody>
              {visibleSections.map((section) => (
                <tr key={section.id}>
                  <td>{section.name}</td>
                  <td>{section.subject.code} — {section.subject.name}</td>
                  <td>{section.ta.full_name}</td>
                  <td>{section._count?.memberships ?? 0}</td>
                  <td>
                    <div className="row-actions">
                      <Button variant="secondary" onClick={() => { setCreating(false); setEditing(section); setConfirmDelete(null); }}>Edit</Button>
                      {confirmDelete === section.id ? (
                        <>
                          <span className="muted">Delete {section.name}?</span>
                          <Button variant="danger" disabled={busyId === section.id} onClick={() => { void deleteSection(section); }}>
                            {busyId === section.id ? 'Deleting…' : 'Confirm delete'}
                          </Button>
                          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                        </>
                      ) : (
                        <Button variant="danger" onClick={() => setConfirmDelete(section.id)}>Delete</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </Card>
  );
}
