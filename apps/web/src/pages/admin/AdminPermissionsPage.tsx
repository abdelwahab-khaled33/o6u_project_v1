/* eslint-disable react-hooks/set-state-in-effect -- this page fetches from the API on mount and whenever a filter changes; the fetched data cannot be derived during render */
import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { Table } from '../../components/ui/Table';
import { api } from '../../lib/api';
import type { PermissionKey, Role } from '@exam/shared';
import { describeError, EmptyState, type PermissionRow, type RolePermissionMatrix } from './adminShared';

type DefaultsResponse = {
  roles: Role[];
  keys: PermissionKey[];
  applicable: Record<Role, PermissionKey[]>;
  matrix: RolePermissionMatrix;
};

type UserPermissionsResponse = {
  user: { id: string; username: string; full_name: string; role: Role };
  applicable: Record<Role, PermissionKey[]>;
  permissions: PermissionRow[];
};

function yesNo(value: boolean | null): string {
  if (value === null) return 'Inherited';
  return value ? 'Yes' : 'No';
}

const KEY_GROUPS: { title: string; keys: PermissionKey[] }[] = [
  { title: 'Administration', keys: ['users.manage', 'subjects.manage', 'permissions.manage', 'term.reset'] },
  {
    title: 'Exams and quizzes',
    keys: ['exams.approve', 'exams.manage_all', 'exams.access_code.regenerate', 'exam.create', 'quiz.create', 'exam.take', 'sessions.release'],
  },
  { title: 'Question bank', keys: ['question_bank.manage', 'question_bank.import', 'question_bank.export'] },
  { title: 'Results and grades', keys: ['results.view', 'results.export', 'grades.adjust'] },
  { title: 'Account', keys: ['password.change_own'] },
];

