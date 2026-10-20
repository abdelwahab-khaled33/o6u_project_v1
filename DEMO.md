# Demo Data

`npm run db:seed-demo` (from `apps/api`) populates the connected database with demo
content so every screen in the platform renders populated. It runs the **real**
services — sampling, grading, access-code creation, grade compensation — not raw
row inserts, so what you see is exactly what the product produces.

## Prerequisites

- `npm run db:migrate` applied.
- `npm run db:seed` run at least once (creates the `admin` account and the
  permission matrix; the demo seed refuses to run without it).

## Credentials (demo data)

Everyone shares the password `Demo!2026`. The seed prints this table plus the
current access codes when it finishes.

| Role    | Accounts                                                | Notes |
|---------|---------------------------------------------------------|-------|
| Admin   | `admin` / `admin123`                                    | from `npm run db:seed` |
| Doctors | `dr.hassan`, `dr.sara`, `dr.omar`                       | hassan ↔ CS301, sara ↔ CS415, omar ↔ MATH201 |
| TAs     | `ta.nour`, `ta.mariam`, `ta.youssef`                    | each staffs two subjects: nour CS301+MATH201, mariam CS301+CS415, youssef CS415+MATH201 |
| Students| `stu01` … `stu18` (codes `STU1001` … `STU1018`)         | enrolled across all three subjects, 12 per subject, two sections each |

Subjects: `CS301` Data Structures, `CS415` Software Engineering,
`MATH201` Probability and Statistics — two sections each (A/B, six students per section).

## What each screen shows

- **Admin — Users**: 25 accounts across all roles with enrollments and sections.
- **Admin — Exams**: seven exams covering every status — an approved and **already
  ended** exam with graded attempts and grade compensation, a **future** approved
  exam with untouched attempts, a **pending approval** exam, a **rejected** exam
  (with rejection reason), an **open (running)** exam with in-progress attempts,
  an approved **TA quiz** with mixed submitted/auto-submitted attempts, and a
  second, **currently open TA quiz** (`Lab Quiz 4`) with resumable and untouched
  attempts — the one exam a normal browser can take end-to-end.
- **Admin/Doctor — Results**: available on the ended exams (the running/future
  ones correctly refuse with the "after the exam ends" notice).
- **Doctor**: own question banks, exam wizard, live monitoring, access-code
  reveal, grade compensation on the ended exam.
- **TA**: shared subject bank with authorship, own quizzes (created approved, no
  approval step — an ended one with mixed attempts plus the open Lab Quiz 4),
  per-quiz results.
- **Student**: the enrolled exams list shows only **currently-open** exams —
  future and finished exams are absent by design, and a grade is never shown.
  On the open Lab Quiz 4, `stu13`/`stu14` have a resumable in-progress attempt
  and the rest can start it with its printed access code **in any browser** (TA
  quizzes bypass Safe Exam Browser). Doctor exams refuse a browser start with
  the exam-day SEB lock described below.

## Access codes

One code per approved exam/quiz, printed by the seed. Codes on exams whose window
has **already ended** are labelled "already ended" — they are expired and only
matter historically; the **open Lab Quiz 4** code is the one you can actually
start with in a browser.

## Safe Exam Browser (SEB)

The API's `SEB_KEYS` env var is set on Vercel to the demo key
`demo-seb-key-2026` (demo data by design, documented so a real Safe Exam Browser
client can be configured with it — the request hash is
`sha256(requestUrl + key)`). With it configured:

- Starting/resuming/answering/submitting a **doctor exam** without SEB gets the
  intended **403 "Please open this exam from Safe Exam Browser"** (before it was
  configured, production fail-closed with an ugly 500).
- **TA quizzes bypass SEB entirely**, which is why the open Lab Quiz 4 can be
  taken from any normal browser — that is the end-to-end demo path.

## Re-running

The seed is **idempotent by convergence** — run it as often as you like against
the same database:

- Users/subjects/sections/questions/exams are found by natural keys
  (username, code, subject+name, subject+text, owner+title) and updated in place.
- Passwords are always reset to `Demo!2026`.
- Exam **windows shift to stay relative to now** (the ended exam stays ended, the
  open exam stays open), and access-code expiry follows the new end time.
- Status, access codes, and rejection reasons are **never** overwritten once set.
- Finished attempts are never re-answered or re-graded — only their timestamps
  are refreshed to match the current window; attempts the plan marks
  `not_started` are left untouched.

After every run the seed verifies `total_grade == sum(grade_awarded)` on every
finished attempt and **throws** if any attempt violates it.

## Files

- `apps/api/src/scripts/demo-seed-data.ts` — the demo content (users, subjects,
  questions, exams, attempt plan) and the pure helpers; covered by
  `demo-seed-data.test.ts` (37 tests).
- `apps/api/src/scripts/seed-demo.ts` — the executor that applies it through the
  real services.
