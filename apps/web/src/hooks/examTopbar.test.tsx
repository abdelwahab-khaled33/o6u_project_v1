import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Layout from '../components/Layout';
import { ExamTopbarProvider, type ExamTopbarData } from './examTopbar';

vi.mock('./useAuth', () => ({
  useAuth: () => ({ user: { fullName: 'Test Student', role: 'student' }, logout: () => {} }),
}));

function shell(initialTop?: ExamTopbarData) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/student']}>
      <ExamTopbarProvider initialTop={initialTop}>
        <Layout />
      </ExamTopbarProvider>
    </MemoryRouter>,
  );
}

describe('exam focus shell', () => {
  it('shows the sidebar when no exam is running', () => {
    const html = shell(undefined);
    expect(html).toContain('<aside');
    expect(html).toContain('Student workspace');
  });

  it('hides the sidebar and pins exam name, timer and counts while running', () => {
    const html = shell({
      title: 'test_1',
      timeLeft: '19:41',
      shortClock: false,
      expired: false,
      answered: 0,
      total: 3,
      flagged: 0,
    });
    expect(html).not.toContain('<aside');
    expect(html).toContain('test_1');
    expect(html).toContain('19:41');
    expect(html).toContain('Answered');
    expect(html).toContain('Flagged');
  });
});
