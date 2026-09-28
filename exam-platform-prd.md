# Product Requirements Document (PRD)
## University Exam & Quiz Platform

| | |
|---|---|
| **Status** | Draft v2 (decisions of review round 1 applied) |
| **Owner** | Abdelwahab |
| **Type** | Graduation project |
| **UI Language** | English |
| **Brand colors** | Primary Blue `#455B8A` · Accent Orange `#F2842F` · White `#FFFFFF` |

---

## 1. Problem Statement

The university currently has no unified digital system for creating, administering, and grading exams and quizzes across departments. Exam creation, question management, student data, and grading are handled manually or through disconnected tools. This creates overhead for Doctors and Teaching Assistants (TAs), inconsistent security during exams, and no central place for Admins to oversee and audit academic assessments.

## 2. Goal

Build a single web platform where an Admin can onboard all university users and subjects, Doctors and TAs can build question banks and run exams/quizzes under one governed workflow, and Students can take secure, timed, locked-down exams — reliable enough to be used for real, audited assessments (Midterms/Finals), not just practice tools.

## 3. Objectives / Success Criteria

- All four roles (Admin, Doctor, TA, Student) can complete their full workflow without leaving the platform.
- Doctor-authored high-stakes exams (Midterm/Final) go through a mandatory Admin approval gate before students can see them.
- Every student gets a unique, randomly-generated question set matching a fixed difficulty mix, with shuffled question and answer-option order, reducing the value of copying a neighbor's screen.
- Exam sessions are restricted to the university lab network; Doctor exams are additionally locked down with Safe Exam Browser; all sessions use fullscreen + disabled copy/paste to reduce cheating opportunities.
- The system can withstand a stress scenario of ~5,000 students taking exams at the same instant, even though this isn't the expected everyday load.
- Grades are trustworthy enough to stand as the official record — no student can submit with unanswered questions, no student can see answers after submitting, and every grade override is explicit and attributable.

## 4. Scope

### In scope (v1)
- Admin: bulk user/subject onboarding via Excel, permission management, full exam oversight and approval.
- Doctor: private question bank per subject, exam creation/editing (pre-approval), results viewing/export, grade compensation for flawed questions.
- TA: question bank shared among all TAs of a subject, quiz creation for their own sections only (no approval needed), grade viewing/export scoped to their own students.
- Student: subject-scoped exam visibility, locked-down exam-taking experience, flagging, mandatory full completion before submit.
- Security: lab-network (IP range) restriction for all exams and quizzes; Safe Exam Browser integration via Browser Exam Key validation for Doctor exams; time-limited access code; fullscreen lock; copy/paste disabled.
- Question types: Multiple Choice and True/False only.
- Difficulty tiering: 3 fixed levels (Easy / Medium / Hard), fixed mix per exam.
- Excel-based bulk import for both users and questions, with a validation/dry-run step before committing.
- Manual image attachment for questions and Excel export of question banks.
- Results export to Excel (per exam, per quiz, or combined).

### Out of scope (v1)
- SSO / direct integration with the university's central student information system — accounts are Excel-only for now.
- Question types beyond MCQ and True/False (e.g. essay, fill-in-the-blank).
- Per-student adaptive difficulty (the mix is fixed per exam, not adjusted per student ability).
- A dedicated "compensatory exam" system feature — a redo is just a normal new exam; the university manages student device access for it outside the system.
- Automatic cross-device session handoff. A controlled recovery is supported instead: the exam owner or an Admin must release the student's active session before the student resumes on a replacement device.
- Image zip uploads alongside question-bank Excel imports.
- Cloud hosting — the system is self-hosted inside the university network.

## 5. User Roles & Core Needs

| Role | Core need | Primary workflows |
|---|---|---|
| **Admin** | Control and oversight of the whole system | Bulk onboarding, permissions, subject/user management, exam approval |
| **Doctor** | Run trustworthy, official assessments for their subject | Question bank, exam creation, approval submission, results/export |
| **TA** | Run lightweight formative/official quizzes for their own sections | Shared question bank, quiz creation, grading their own students |
| **Student** | Take exams fairly and securely | View available exams, take exam under lockdown, flag/review, submit |

## 6. Functional Requirements

