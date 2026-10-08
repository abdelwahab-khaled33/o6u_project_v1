import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Field';
import { O6ULogo } from '../components/brand/O6ULogo';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      void navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-[#dfe7f6] via-[#edf0f6] to-[#ffe3c7] p-6">
      <form onSubmit={handleSubmit} className="grid w-full max-w-[430px] gap-[18px] rounded-2xl border border-[#dfe5f0] border-t-[5px] border-t-accent bg-white p-9 shadow-[0_12px_32px_rgb(36_52_80/10%)] max-md:px-6 max-md:py-7">
        <div className="flex items-center gap-3">
          <O6ULogo size="md" />
          <div>
            <h1 className="text-[1.85rem] font-bold tracking-tight text-primary-dark">O6U Exam Platform</h1>
            <p className="text-muted">October 6 University · Sign in to your account</p>
          </div>
        </div>
        <p className="rounded-md bg-[#eef4ff] px-3 py-2 text-[0.82rem] font-medium text-[#294a87]">
          The first private university in Egypt (Decree 243/1996) · 13 faculties · 6th of October City, Giza · Hotline 16704
        </p>
        <Field label="Username" htmlFor="username">
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
