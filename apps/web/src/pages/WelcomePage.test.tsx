import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { WelcomePage } from './WelcomePage';

function shell() {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/']}>
      <WelcomePage />
    </MemoryRouter>,
  );
}

describe('welcome page', () => {
  it('renders the English headline on the same four lines as the mockup, sign-in link and language toggle by default', () => {
    const html = shell();
    expect(html).toContain('Exams,<br/>quizzes and<br/>results in one<br/>place.');
    expect(html).toContain('Sit the exams your doctors and TAs set, follow your results,<br/>and run your own exams');
    expect(html).toContain('href="/login"');
    expect(html).toContain('العربية');
    expect(html).toContain('How exams work');
  });

  it('renders the illustration placeholder and all three role cards', () => {
    const html = shell();
    expect(html).toContain('Placeholder: add a campus photo here');
    expect(html).toContain('Students');
    expect(html).toContain('Doctors and TAs');
    expect(html).toContain('Admins');
    expect(html).toContain('enter your access code');
  });

  it('renders the university facts strip', () => {
    const html = shell();
    expect(html).toContain('Open since 1996');
    expect(html).toContain('13 undergraduate faculties');
    expect(html).toContain('6th of October City, Giza');
  });
});
