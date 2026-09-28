import { ApiError } from '../../lib/api';
import { ROLES, type PermissionKey, type Role } from '@exam/shared';

export type AdminUser = {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  student_code: string | null;
  is_active: boolean;
  can_change_password: boolean;
  created_at: string;
};

export type Subject = { id: string; code: string; name: string };

export type Section = {
  id: string;
  name: string;
  subject_id: string;
  ta_id: string;
  subject: { code: string; name: string };
  ta: { id: string; full_name: string };
  _count?: { memberships: number };
};

export type AdminExam = {
  id: string;
  title: string;
  type: 'doctor_exam' | 'ta_quiz';
  status: string;
  start_time: string;
  end_time: string;
  subject: { code: string; name: string };
  owner: { id: string; full_name: string };
};

export type TermResetCounts = Record<string, number>;

export type PermissionRow = {
  permission_key: PermissionKey;
  role_default: boolean;
  override: boolean | null;
  effective: boolean;
};

export type RolePermissionMatrix = Record<Role, Record<PermissionKey, boolean>>;

export const ROLE_OPTIONS = ROLES;

export const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return dateTimeFormat.format(parsed);
}

export function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formValue(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

export function humanise(value: string): string {
  return value.replaceAll('_', ' ');
}

export function plural(count: number, alreadyPlural: string): string {
  const singular = alreadyPlural.endsWith('s') ? alreadyPlural.slice(0, -1) : alreadyPlural;
  return `${count} ${count === 1 ? singular : alreadyPlural}`;
}

function dependentCounts(error: unknown): Array<[string, number]> {
  if (!(error instanceof ApiError)) return [];
  const dependents = error.payload?.dependents;
  if (dependents == null || typeof dependents !== 'object') return [];
  return Object.entries(dependents as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0)
    .map(([key, count]) => [humanise(key), count]);
}

export function describeError(error: unknown): string {
  const message = messageFrom(error);
  const counts = dependentCounts(error);
  if (counts.length === 0) return message;
  return `${message} — ${counts.map(([label, count]) => plural(count, label)).join(', ')}`;
}

export function EmptyState({ children }: { children: string }) {
  return <p className="muted">{children}</p>;
}
