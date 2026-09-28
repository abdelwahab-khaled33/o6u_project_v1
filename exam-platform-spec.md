# University Exam Platform — Technical Specification

| | |
|---|---|
| **Status** | Draft v2 (aligned with `exam-platform-prd.md`) |
| **UI language** | English |
| **Brand colors** | Primary Blue `#455B8A` · Accent Orange `#F2842F` · White `#FFFFFF` |
| **Hosting** | Self-hosted on servers inside the university network (no external cloud). Load may be distributed across multiple servers. |
| **Scale target** | ~5,000 concurrent students taking exams at the same instant (stress ceiling, not everyday load). |

---

## 0. Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) everywhere | Shared types between backend and frontend |
| Backend framework | **NestJS** (Express adapter) | Modules per domain; Guards for auth, roles, permissions, ownership, lab-network and SEB checks |
| ORM / DB | **Prisma** + **PostgreSQL 16** | UUID primary keys, all timestamps stored in UTC (`timestamptz`) |
| Validation | **Zod** schemas in a shared package | Same schemas validate API input and frontend forms |
| Password hashing | **argon2id** | Parameters tuned for ~50 ms/hash to survive login storms (see §11) |
| Auth | JWT in an `httpOnly`, `Secure`, `SameSite=Strict` cookie | `token_version` on User allows server-side revocation |
| Background jobs | **pg-boss** (PostgreSQL-backed queue) | No Redis needed. Used for imports, attempt pre-generation, auto-submit |
| Excel | **exceljs** | Read (imports) and write (exports). The npm `xlsx` package is outdated and is not used |
| Frontend | **React 18 + Vite**, React Router, TanStack Query, Mantine UI | Theme configured with brand colors |
| Reverse proxy / LB | **Nginx** | TLS termination, load balancing across API instances, static frontend |
| Process manager | **PM2** (cluster mode) or multiple Docker replicas | One Node process per CPU core |
| Connection pooling | **PgBouncer** (transaction mode) | Required once multiple API instances share one PostgreSQL |
| File storage | Local uploads directory (shared mount if >1 API server) | Question images only |
| Load testing | **k6** | Proves the 5,000-concurrent target (§11) |
| Packaging | **Docker Compose** + pnpm workspaces monorepo | |

### Repository layout

```
/apps
  /api        NestJS application (+ pg-boss worker entrypoint)
  /web        React + Vite application
/packages
  /shared     Zod schemas, enums, permission keys, DTO types
/infra        docker-compose, nginx config, k6 scripts
/prisma       schema.prisma, migrations, seed (initial Admin + permission defaults)
```

---

## 1. User Roles

| Role | Can do |
|---|---|
| **Admin** | Full system control: users, subjects, sections, permissions, exams; approves Doctor exams; the **only** role that can regenerate exam access codes; can release student sessions; performs term reset. |
| **Doctor** | The **single** instructor of record for a subject; owns a private question bank for that subject; creates official exams (Midterm/Final) that require Admin approval; views/exports results; compensates grades. |
| **Teaching Assistant (TA)** | Teaches one or more sections of a subject; contributes to the subject's shared TA question bank; creates quizzes for their own sections only (no approval needed); views/exports grades for their own students only. |
| **Student** | Sees only enrolled subjects and exams/quizzes available to them; takes them inside the lab network under lockdown conditions. |

### Structural rules (enforced by schema + validation)
- Each subject has **exactly one Doctor** (`Subject.doctor_id`).
- Each section has **exactly one TA**.
- Each student belongs to **exactly one section per enrolled subject** (fixed for the term).
- A TA may teach several sections, possibly in several subjects.

---

## 2. Admin Module

### 2.1 Authentication
- The initial Admin account is created by the database seed script (username/password from environment variables).
- Admin, Doctors, and TAs **may** change their own password (never forced).
- **Students cannot change their password.** It stays as set in the Excel roster (the university accepts that student passwords may be similar). The exam access code (§5.2) and lab-network restriction (§6) are the compensating controls.

### 2.2 Bulk User Import (Excel)

**Workbook format** (one `.xlsx` file, three sheets):