### 6.1 Admin
- FR-1: Admin logs in with a pre-set username/password and can change their own password (not forced) after first login. Doctors and TAs may also change their own password (not forced). Students cannot change their password; it stays as set in the Excel roster.
- FR-2: Admin bulk-creates/updates Students, Doctors, and TAs via Excel upload (`username`, `password`, `full_name`, `student_code` for students, role, subject/section assignments).
- FR-3: Import runs a dry-run validation pass first (shows valid vs. error rows) before committing to the database.
- FR-4: An existing username in a new upload is treated as an update, not a duplicate error.
- FR-5: Admin manages a Permissions tab — default permission set per role, with per-user overrides.
- FR-6: Admin manages Subjects, Sections, and all user records directly (outside of Excel, for corrections). Each subject has exactly one Doctor; each section has exactly one TA; each student belongs to exactly one fixed section per enrolled subject.
- FR-7: Admin can create/edit/delete any exam, and must approve any Doctor-authored exam before it becomes visible to students. Admin-created exams use the owning Doctor's question bank and are approved immediately.
- FR-8: Rejecting an exam requires a reason; the Doctor can edit and resubmit.
- FR-9: A Doctor's edit to an already-approved exam resets it to "pending approval." An Admin's edit keeps it approved.
- FR-10: An exam can only be edited before its Start Time; its configuration locks automatically once in progress. A pending exam may still be approved after its Start Time and becomes visible immediately if it has not reached its End Time.
- FR-11: Each new term, Admin re-uploads a fresh Excel roster; the previous term's users, enrollments, sections, question banks, exams, attempts, results, and imports are fully replaced after the university's grade-appeal window closes.
- FR-11a: Before a term reset, Doctors and TAs can export their question banks to Excel for reuse in the next term.

### 6.2 Doctor
- FR-12: Doctor maintains a private, per-subject question bank (MCQ / True-False, with Difficulty per question).
- FR-13: Questions can be added via Excel (bulk, text only) or manually. An image can be attached only through the manual add/edit form. Questions do not carry their own point value.
- FR-14: Doctor builds an exam from an explicit pool of questions in their own bank, sets a fixed difficulty mix, one equal point value for every question in the exam, duration, start time, and end time.
- FR-15: Exam creation is blocked with a clear error if the question bank doesn't have enough questions at a requested difficulty tier.
- FR-16: When an exam is approved, the system pre-generates one uniquely sampled question set per eligible student matching the exam's difficulty mix. Each attempt stores an immutable snapshot of its question text, options, correct answer, and per-student shuffled question/option order.
- FR-17: Doctor-authored exams require Admin approval before publishing.
- FR-18: If a question is found flawed during/after an exam, the Doctor (or Admin) can award full credit or otherwise adjust the grade for affected students. Every adjustment records the actor, time, reason, prior value, and resulting value.
- FR-19: Doctor views results after an exam ends and exports them to Excel (Student Name, Student ID, Grade, with subject name + exam date as header).
- FR-20: At export time, Doctor chooses to export one exam's grades, one quiz's grades, or all exams + quizzes combined.
- FR-21: Doctor sees all students' grades (own exams and TA quizzes) grouped by section and labeled with the responsible TA's name. Doctor-authored exam grades are not visible to TAs (see FR-26).

### 6.3 Teaching Assistant (TA)
- FR-22: All TAs of a subject share one common question bank, separate from the Doctor's bank; each question is attributed to the TA who added it. The same add/import/export/image rules as the Doctor bank apply (FR-13).
- FR-23: A TA cannot edit or delete another TA's question.
- FR-24: TA creates quizzes visible only to students in the sections they personally teach; no Admin approval required.
- FR-25: When building a quiz, the TA chooses the question source: the full shared bank, or only questions they personally added.
- FR-26: TA quiz grades are officially counted (not "practice only") and are visible to the Doctor; the Doctor's own exam grades are not visible to the TA.
- FR-27: TA sees and exports grades only for students in the sections they teach.

