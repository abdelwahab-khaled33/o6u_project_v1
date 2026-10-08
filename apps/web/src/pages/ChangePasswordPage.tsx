import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api, ApiError } from '../lib/api';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field, Input } from '../components/ui/Field';

export default function ChangePasswordPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!user?.canChangePassword) {
    return <Card className="max-w-[680px]"><h1>Change password</h1><Alert variant="info">Password changes are unavailable for this account.</Alert></Card>;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await api.post('/auth/change-password', { current_password: currentPassword, new_password: newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setSuccess('Password updated.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to update password.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="max-w-[680px]">
      <h1>Change password</h1>
      <p className="font-normal text-muted">Choose a new password between 8 and 72 characters.</p>
      <form className="mt-5 grid gap-[18px]" onSubmit={handleSubmit}>
        <Field label="Current password" htmlFor="current-password"><Input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></Field>
        <Field label="New password" htmlFor="new-password"><Input id="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={72} required /></Field>
        {error && <Alert>{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}
        <div><Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save password'}</Button></div>
      </form>
    </Card>
  );
}
