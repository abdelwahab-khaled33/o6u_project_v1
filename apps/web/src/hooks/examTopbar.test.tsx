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
  it('shows the topbar-only shell with the university logo for students when no exam is running', () => {
    const html = shell(undefined);
    expect(html).not.toContain('<aside');
    expect(html).toContain('o6u-mark.png');
    expect(html).toContain('Student workspace');
    expect(html).toContain('Sign out');
  });

  it('keeps the same student tree while running: no sidebar, exam name, timer and counts', () => {
    const idle = shell(undefined);
    const running = shell({
      title: 'test_1',
      timeLeft: '19:41',
      shortClock: false,
      expired: false,
      answered: 0,
      total: 3,
      flagged: 0,
      fraction: 0.5,
      barColor: 'rgb(211, 84, 36)',
    });
    for (const html of [idle, running]) {
      expect(html).not.toContain('<aside');
      expect(html).toContain('grid-rows-[auto_minmax(0,1fr)]');
    }
    expect(running).toContain('test_1');
    expect(running).toContain('19:41');
    expect(running).toContain('Answered');
    expect(running).toContain('Flagged');
    expect(running).toContain('width:50%');
    expect(running).toContain('rgb(211, 84, 36)');
  });

  it('omits the time bar when the attempt span is unknown', () => {
    const html = shell({
      title: 'test_1',
      timeLeft: '19:41',
      shortClock: false,
      expired: false,
      answered: 0,
      total: 3,
      flagged: 0,
      fraction: null,
      barColor: null,
    });
    expect(html).not.toContain('transition-[width]');
  });
});