### 6.4 Student
- FR-28: Student sees only subjects they're enrolled in, and only approved exams currently within their Start/End window and matching their section (if section-targeted).
- FR-29: Every exam and quiz can only be taken from inside the university lab network (configured IP ranges). Before starting, the Student enters a time-limited access code generated automatically by the system and announced by the exam owner (Doctor or TA) or an Admin. Only an Admin can regenerate the code. Doctor exams additionally run inside Safe Exam Browser; the backend verifies the session via a Browser Exam Key check before granting access. TA quizzes do not require Safe Exam Browser.
- FR-30: Exam screen is fullscreen-locked; copy/paste is disabled; only one active session is allowed per student per exam, bound to the device it started on.
- FR-31: Timer starts on exam entry and cannot be paused by the student. The server sets the deadline to the earlier of `started_at + duration` and the exam's End Time, so a late entrant only receives the time remaining before End Time.
- FR-32: If a student disconnects and their time has not expired, they can resume exactly where they left off on the same device. If the device fails, the exam owner or an Admin can release the active session to permit a controlled resume on a replacement device; this does not pause the timer or trigger auto-submit.
- FR-33: The server auto-submits once the student's deadline is reached. Unanswered questions are submitted with zero credit.
- FR-34: Student can flag any question to revisit later.
- FR-35: Student cannot manually submit while any question is unanswered.
- FR-36: After submission, the exam locks; the student never sees their grade or answers again on the platform.

## 7. Non-Functional Requirements

- **NFR-1 (Scale):** The system must be architected to handle ~5,000 concurrent exam-taking sessions (stress scenario), likely requiring load distribution across multiple on-prem servers.
- **NFR-2 (Hosting):** Self-hosted inside the university network — no external cloud dependency. Exam-taking is only possible from the lab network.
- **NFR-3 (Security):** Passwords are hashed on ingestion and never stored or logged in plain text; raw Excel files are not persisted after import.
- **NFR-4 (Integrity):** Exam configuration becomes immutable once the Start Time passes; completed attempts remain historically correct even if their source questions are later edited.
- **NFR-5 (Auditability):** All grade adjustments (question compensation, manual overrides) record the actor, time, reason, previous value, and resulting value.
- **NFR-6 (Availability during exams):** A disconnection must never silently cost a student their exam progress while time remains.

## 8. Assumptions & Dependencies

- University IT will provide the Browser Exam Key or keys for Safe Exam Browser validation. The application accepts a configured list of active keys so different labs/configurations can be supported.
- University IT will provide the lab network IP ranges. Each lab machine has a distinct IP visible to the server (no NAT), which is needed for network restriction and device-bound exam sessions.
- Safe Exam Browser is already installed and configured on lab machines — the project does not need to handle SEB deployment.
- Physical exam-taking logistics (seating, supervision, device assignment for redos) are handled by the university, not the platform.
- Grade appeal windows close before the next term begins, which is why a full data wipe-and-reload each term is acceptable.

## 9. Open Questions / Risks

| # | Question | Why it matters | Status |
|---|---|---|---|
| 1 | Realistic path to genuinely proving the 5,000-concurrent target (load testing, infra provisioning) given a self-hosted, no-cloud, single-developer graduation project | Scale claims need to be demonstrated, not just designed for | Mitigation planned: k6 load tests on a staging setup (spec §11) |
| 2 | Login storm: ~5,000 password verifications at exam start | Password hashing is CPU-heavy and is the main bottleneck at peak | Mitigation planned: tuned argon2id, multi-core/multi-server API, login before code announcement |
| 3 | The Browser Exam Key changes whenever the SEB version or configuration changes on lab machines | A silent change would block every student from Doctor exams | Mitigation planned: keys list + optional Config Key support; IT must notify before SEB changes |
| 4 | Real SEB verification (headers on SPA requests, URL behind the proxy) | Can only be proven on real lab hardware | Deferred to the hardening phase; development uses a bypass mode |
| 5 | Student passwords are similar and cannot be changed | Account sharing / impersonation risk | Accepted by the university; mitigated by the lab-network restriction, access code, and single device-bound session |

## 10. Related Documents
- Technical design (database schema + API endpoints): `exam-platform-spec.md`

## 11. Glossary
- **Doctor** — the instructor of record for a subject; owns official exams.
- **TA (Teaching Assistant)** — teaches specific sections of a subject; runs lightweight quizzes.
- **Section** — a group of students taught by a specific TA within a subject.
- **SEB** — Safe Exam Browser, the lockdown browser used during Doctor exams.
- **Access code** — a short, time-limited code generated per exam/quiz and announced in the lab; required on first entry. Only an Admin can regenerate it.
- **Lab network** — the configured university lab IP ranges; the only place exams and quizzes can be taken from.
