import { Fragment } from 'react';
import { Link } from 'react-router-dom';

const INTRO_LINES = [
  'Two kinds of tests, four simple steps. Here is everything you need to know',
  'before you start.',
];

const TYPES = [
  {
    pill: 'Set by your TA',
    title: 'Quiz',
    body: 'A short check that appears as soon as your TA creates it. No access code needed.',
  },
  {
    pill: 'Set by your doctor',
    title: 'Exam',
    body: 'Open only inside its time window and needs the access code your supervisor announces.',
  },
];

const STEPS = [
  {
    title: 'Get the code',
    body: 'Your supervisor announces the access code at the exam. Enter it on your exams page.',
  },
  {
    title: 'Start inside the window',
    body: 'Once you press start, the clock cannot be paused.',
  },
  {
    title: 'Answer and flag',
    body: 'Flag a question to come back to it. Your answers are saved as you go.',
  },
  {
    title: 'Submit',
    body: 'Every question needs an answer before you submit. If time runs out, saved answers are submitted for you.',
  },
];

export function HowItWorksPage() {
  return (
    <div className="grid min-h-screen grid-rows-[auto_minmax(0,1fr)] bg-[#eef1f7] lg:h-screen lg:overflow-hidden">
      <header className="bg-[#1c2450]">
        <div className="mx-auto flex w-full max-w-[1080px] flex-wrap items-center gap-3 px-6 py-4">
          <img src="/o6u-logo.png" alt="October 6 University logo" className="h-11 w-auto rounded-[10px] bg-white px-2 py-1" />
          <Link
            to="/"
            className="ms-auto inline-flex min-h-[44px] items-center rounded-[9px] border border-white/50 px-5 font-semibold text-white hover:bg-white/10"
          >
            ← Back to welcome
          </Link>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1080px] content-start gap-5 overflow-y-auto px-6 py-7 lg:content-center lg:overflow-hidden lg:py-5">
        <div className="grid gap-2">
          <h1 className="text-[2rem] font-extrabold text-primary-dark">How exams work</h1>
          <p className="font-normal leading-[1.7] text-muted">
            {INTRO_LINES.map((line, index) => (
              <Fragment key={line}>
                {line}
                {index < INTRO_LINES.length - 1 && <br />}
              </Fragment>
            ))}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {TYPES.map((type) => (
            <article key={type.title} className="grid content-start gap-2 rounded-[14px] border border-[#e3e8f2] bg-white px-6 py-5 shadow-[0_4px_14px_rgb(36_52_80/7%)]">
              <span className="inline-block w-fit rounded-full bg-[#e8edf6] px-3 py-1 text-[0.78rem] font-semibold text-primary-dark">
                {type.pill}
              </span>
              <h2 className="text-[1.1rem] font-bold text-primary-dark">{type.title}</h2>
              <p className="font-normal leading-relaxed text-muted">{type.body}</p>
            </article>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <article key={step.title} className="grid content-start gap-2 rounded-[14px] border border-[#e3e8f2] bg-white px-5 py-5 shadow-[0_4px_14px_rgb(36_52_80/7%)]">
              <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-accent font-extrabold text-[#1a2148]">
                {index + 1}
              </span>
              <h2 className="text-[1rem] font-bold text-primary-dark">{step.title}</h2>
              <p className="text-[0.9rem] font-normal leading-relaxed text-muted">{step.body}</p>
            </article>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 rounded-[18px] bg-[#1c2450] px-7 py-5">
          <div className="grid gap-1">
            <p className="text-[1.15rem] font-bold text-white">And what is on the exam itself?</p>
            <p className="font-normal text-white/80">It will be a surprise 😉</p>
          </div>
          <Link
            to="/login"
            className="ms-auto inline-flex min-h-[44px] items-center rounded-[9px] bg-accent px-6 font-bold text-[#1a2148] hover:bg-accent-dark"
          >
            Sign in
          </Link>
        </div>
      </main>
    </div>
  );
}
