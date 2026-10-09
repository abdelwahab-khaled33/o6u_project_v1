import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { HowItWorksPage } from './HowItWorksPage';

function shell() {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/how-it-works']}>
      <HowItWorksPage />
    </MemoryRouter>,
  );
}

describe('how it works page', () => {
  it('renders the title, intro and back link', () => {
    const html = shell();
    expect(html).toContain('How exams work');
    expect(html).toContain('Two kinds of tests, four simple steps.');
    expect(html).toContain('Back to welcome');
    expect(html).toContain('href="/"');
  });

  it('renders both test-type cards with their pills', () => {
    const html = shell();
    expect(html).toContain('Set by your TA');
    expect(html).toContain('Quiz');
    expect(html).toContain('No access code needed.');
    expect(html).toContain('Set by your doctor');
    expect(html).toContain('Exam');
    expect(html).toContain('the access code your supervisor announces.');
  });

  it('renders the four numbered steps in order', () => {
    const html = shell();
    for (const title of ['Get the code', 'Start inside the window', 'Answer and flag', 'Submit']) {
      expect(html).toContain(title);
    }
    expect(html.indexOf('Get the code')).toBeLessThan(html.indexOf('Start inside the window'));
    expect(html.indexOf('Start inside the window')).toBeLessThan(html.indexOf('Answer and flag'));
    expect(html.indexOf('Answer and flag')).toBeLessThan(html.indexOf('Submit'));
    expect(html).toContain('saved answers are submitted for you.');
  });

  it('renders the surprise banner with a sign-in link', () => {
    const html = shell();
    expect(html).toContain('And what is on the exam itself?');
    expect(html).toContain('It will be a surprise');
    expect(html).toContain('href="/login"');
  });
});
