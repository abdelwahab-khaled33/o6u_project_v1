import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudentExamRunner } from './StudentExamRunner';
import { ExamTopbarProvider } from '../../hooks/examTopbar';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

function q(id: string, order: number, selected: string | null = null, flagged = false) {
  return {
    id,
    question_type: 'mcq' as const,
    text: `text ${id}`,
    options: ['a', 'b'],
    image_url: null,
    difficulty: 'easy',
    selected_answer: selected,
    is_flagged: flagged,
    order,
  };
}

describe('runner redesign smoke', () => {
  it('renders flag pills, legend, warning box and pagination', () => {
    const html = renderToStaticMarkup(
      <ExamTopbarProvider>
        <StudentExamRunner
          exam={{
            id: 'e1', title: 'test_1', type: 'doctor_exam',
            subject: { id: 's1', code: 'CS81143', name: 'Live Verification Subject' },
            duration_minutes: 60, start_time: '2026-10-08T21:00:00.000Z',
            end_time: '2026-10-10T08:00:00.000Z', points_per_question: 1, status: 'in_progress',
          }}
          attempt={{ id: 'a1', status: 'in_progress', started_at: '2026-10-08T22:26:26.000Z', deadline_at: '2026-10-09T20:26:26.000Z' }}
          questions={[q('q1', 0, 'a'), q('q2', 1, null, true), q('q3', 2), q('q4', 3), q('q5', 4), q('q6', 5)]}
          serverNow={new Date().toISOString()}
          onFinished={() => {}}
          onAbandon={() => {}}
        />
      </ExamTopbarProvider>,
    );
    expect(html).toContain('⚑');
    expect(html).toContain('Flag</button>');
    expect(html).toContain('Flagged</button>');
    expect(html).toContain('Not answered');
    expect(html).toContain('still need an answer before you can submit');
    expect(html).toContain('bg-primary-dark text-white');
    expect(html).toContain('outline-accent');
    expect(html).toContain('after:bg-accent');
    expect(html).toContain('rounded-xl border bg-white');
  });
});
