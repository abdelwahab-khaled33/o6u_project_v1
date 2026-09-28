/* eslint-disable react-hooks/set-state-in-effect -- this page fetches from the API on mount and whenever a filter changes; the fetched data cannot be derived during render */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { Table } from '../../components/ui/Table';
import { api } from '../../lib/api';
import { describeError, humanise, type TermResetCounts } from './adminShared';

type PreviewResponse = { confirmation_phrase: string; counts: TermResetCounts };
type ResetResponse = { counts: TermResetCounts; warnings: string[] };

export function AdminTermResetPage() {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<ResetResponse | null>(null);

  const loadPreview = useCallback(async () => {
    try {
      const data = await api.get<PreviewResponse>('/admin/term/reset');
      setPreview(data);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPreview(); }, [loadPreview]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResetting(true);
    setError(null);
    setResult(null);
    try {
      const data = await api.post<ResetResponse>('/admin/term/reset', { confirmation });
      setResult(data);
      setConfirmation('');
      setLoading(true);
      await loadPreview();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setResetting(false);
    }
  }

  const phrase = preview?.confirmation_phrase ?? '';
  const matches = confirmation.trim() === phrase && phrase !== '';
  const counts = preview ? Object.entries(preview.counts) : [];

  return (
    <Card>
      <h2>Term reset</h2>
      <p className="page-intro">
        Deletes this term's exams, attempts, questions, sections, enrollments and non-admin accounts. Admin accounts, subjects and permission defaults are preserved. This cannot be undone.
      </p>
      {error && <Alert>{error}</Alert>}

      {result && (
        <div className="form-stack">
          <Alert variant="success">Term reset completed. The following records were deleted.</Alert>
          {result.warnings.length > 0 && (
            <Alert variant="info">
              <strong>Completed with warnings:</strong>
              <ul>
                {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </Alert>
          )}
          <Table>
            <thead><tr><th>Record</th><th>Deleted</th></tr></thead>
            <tbody>
              {Object.entries(result.counts).map(([table, count]) => (
                <tr key={table}><td>{humanise(table)}</td><td>{count}</td></tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <div className="form-stack">
        {loading ? (
          <div><Spinner label="Loading term reset preview" /> Loading preview…</div>
        ) : !preview ? (
          <p className="muted">The term reset preview is unavailable.</p>
        ) : (
          <>
            <Table>
              <thead><tr><th>Record</th><th>Would be deleted</th></tr></thead>
              <tbody>
                {counts.map(([table, count]) => (
                  <tr key={table}><td>{humanise(table)}</td><td>{count}</td></tr>
                ))}
              </tbody>
            </Table>

            <form className="form-stack" onSubmit={(event) => { void submit(event); }}>
              <h3>Confirm the reset</h3>
              <p className="page-intro">
                Type <code className="confirmation-phrase">{phrase}</code> to confirm.
              </p>
              <Field label="Confirmation phrase" htmlFor="term-reset-confirmation">
                <Input
                  id="term-reset-confirmation"
                  name="confirmation"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                />
              </Field>
              <div className="row-actions">
                <Button type="submit" variant="danger" disabled={!matches || resetting}>
                  {resetting ? 'Resetting…' : 'Reset the term'}
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </Card>
  );
}
