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
import {
  describeError,
  EmptyState,
  formatDateTime,
  formValue,
  plural,
  ROLE_OPTIONS,
  type AdminUser,
  type Section,
  type Subject,
} from './adminShared';

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
    <label className="checkbox-row" htmlFor={id}>
      <input id={id} name="can_change_password" type="checkbox" defaultChecked={defaultChecked} />
      Can change password
    </label>
  );
}

function CreateUserCard({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<string>('student');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setCreated(null);
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
      setCreated(`Created ${result.user.username} (${result.user.role}).`);
      setOpen(false);
      onCreated();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="form-stack">
        {created && <Alert variant="success">{created}</Alert>}
        <div><Button onClick={() => { setOpen(true); setCreated(null); }}>Create user</Button></div>
      </div>
    );
  }

  return (
    <form className="form-stack" onSubmit={(event) => { void submit(event); }}>
      <h3>Create user</h3>
      {error && <Alert>{error}</Alert>}
      <Field label="Username" htmlFor="new-username">
        <Input id="new-username" name="username" maxLength={100} required />
      </Field>
      <Field label="Full name" htmlFor="new-full-name">
        <Input id="new-full-name" name="full_name" required />
      </Field>
      <Field label="Role" htmlFor="new-role">
        <Select id="new-role" name="role" value={role} onChange={(event) => setRole(event.target.value)}>
          {ROLE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        </Select>
      </Field>
      {role === 'student' && (
        <Field label="Student code" htmlFor="new-student-code">
          <Input id="new-student-code" name="student_code" maxLength={50} />
        </Field>
      )}
      <Field label="Password (8 to 72 characters)" htmlFor="new-password">
        <Input id="new-password" name="password" type="password" minLength={8} maxLength={72} required />
      </Field>
      <CanChangePasswordField role={role} defaultChecked id="new-can-change-password" />
      <label className="checkbox-row" htmlFor="new-is-active">
        <input id="new-is-active" name="is_active" type="checkbox" defaultChecked /> Active
      </label>
      <div className="row-actions">
        <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create user'}</Button>
        <Button type="button" variant="secondary" onClick={() => { setOpen(false); setError(null); }}>Cancel</Button>
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
    <form className="form-stack" onSubmit={(event) => { void submit(event); }}>
      <h4>Reset password for {user.username}</h4>
      {error && <Alert>{error}</Alert>}
      {done && <Alert variant="success">{done}</Alert>}
      <Field label="New password (8 to 72 characters)" htmlFor={`reset-password-${user.id}`}>
        <Input id={`reset-password-${user.id}`} name="new_password" type="password" minLength={8} maxLength={72} required />
      </Field>
      <div className="row-actions">
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
      <section className="form-stack">
        <h4>Enrollment</h4>
        <p className="muted">Enrollment applies to users with the student role. This account has the {user.role} role.</p>
      </section>
    );
  }

  return (
    <form className="form-stack" onSubmit={(event) => { void submit(event); }}>
      <h4>Enrollment</h4>
      <p className="page-intro">Each student belongs to exactly one section per enrolled subject. Saving moves the student out of any other section of the same subject.</p>
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
      <div className="row-actions">
        <Button type="submit" disabled={saving || !subjectId || !sectionId}>{saving ? 'Saving…' : 'Save enrollment'}</Button>
      </div>
    </form>
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
    <Card className="detail-card">
      <div className="detail-card-head">
        <h3>User detail — {user.username}</h3>
        <Button variant="text" onClick={onClose}>Close</Button>
      </div>
      <form className="form-stack" onSubmit={(event) => { void submit(event); }}>
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
        <label className="checkbox-row" htmlFor={`detail-is-active-${user.id}`}>
          <input id={`detail-is-active-${user.id}`} name="is_active" type="checkbox" defaultChecked={user.is_active} /> Active
        </label>
        <p className="muted">Created {formatDateTime(user.created_at)}</p>
        <div className="row-actions">
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          <Link to={`/admin/permissions?user=${user.id}`}>Permission overrides for {user.username}</Link>
        </div>
      </form>
      <ResetPasswordCard user={user} onReset={() => onSaved(user)} />
      <EnrollmentCard user={user} subjects={subjects} sections={sections} />
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
      <p className="page-intro">Search and filter server-side, then open a user to edit the account, reset its password, or manage enrollment.</p>
      <div className="form-stack">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert variant="success" >{notice}</Alert>}

        <form className="filter-bar" onSubmit={applySearch}>
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
          <div className="row-actions">
            <Button type="submit" variant="secondary">Search</Button>
            <Button type="button" variant="text" onClick={() => { setSearchDraft(''); applyFilters(NO_FILTERS); }}>Clear filters</Button>
          </div>
        </form>

        <CreateUserCard onCreated={() => { void refreshAll(); }} />

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
                      <div className="row-actions">
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

            <div className="pager">
              <span className="muted">Showing {from}–{to} of {total} users</span>
              <div className="row-actions">
                <Button variant="secondary" disabled={page <= 1} onClick={() => { setLoading(true); setPage((current) => Math.max(1, current - 1)); }}>Previous</Button>
                <span className="muted">Page {page} of {lastPage}</span>
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