export function AdminPermissionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [defaults, setDefaults] = useState<DefaultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const requestedUserId = searchParams.get('user') ?? '';
  const [userPermissions, setUserPermissions] = useState<UserPermissionsResponse | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);
  const [userBusyKey, setUserBusyKey] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadDefaults = useCallback(async () => {
    try {
      const result = await api.get<DefaultsResponse>('/admin/permissions/defaults');
      setDefaults(result);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadDefaults(); }, [loadDefaults]);

  const loadUserPermissions = useCallback(async (id: string) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    setUserLoading(true);
    setUserError(null);
    try {
      const result = await api.get<UserPermissionsResponse>(`/admin/permissions/users/${encodeURIComponent(trimmed)}`);
      setUserPermissions(result);
    } catch (caught) {
      setUserPermissions(null);
      setUserError(describeError(caught));
    } finally {
      setUserLoading(false);
    }
  }, []);

  useEffect(() => { void loadUserPermissions(requestedUserId); }, [loadUserPermissions, requestedUserId]);

  async function setDefault(role: Role, permissionKey: PermissionKey, allowed: boolean) {
    const cellId = `${role}:${permissionKey}`;
    setBusyKey(cellId);
    setError(null);
    setNotice(null);
    try {
      await api.patch('/admin/permissions/defaults', { role, permission_key: permissionKey, allowed });
      setNotice(`${permissionKey} is now ${allowed ? 'allowed' : 'denied'} by default for the ${role} role.`);
      await loadDefaults();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusyKey(null);
    }
  }

  async function setOverride(permissionKey: PermissionKey, allowed: boolean | null) {
    if (!userPermissions) return;
    setUserBusyKey(permissionKey);
    setUserError(null);
    setNotice(null);
    try {
      const result = await api.patch<{ permissions: PermissionRow[] }>(
        `/admin/permissions/users/${userPermissions.user.id}`,
        { permission_key: permissionKey, allowed },
      );
      setUserPermissions({ ...userPermissions, permissions: result.permissions });
      setNotice(
        allowed === null
          ? `Override cleared for ${permissionKey}; the role default applies again.`
          : `${permissionKey} override set to ${allowed ? 'allow' : 'deny'} for ${userPermissions.user.username}.`,
      );
    } catch (caught) {
      setUserError(describeError(caught));
    } finally {
      setUserBusyKey(null);
    }
  }

  function submitUserLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = new FormData(event.currentTarget).get('user_id');
    const value = typeof submitted === 'string' ? submitted.trim() : '';
    if (!value) return;
    const next = new URLSearchParams(searchParams);
    next.set('user', value);
    setSearchParams(next, { replace: true });
  }

  async function resetDefaults() {
    setResetting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ reset: boolean; defaults_restored: number }>('/admin/permissions/defaults/reset', {});
      setNotice(`Permission defaults were reset to the seed values (${result.defaults_restored} keys restored).`);
      setConfirmReset(false);
      setLoading(true);
      await loadDefaults();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="grid gap-6">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid max-w-[560px] gap-1.5">
            <h2>Permission defaults</h2>
            <p className="font-normal leading-relaxed text-muted">
              Each cell is the default for one role. The effective permission is the user override when one exists, otherwise this default. Ownership and scope are always enforced on top of these keys. A dash means the key does not apply to that role.
            </p>
          </div>
          {confirmReset ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-normal text-muted">Reset all 18 keys to the seed values?</span>
              <Button variant="danger" disabled={resetting} onClick={() => { void resetDefaults(); }}>
                {resetting ? 'Resetting…' : 'Confirm reset'}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmReset(false)}>Cancel</Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmReset(true)}>Reset defaults</Button>
          )}
        </div>
        {error && <Alert>{error}</Alert>}
        {notice && <Alert variant="success">{notice}</Alert>}
        <div className="mt-5 grid gap-[18px]">
          {loading ? (
            <div><Spinner label="Loading permission defaults" /> Loading defaults…</div>
          ) : !defaults ? (
            <EmptyState>Permission defaults are unavailable.</EmptyState>
          ) : (
            <Table className="[&_th]:border-b [&_th]:border-[#dfe5f0] [&_th]:bg-white [&_th]:text-[0.72rem] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-[0.06em] [&_th]:text-[#5b6b8c] [&_th:not(:first-child)]:text-center [&_td]:py-3 [&_td:not(:first-child)]:text-center [&_td]:[&_input]:h-5 [&_td]:[&_input]:w-5 [&_td]:[&_input]:accent-[#455B8A]">
              <thead>
                <tr>
                  <th>Permission key</th>
                  {defaults.roles.map((role) => <th key={role}>{role}</th>)}
                </tr>
              </thead>
              <tbody>
                {KEY_GROUPS.map((group) => (
                  <Fragment key={`group-${group.title}`}>
                    <tr>
                      <td colSpan={1 + defaults.roles.length} className="bg-[#edf1f8] text-[0.72rem] font-bold uppercase tracking-[0.06em] text-primary-dark">
                        {group.title}
                      </td>
                    </tr>
                    {group.keys.map((key) => (
                      <tr key={key}>
                        <td className="font-mono text-[0.85rem] text-primary-dark">{key}</td>
                        {defaults.roles.map((role) => {
                          const applies = defaults.applicable[role]?.includes(key) ?? false;
                          const cellId = `${role}:${key}`;
                          return (
                            <td key={role} className="whitespace-nowrap">
                              {applies ? (
                                <input
                                  type="checkbox"
                                  aria-label={`${key} default for ${role}`}
                                  checked={defaults.matrix[role]?.[key] ?? false}
                                  disabled={busyKey === cellId}
                                  onChange={(event) => { void setDefault(role, key, event.target.checked); }}
                                />
                              ) : (
                                <span aria-hidden="true" className="font-normal text-[#9aa7c2]">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </div>

      <div className="rounded-[14px] border border-[#e3e8f2] bg-white px-5 py-5 shadow-[0_4px_14px_rgb(36_52_80/7%)]">
        <h2>User permission overrides</h2>
        <p className="font-normal leading-relaxed text-muted">
          Load a user by id to see the role default, their override and the effective value per key. Clearing an override falls back to the role default.
        </p>
        <form className="mt-4 flex max-w-[560px] flex-wrap items-end gap-3" onSubmit={submitUserLookup}>
          <div className="min-w-[240px] flex-1">
            <Field label="User id" htmlFor="permissions-user-id">
              <Input
                key={requestedUserId}
                id="permissions-user-id"
                name="user_id"
                defaultValue={requestedUserId}
                placeholder="User UUID"
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={userLoading}>{userLoading ? 'Loading…' : 'Load overrides'}</Button>
            {userPermissions && (
              <Button
                type="button"
                variant="text"
                onClick={() => { setUserPermissions(null); setUserError(null); setSearchParams({}, { replace: true }); }}
              >
                Clear
              </Button>
            )}
          </div>
        </form>

        <div className="mt-5 grid gap-[18px]">
          {userError && <Alert>{userError}</Alert>}
          {userLoading && <div><Spinner label="Loading user overrides" /> Loading overrides…</div>}
          {!userLoading && !userPermissions && (
            <p className="rounded-[10px] bg-[#e8edf6] px-4 py-3 font-normal text-primary-dark">No user loaded yet.</p>
          )}
          {userPermissions && (
            <Table className="[&_th]:border-b [&_th]:border-[#dfe5f0] [&_th]:bg-white [&_th]:text-[0.72rem] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-[0.06em] [&_th]:text-[#5b6b8c] [&_td]:py-3">
              <thead>
                <tr>
                  <th>Permission key</th>
                  <th>Role default</th>
                  <th>Override</th>
                  <th>Effective</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {userPermissions.permissions.map((row) => {
                  const applies = userPermissions.applicable[userPermissions.user.role]?.includes(row.permission_key) ?? false;
                  return (
                    <tr key={row.permission_key}>
                      <td className="font-mono text-[0.85rem] text-primary-dark">{row.permission_key}</td>
                      <td>{yesNo(row.role_default)}</td>
                      <td>{yesNo(row.override)}</td>
                      <td>{row.effective ? 'Yes' : 'No'}{!applies && <span className="font-normal text-muted"> n/a</span>}</td>
                      <td>
                        <div className="table-actions flex flex-wrap items-center gap-2">
                          <Button
                            variant="secondary"
                            disabled={userBusyKey === row.permission_key}
                            onClick={() => { void setOverride(row.permission_key, true); }}
                          >
                            Allow
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={userBusyKey === row.permission_key}
                            onClick={() => { void setOverride(row.permission_key, false); }}
                          >
                            Deny
                          </Button>
                          <Button
                            variant="text"
                            disabled={userBusyKey === row.permission_key || row.override === null}
                            onClick={() => { void setOverride(row.permission_key, null); }}
                          >
                            Clear override
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          {userPermissions && (
            <p className="font-normal text-muted">
              Loaded {userPermissions.user.username} ({userPermissions.user.full_name}), role {userPermissions.user.role}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
