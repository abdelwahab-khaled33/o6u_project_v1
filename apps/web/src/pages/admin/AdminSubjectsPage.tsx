/* eslint-disable react-hooks/set-state-in-effect -- this page fetches from the API on mount and whenever a filter changes; the fetched data cannot be derived during render */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { Table } from '../../components/ui/Table';
import { api } from '../../lib/api';
import { describeError, EmptyState, formValue, type Subject } from './adminShared';

export function AdminSubjectsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Subject | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadSubjects = useCallback(async () => {
    try {
      const result = await api.get<{ subjects: Subject[] }>('/admin/subjects');
      setSubjects(result.subjects);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSubjects(); }, [loadSubjects]);

  async function saveSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    const payload = { code: formValue(form, 'code').trim(), name: formValue(form, 'name').trim() };
    try {
      if (editing) await api.patch(`/admin/subjects/${editing.id}`, payload);
      else await api.post('/admin/subjects', payload);
      setNotice(editing ? `Saved ${payload.code}.` : `Created ${payload.code}.`);
      setEditing(null);
      setCreating(false);
      setLoading(true);
      await loadSubjects();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSubject(subject: Subject) {
    setBusyId(subject.id);
    setError(null);
    setNotice(null);
    try {
      await api.delete(`/admin/subjects/${subject.id}`);
      setNotice(`Deleted ${subject.code}.`);
      setConfirmDelete(null);
      setLoading(true);
      await loadSubjects();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusyId(null);
    }
  }

  const formSubject = editing ?? (creating ? { code: '', name: '' } : null);

  return (
    <Card>
      <h2>Subjects</h2>
      <p className="font-normal text-muted">Create and edit subject codes and names. Deleting a subject never cascades: it is refused while other records still depend on it.</p>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
      {formSubject && (
        <form className="mt-5 grid gap-[18px]" onSubmit={(event) => { void saveSubject(event); }}>
          <h3>{editing ? 'Edit subject' : 'Create subject'}</h3>
          <Field label="Code" htmlFor="subject-code">
            <Input id="subject-code" name="code" defaultValue={formSubject.code} maxLength={30} required />
          </Field>
          <Field label="Name" htmlFor="subject-name">
            <Input id="subject-name" name="name" defaultValue={formSubject.name} required />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save subject'}</Button>
            <Button type="button" variant="secondary" onClick={() => { setEditing(null); setCreating(false); }}>Cancel</Button>
          </div>
        </form>
      )}
      <div className="mt-5 grid gap-[18px]">
        {!creating && !editing && <div><Button onClick={() => setCreating(true)}>Create subject</Button></div>}
        {loading ? (
          <div><Spinner label="Loading subjects" /> Loading subjects…</div>
        ) : subjects.length === 0 ? (
          <EmptyState>No subjects found.</EmptyState>
        ) : (
          <Table>
            <thead><tr><th>Code</th><th>Name</th><th>Actions</th></tr></thead>
            <tbody>
              {subjects.map((subject) => (
                <tr key={subject.id}>
                  <td>{subject.code}</td>
                  <td>{subject.name}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="secondary" onClick={() => { setCreating(false); setEditing(subject); setConfirmDelete(null); }}>Edit</Button>
                      {confirmDelete === subject.id ? (
                        <>
                          <span className="font-normal text-muted">Delete {subject.code}?</span>
                          <Button variant="danger" disabled={busyId === subject.id} onClick={() => { void deleteSubject(subject); }}>
                            {busyId === subject.id ? 'Deleting…' : 'Confirm delete'}
                          </Button>
                          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                        </>
                      ) : (
                        <Button variant="danger" onClick={() => setConfirmDelete(subject.id)}>Delete</Button>
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