| Sheet | Columns | Notes |
|---|---|---|
| `subjects` | `code`, `name` | Optional sheet. Creates/updates subjects by `code`. |
| `users` | `username`, `password`, `full_name`, `role`, `student_code` | `role` ∈ `doctor`, `ta`, `student`. `student_code` required for students, unique. `password` required for new users; blank on an existing user = keep current password. |
| `assignments` | `username`, `subject_code`, `section_name` | Doctor: `subject_code` only (sets the subject's Doctor). TA: `subject_code` + `section_name` (creates the section if missing and assigns this TA). Student: `subject_code` + `section_name` (creates the enrollment in that section). |

**Import flow:**
1. `POST /admin/users/import/dry-run` — Admin uploads the file. A background job parses and validates every row **without touching live tables**. Passwords are hashed during this step; plain-text passwords are never persisted or logged. The raw file is deleted as soon as parsing finishes.
2. Validation results are stored in an `ImportBatch` (expires after 1 hour) and returned as a report: total rows, valid rows, error rows with reasons.
3. `POST /admin/users/import/:batchId/commit` — commits all valid rows in one transaction.

**Validation rules:**
- Missing required fields; invalid role; duplicate username or `student_code` inside the file.
- Unknown `subject_code` (not in DB and not in the `subjects` sheet).
- A subject assigned to two different Doctors (in the file, or conflicting with an existing Doctor not being replaced).
- A section assigned to two different TAs.
- A student placed in two sections of the same subject.
- Changing the role of an existing username is rejected (must be done manually by Admin).

**Update semantics:** an existing `username` is an **update**, not a duplicate error. For every user present in the file, their assignments are **replaced** by the ones in the file.

### 2.3 Permissions Tab
- Permission keys are a fixed list defined in `packages/shared` (see §9). Each key declares which roles it is **applicable** to.
- Each role has a default permission set (seeded).
- Admin can override a user's permission on/off, **but only for keys applicable to that user's role** (e.g. a Student can never be granted `exam.create`). Hard role boundaries always apply on top of permissions.

### 2.4 Subjects, Sections & Users
- CRUD for subjects (including assigning/changing the Doctor), sections (including assigning/changing the TA), and users (activate/deactivate, reset password, edit enrollment/section).

### 2.5 Exam Management & Approval
- Admin can create, edit, or delete any exam/quiz, subject to the time locks in §4.
- An Admin-created exam uses the subject Doctor's question bank, is owned by that Doctor, and is **approved immediately**.
- Doctor-authored exams require Admin approval before students can see them. Rejection requires a reason; the Doctor edits and resubmits. Rejected exams are never auto-deleted.
- Any **Doctor** edit to an approved exam resets it to `pending_approval`. An Admin edit keeps it `approved` (the Admin's edit is itself an approval).
- TA quizzes do not require approval.
- Admin is the **only** role that can regenerate an exam's access code (§5.2).

### 2.6 Term Reset
- `POST /admin/term/reset` (requires typing a confirmation phrase).
- Deletes: all non-Admin users, enrollments, sections, question banks (and uploaded images), exams, attempts, grade adjustments, import batches/logs.
- Keeps: Admin accounts, subjects, permission defaults.
- Before a reset, Doctors and TAs export their question banks to Excel (§3.1); the export format is directly re-importable.

---

## 3. Question Banks

### 3.1 Common rules (Doctor bank and TA shared bank)
- Fields: `question_type` (`mcq` | `true_false`), `text`, `options`, `correct_option_id`, `difficulty` (`easy` | `medium` | `hard`), optional image.
- Questions **do not carry a point value**; points are set once per exam (§4).
- MCQ: 2–6 options. True/False: exactly two fixed options (`True`, `False`).
- Added manually (with an optional image attached in the form) or via Excel import (text only — **no image zip upload in v1**). An image can be attached afterward by editing the question.
- Excel import uses the same dry-run → commit flow as user import.
- Excel export of the bank uses the same format so it can be re-imported next term.
- Deletion is a soft delete (`deleted_at`); historical attempts are unaffected because they hold snapshots (§4.4).
- **Edit lock:** a question cannot be edited or deleted while it is in the pool of an exam that is `pending_approval` or `approved` and has not yet ended. The user must remove it from that pool first. (Ended exams are protected by snapshots, so no lock is needed after the end.)

**Question Excel format** (sheet `questions`):

| Column | Notes |
|---|---|
| `question_type` | `mcq` or `true_false` |
| `text` | required |
| `option_a` … `option_f` | MCQ: at least `option_a`, `option_b`. Ignored for true_false |
| `correct` | MCQ: letter `a`–`f`. True/False: `true` or `false` |
| `difficulty` | `easy`, `medium`, `hard` |

### 3.2 Doctor bank
- Private to the subject's Doctor. Admin can view it and build exams from it.
- Fully separate from the TA shared bank.

### 3.3 TA shared bank
- One bank per subject shared by all TAs of that subject.
- Each question records the TA who added it (`added_by_id`) and shows it in the UI.
- A TA can edit/delete only their own questions.

---

## 4. Exams & Quizzes

A quiz uses the same mechanism as an exam; `type` distinguishes them (`doctor_exam` | `ta_quiz`).

### 4.1 Configuration
| Field | Rule |
|---|---|
| `title` | required |
| `pool` | explicit list of questions from the owner's bank (Doctor bank for exams; for quizzes: full TA shared bank or only the TA's own questions — chosen per quiz, then the TA selects from that source) |
| `difficulty_mix` | e.g. `{"easy": 5, "medium": 10, "hard": 5}` |
| `points_per_question` | one equal value for all questions. Max grade = total questions × points |
| `duration_minutes`, `start_time`, `end_time` | `end_time > start_time`; `duration ≤ end_time − start_time` |
| `target_scope` | `subject` (Doctor/Admin only), `sections`, or `student_list` (e.g. an ad-hoc redo) |

- **Pool validation:** for each tier, the pool must contain at least as many questions as the mix requests; otherwise saving is blocked with a clear error naming the tier and the shortfall.
- **TA quiz targeting:** `target_scope = sections`, restricted to sections the TA teaches (defaults to all of them). `student_list` for a TA is limited to students in their sections.

### 4.2 Status & lifecycle

Stored `status`: `pending_approval` | `rejected` | `approved`.
Derived **phase** (computed from server time): `upcoming` (now < start) · `live` (start ≤ now < end) · `ended` (now ≥ end).

| Action | Who | Allowed when | Result |
|---|---|---|---|
| Create exam | Doctor | — | `pending_approval` |
| Create exam | Admin | — | `approved` → generation |
| Create quiz | TA | — | `approved` → generation |
| Approve | Admin | `pending_approval`, phase ≠ `ended` | `approved` → generation. If already `live`, visible immediately after generation |
| Reject (reason required) | Admin | `pending_approval` | `rejected` |
| Edit | Owner / Admin | phase = `upcoming` | Doctor edit → `pending_approval` (existing attempts discarded). Admin/TA edit → stays `approved`, attempts regenerated |
| Resubmit | Doctor | `rejected`, phase ≠ `ended` | `pending_approval` |
| Delete | Owner / Admin | phase = `upcoming` (any status), or never-approved | Removed with its attempts |

- Configuration is immutable once `start_time` passes (NFR-4).
- A pending exam that reaches `end_time` without approval is shown as **expired** and can only be deleted.

### 4.3 Attempt pre-generation
When an exam becomes `approved`, a pg-boss job generates one `StudentExam` per **eligible student**:
- `subject` → all students enrolled in the subject.
- `sections` → students enrolled in the targeted sections.
- `student_list` → the listed students.

For each student: randomly sample the requested number of questions per tier from the pool, shuffle question order, shuffle MCQ option order (True/False keeps fixed order), and write immutable snapshots (§4.4). Inserts are batched (e.g. 5,000 rows per `createMany`).

- `Exam.generation_status` (`idle` | `running` | `done` | `failed`) — students see the exam only when `done`.
- **Late-eligible students** (e.g. added to the roster after approval) get their attempt generated lazily, idempotently (protected by the unique `(exam_id, student_id)` constraint), the first time they list or open the exam.

### 4.4 Snapshot integrity
Each `StudentExamQuestion` stores its own copy of the question text, image URL, options (in the student's shuffled order), correct option, type, and difficulty. Grading and review use only the snapshot, so later edits/deletes in the bank never change historical attempts.

### 4.5 Grade compensation (flawed questions)
- Owner (Doctor for exams, and also for TA quizzes of their subject) or Admin can adjust grades after a question is found flawed, during or after the exam.
- Adjustment types:
  - `full_credit` — award full points for a source question to all (or selected) students who received it.
  - `set_points` — set a specific value for selected students on that question.
- Each affected row creates a `GradeAdjustment` record (actor, time, reason, previous value, new value), and `StudentExam.total_grade` is recomputed.
- If an attempt is still in progress, the adjustment is applied at grading time on submission.

---

## 5. Student Module

### 5.1 Visibility
A student sees an exam/quiz only if **all** hold:
1. Enrolled in the subject.
2. Exam is `approved` and `generation_status = done`.
3. Phase is `live`.
4. Student is in the target (subject / section / list).
5. Student's attempt is not already submitted.

### 5.2 Access code
- On approval (or creation for Admin exams/quizzes), the system generates a random 6-character access code with an expiry (`access_code_expires_at`, default: the exam's `end_time`, adjustable by Admin).
- The code is stored hashed; the plain value is shown to the **exam owner** (Doctor or TA) and Admins so it can be announced in the lab. For this, the plain code is stored encrypted at rest (AES-GCM with a server key), not in plain text.
- **Only Admin** can regenerate the code (`POST /admin/exams/:id/access-code/regenerate`). Regeneration invalidates the old code for new entries; students already inside keep their session.
- Wrong-code attempts are rate-limited per student (e.g. 5 per minute).

### 5.3 Starting and resuming
`POST /student/exams/:examId/start` (after the network check, SEB check for Doctor exams, and access code verification on first entry):
- First entry: sets `started_at = now`, `deadline_at = min(started_at + duration, end_time)`, and creates an **exam session** bound to the client IP (`session_ip`) with a random `session_token` (returned in an `httpOnly` cookie).
- Resume: if an active session exists **and the request comes from the same IP**, a new token is issued and the student continues exactly where they left off. No access code is needed on resume.
- Different IP while a session is active → `409 SESSION_ACTIVE_ELSEWHERE` ("Ask your supervisor to release your session").
- **Session release:** the exam owner or an Admin calls `POST /exams/:examId/attempts/:studentExamId/release`. This clears `session_ip`/`session_token` (recorded with actor and time). The student then resumes on the replacement device. The timer keeps running and the release does not trigger submission.
- Every answer/flag/heartbeat/submit request must present the current `session_token`.

> Assumption: each lab machine has a distinct IP visible to the server (no NAT between labs and the servers). See §11.

### 5.4 During the exam
- The server returns `deadline_at` and `server_now`; the client computes its clock offset and displays a countdown that cannot be paused.
- Each answer and flag change is saved immediately (`PATCH`), so a disconnect never loses progress.
- Heartbeat every 30 s updates `last_heartbeat_at` (monitoring only; never pauses the timer).
- Exam UI: fullscreen request, copy/cut/paste/context-menu/text-selection disabled, navigation away warned. (For Doctor exams SEB provides the real lockdown; for quizzes these browser-level measures plus the lab network are the controls.)
- Student can flag any question and see an overview grid (answered / unanswered / flagged).

### 5.5 Submission and grading
- Manual submit is rejected with `409` if any question is unanswered.
- **Auto-submit** at `deadline_at`:
  - A pg-boss job is scheduled for `deadline_at` when the attempt starts.
  - A sweeper job runs every minute to finalize any overdue attempts (safety net).
  - Any request on an overdue attempt finalizes it first (lazy check).
  - Unanswered questions receive zero.
- Answers arriving after `deadline_at` are rejected.
- Grading is automatic on submission: `points_awarded = points_per_question` if correct else 0; `total_grade` = sum.
- After submission the attempt is locked; the student never sees their grade or answers on the platform.

---

## 6. Network Restriction & Safe Exam Browser

### 6.1 Lab-network restriction (all exams and quizzes)
- Every student exam-taking route (`/student/exams/:examId/*`) requires the client IP to be inside the configured `LAB_NETWORK_CIDRS` list.
- Client IP is taken from Nginx's `X-Forwarded-For`, with NestJS `trust proxy` limited to the Nginx host(s) so clients cannot spoof it.
- Failure → `403 LAB_NETWORK_REQUIRED` ("This exam can only be taken from the university labs").

### 6.2 Safe Exam Browser (Doctor exams only)
- Applies to `type = doctor_exam` (including Admin-created exams). TA quizzes require the lab network only.
- SEB (pre-installed on lab machines) sends `X-SafeExamBrowser-RequestHash` = `SHA256(absolute request URL + Browser Exam Key)` (hex), and `X-SafeExamBrowser-ConfigKeyHash` = `SHA256(absolute request URL + Config Key)`.
- The backend recomputes the hash for each configured key and accepts the request if any matches.
  - `SEB_BROWSER_EXAM_KEYS` — list of valid Browser Exam Keys (different labs/configurations supported).
  - `SEB_CONFIG_KEYS` — optional list of valid Config Keys (more stable: the Browser Exam Key changes whenever the SEB version or configuration changes).
- **URL reconstruction:** behind Nginx, the absolute URL must be rebuilt exactly as SEB saw it: `SEB_PUBLIC_BASE_URL` (scheme + host + port) + original path + query string, without fragment.
- Missing header or mismatch → `403 SEB_REQUIRED` ("Please open this exam from Safe Exam Browser").
- **Development mode:** `SEB_MODE = enforce | bypass`. `bypass` skips the check for local development and is refused at startup when `NODE_ENV=production`.
- **Deferred:** verifying on a real SEB machine (including that SEB attaches the headers to the SPA's `fetch` requests) is scheduled for a later phase (§12, Phase 6).

---

## 7. Results & Export

### 7.1 Visibility
| Viewer | Can see | When |
|---|---|---|
| Doctor | Own subject exams + all TA quizzes of the subject, grouped by section and labeled with the responsible TA | After each exam/quiz ends |
| TA | Only quizzes they own, only students in their sections. **Never** Doctor exam grades | After the quiz ends |
| Admin | Everything | Anytime (including live monitoring) |
| Student | Nothing after submission | — |

### 7.2 Live monitoring
`GET /exams/:examId/live` (owner/Admin): per student — not started / in progress (online if heartbeat within 60 s, otherwise offline) / submitted / auto-submitted, answered count, deadline. Includes the **Release session** action.

### 7.3 Excel export
- Header rows: subject code + name, exam/quiz title, date/time, max grade.
- Columns: `Student Name`, `Student ID` (`student_code`), `Section`, `Grade`.
- Scopes at export time:
  - `exam:{id}` — single Doctor exam.
  - `quiz:{id}` — single TA quiz.
  - `all` — one row per student, one column per exam/quiz in the subject, plus section and TA name.
- TA export: own quizzes, own students only.

---

## 8. Database Design (Prisma / PostgreSQL)

All IDs are `uuid`; all timestamps are `timestamptz` (UTC).

### 8.1 Identity & structure

**User**
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| username | string, unique | |
| password_hash | string | argon2id |
| full_name | string | |
| role | enum(admin, doctor, ta, student) | |
| student_code | string, unique, nullable | required for students |
| can_change_password | boolean | false for students |
| is_active | boolean | default true |
| token_version | int | incremented to revoke JWTs |
| created_at / updated_at | timestamptz | |

**Subject**
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| code | string, unique | e.g. `CS301` |
| name | string | |
| doctor_id | FK → User, nullable | exactly one Doctor per subject |

**Section**
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| subject_id | FK → Subject | |
| ta_id | FK → User | exactly one TA |
| name | string | unique per subject |

**Enrollment** (student ↔ subject, with fixed section)
| Field | Type | Notes |
|---|---|---|
| student_id | FK → User | |
| subject_id | FK → Subject | |
| section_id | FK → Section | must belong to `subject_id` |
| | | PK `(student_id, subject_id)` → one section per subject |

### 8.2 Question banks

**Question**
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| subject_id | FK → Subject | |
| bank | enum(doctor, ta_shared) | |
| added_by_id | FK → User | Doctor (doctor bank) or TA (attribution + edit rights) |
| question_type | enum(mcq, true_false) | |
| text | text | |
| options | jsonb | `[{ "id": "a", "text": "..." }, ...]` |
| correct_option_id | string | |
| difficulty | enum(easy, medium, hard) | |
| image_path | string, nullable | |
| deleted_at | timestamptz, nullable | soft delete |
| created_at / updated_at | timestamptz | |

### 8.3 Exams

**Exam**
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| subject_id | FK → Subject | |
| type | enum(doctor_exam, ta_quiz) | |
| title | string | |
| owner_id | FK → User | subject Doctor (exams) or TA (quizzes) |
| created_by_id | FK → User | may be an Admin |
| status | enum(pending_approval, rejected, approved) | phase is derived from time |
| rejection_reason | text, nullable | |
| approved_by_id / approved_at | FK / timestamptz, nullable | |
| quiz_source | enum(shared_bank, own_questions), nullable | quizzes only |
| difficulty_mix | jsonb | `{"easy":5,"medium":10,"hard":5}` |
| points_per_question | numeric(6,2) | |
| duration_minutes | int | |
| start_time / end_time | timestamptz | |
| target_scope | enum(subject, sections, student_list) | |
| access_code_hash | string, nullable | argon2/SHA-256 of the code |
| access_code_encrypted | string, nullable | AES-GCM, for display to owner/Admin |
| access_code_expires_at | timestamptz, nullable | |
| generation_status | enum(idle, running, done, failed) | |
| created_at / updated_at | timestamptz | |

**ExamQuestion** (explicit pool) — `exam_id`, `question_id`, PK `(exam_id, question_id)`

**ExamTargetSection** — `exam_id`, `section_id`

**ExamTargetStudent** — `exam_id`, `student_id`

**StudentExam** (one attempt per student per exam)
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| exam_id | FK → Exam | unique `(exam_id, student_id)` |
| student_id | FK → User | |
| status | enum(not_started, in_progress, submitted, auto_submitted) | |
| started_at | timestamptz, nullable | |
| deadline_at | timestamptz, nullable | `min(started_at + duration, end_time)` |
| submitted_at | timestamptz, nullable | |
| total_grade | numeric(8,2), nullable | |
| session_token_hash | string, nullable | active session |
| session_ip | inet, nullable | device binding |
| last_heartbeat_at | timestamptz, nullable | monitoring only |

**StudentExamQuestion** (immutable snapshot + answer)
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| student_exam_id | FK → StudentExam | |
| source_question_id | FK → Question | for compensation lookups |
| position | int | student's shuffled order |
| question_type | enum | snapshot |
| text | text | snapshot |
| image_path | string, nullable | snapshot (image files are kept until term reset) |
| options | jsonb | snapshot, in the student's shuffled order |
| correct_option_id | string | snapshot — never sent to the client |
| difficulty | enum | snapshot |
| selected_option_id | string, nullable | |
| is_flagged | boolean | default false |
| points_awarded | numeric(6,2), nullable | |

### 8.4 Audit

**GradeAdjustment**
| Field | Type |
|---|---|
| id | uuid PK |
| student_exam_question_id | FK → StudentExamQuestion |
| actor_id | FK → User |
| adjustment_type | enum(full_credit, set_points) |
| reason | text (required) |
| previous_points | numeric |
| new_points | numeric |
| created_at | timestamptz |

**SessionEvent** — `id`, `student_exam_id`, `event` enum(started, resumed, released, rejected_other_device), `actor_id` (nullable), `ip`, `created_at`

**AccessCodeEvent** — `id`, `exam_id`, `actor_id`, `event` enum(generated, regenerated), `created_at`

### 8.5 Access control
**RolePermission** — `role`, `permission_key`, `allowed`
**UserPermissionOverride** — `user_id`, `permission_key`, `allowed`

### 8.6 Imports
**ImportBatch** — `id`, `type` enum(users, questions), `uploaded_by_id`, `subject_id` (questions only), `filename`, `status` enum(validating, ready, committing, committed, failed, expired), `total_rows`, `valid_count`, `error_count`, `errors` jsonb, `valid_rows` jsonb (passwords already hashed), `expires_at`, `created_at`, `committed_at`

`valid_rows` is cleared after commit or expiry.

---

## 9. Permission Keys

| Key | Applicable roles | Default on for |
|---|---|---|
| `users.manage` | admin | admin |
| `subjects.manage` | admin | admin |
| `permissions.manage` | admin | admin |
| `exams.approve` | admin | admin |
| `exams.manage_all` | admin | admin |
| `exams.access_code.regenerate` | admin | admin |
| `term.reset` | admin | admin |
| `question_bank.manage` | doctor, ta | doctor, ta |
| `question_bank.import` | doctor, ta | doctor, ta |
| `question_bank.export` | doctor, ta | doctor, ta |
| `exam.create` | doctor | doctor |
| `quiz.create` | ta | ta |
| `results.view` | admin, doctor, ta | admin, doctor, ta |
| `results.export` | admin, doctor, ta | admin, doctor, ta |
| `grades.adjust` | admin, doctor | admin, doctor |
| `sessions.release` | admin, doctor, ta | admin, doctor, ta |
| `exam.take` | student | student |
| `password.change_own` | admin, doctor, ta | admin, doctor, ta |

Effective permission = user override if present, else role default. Ownership and scope (own subject / own sections / own questions) are always enforced in addition.

---

## 10. API Design (REST)

Base path: `/api/v1`. All inputs validated with Zod. Errors use `{ code, message, details? }`.

### Auth
- `POST /auth/login` — rate-limited per username and IP
- `POST /auth/logout`
- `GET /auth/me`
- `POST /auth/change-password` — blocked for students

### Admin — users, subjects, sections
- `POST /admin/users/import/dry-run` → `{ batchId }`
- `GET /admin/imports/:batchId` — status + validation report
- `POST /admin/users/import/:batchId/commit`
- `GET /admin/users` (filters: role, subject, section, search) · `POST /admin/users` · `PATCH /admin/users/:id` · `POST /admin/users/:id/reset-password`
- `GET|POST /admin/subjects` · `PATCH|DELETE /admin/subjects/:id`
- `GET|POST /admin/sections` · `PATCH|DELETE /admin/sections/:id`
- `PUT /admin/enrollments` — set a student's section in a subject

### Admin — permissions
- `GET /admin/permissions/defaults` · `PATCH /admin/permissions/defaults`
- `GET /admin/permissions/users/:id` · `PATCH /admin/permissions/users/:id`

### Admin — exams & term
- `GET /admin/exams?status=&phase=&subject_id=`
- `POST /admin/exams/:id/approve`
- `POST /admin/exams/:id/reject` — `{ reason }`
- `POST /admin/exams/:id/access-code/regenerate` — optional `{ expires_at }`
- `POST /admin/term/reset` — `{ confirmation }`

### Question bank (scope enforced server-side)
- `GET /question-bank?subject_id=&bank=&difficulty=&mine=`
- `POST /question-bank` — `bank` derived from caller's role
- `PATCH /question-bank/:id` · `DELETE /question-bank/:id`
- `POST /question-bank/:id/image` (multipart) · `DELETE /question-bank/:id/image`
- `POST /question-bank/import/dry-run` — `{ subject_id }` + Excel
- `POST /question-bank/import/:batchId/commit`
- `GET /question-bank/export?subject_id=`

### Exams & quizzes (owner or Admin)
- `GET /exams?subject_id=` — exams visible to the caller
- `POST /exams` — status set per §4.2 from the caller's role
- `GET /exams/:id` — includes access code for owner/Admin
- `PATCH /exams/:id` — only when phase = `upcoming`
- `POST /exams/:id/resubmit`
- `DELETE /exams/:id`
- `GET /exams/:id/live`
- `POST /exams/:id/attempts/:studentExamId/release`
- `POST /exams/:id/compensate` — `{ source_question_id, adjustment_type, points?, student_exam_ids?, reason }`
- `GET /exams/:id/adjustments`

### Student exam-taking
Middleware chain on `/student/exams/:examId/*`: auth → role student → lab network → SEB (Doctor exams) → eligibility → session token (except `start`).
- `GET /student/subjects`
- `GET /student/exams` — currently available exams (not network-restricted, so students can see what is open)
- `POST /student/exams/:examId/start` — `{ access_code? }` → attempt state, questions (without correct answers), `deadline_at`, `server_now`
- `GET /student/exams/:examId/state`
- `PATCH /student/exams/:examId/answer` — `{ student_exam_question_id, selected_option_id }`
- `PATCH /student/exams/:examId/flag` — `{ student_exam_question_id, is_flagged }`
- `POST /student/exams/:examId/heartbeat`
- `POST /student/exams/:examId/submit` — `409` if any unanswered

### Results & export
- `GET /results/exams/:examId` — role-scoped per §7.1
- `GET /results/subjects/:subjectId` — combined view grouped by section/TA (Doctor/Admin)
- `GET /results/export?subject_id=&scope=exam:{id}|quiz:{id}|all` — role-scoped

---

## 11. Scale, Deployment & Operations

### 11.1 Topology
```
Lab clients ──► Nginx (TLS, LB, static web) ──► API instances (NestJS × N cores, 1..k servers)
                                                   │
                                   pg-boss worker ─┤
                                                   ▼
                                     PgBouncer ──► PostgreSQL (primary)
```
- API is stateless (JWT + DB-held exam sessions), so instances scale horizontally.
- The uploads directory is a shared mount when there is more than one API server.

### 11.2 Load profile at 5,000 concurrent students
| Event | Estimated load | Mitigation |
|---|---|---|
| **Login storm** at exam start | 5,000 password hashes within 1–2 minutes | argon2id tuned to ~50 ms; hashing spread across all cores/servers; login rate limiting; students log in before the access code is announced |
| Start | 5,000 reads of pre-generated attempts | Attempts pre-generated at approval, so start is just an update + read |
| Answers + flags | ~150–300 writes/s | Single-row indexed updates |
| Heartbeats | ~170 req/s (30 s interval) | Lightweight update |
| Auto-submit at end | Up to 5,000 finalizations near `end_time` | Batched by pg-boss workers |
| Pre-generation | e.g. 5,000 × 40 = 200k snapshot rows | Batched `createMany` in a background job |

### 11.3 Load testing (k6)
Scripts in `/infra/k6`: login storm, start + answer loop + heartbeat, synchronized end-time auto-submit. Run against a staging environment that mirrors the lab servers; record p95 latency and error rate as evidence for NFR-1.

### 11.4 Configuration (environment)
`DATABASE_URL`, `JWT_SECRET`, `ACCESS_CODE_ENC_KEY`, `LAB_NETWORK_CIDRS`, `TRUSTED_PROXY_IPS`, `SEB_MODE`, `SEB_BROWSER_EXAM_KEYS`, `SEB_CONFIG_KEYS`, `SEB_PUBLIC_BASE_URL`, `UPLOADS_DIR`, `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD`.

### 11.5 Assumptions
- Lab machines have distinct IPs visible to the server (no NAT), required for session device binding and network restriction.
- Server clocks are NTP-synchronized.
- University IT provides the lab CIDR ranges and the SEB Browser Exam Key(s) / Config Key(s).

---

## 12. MVP Implementation Plan

| Phase | Scope | Done when |
|---|---|---|
| **0. Foundation** | Monorepo (pnpm), NestJS + React/Vite skeletons, shared package, Docker Compose (Postgres), Prisma schema + migrations, seed Admin + permission defaults, lint/format, brand theme | `docker compose up` runs API + web; Admin can log in |
| **1. Identity & structure** | Auth, change password, RBAC + permission guards, subjects/sections/users CRUD, user Excel import (dry-run → commit), permissions tab | Admin onboards a full roster from Excel |
| **2. Question banks** | Doctor bank, TA shared bank with attribution/ownership, manual add with image, Excel import/export, edit lock | Doctor and TAs build banks manually and via Excel |
| **3. Exams & workflow** | Exam/quiz creation, pool + mix validation, approval/reject/resubmit, time locks, pre-generation job, access codes | Approved exam has one unique snapshot attempt per eligible student |
| **4. Exam-taking** | Student dashboard, lab-network guard, SEB guard (bypass mode in dev), access code, start/resume, session binding + release, answers/flags/heartbeat, submit rules, auto-submit, lockdown UI, live monitor | Full student flow works end to end in dev |
| **5. Results** | Result views per role, compensation + audit, Excel exports | Doctor/TA/Admin see and export correct scoped grades |
| **6. Hardening** | Term reset, k6 load tests, Nginx + PM2 cluster + PgBouncer deployment, **real SEB verification on a lab machine** | Load-test report; SEB check verified on real hardware |

Testing throughout: unit tests for sampling, grading, deadline, and permission logic; e2e API tests for each role's workflow.
