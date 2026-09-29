-- Load-test fixture. Idempotent: re-running resets the load-test cohort in place.
--
-- Everything here is written with SQL rather than the admin API on purpose. Creating 5,000
-- students through POST /admin/users means 5,000 sequential bcrypt hashes at cost 10
-- (~60 ms each) inside one transaction, which is minutes of pure seeding before the first
-- request is ever measured. The rows produced here are byte-identical in shape to what the
-- import produces, and the login cost is unchanged: bcrypt.compare re-derives the hash from
-- the stored salt, so one shared hash row costs the server exactly what 5,000 distinct
-- hashes would.
--
-- :student_count is substituted by seed.ps1. The psql -c quoting trap (PowerShell mangles
-- double-quoted identifiers, so "User" becomes \" User\") is why this is a file at all.

\set student_count 500

BEGIN;

-- A dedicated subject so cleanup is a single cascade and never touches real data.
INSERT INTO "Subject" (id, code, name, created_at)
VALUES ('11111111-1111-4111-8111-111111111111', 'LT0001', 'Load Test Subject', now())
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

-- Staff. The doctor owns the exam and the question pool; the TA owns the section.
-- password_hash is injected by the seeder as a real bcrypt hash of $load_test_password.
INSERT INTO "User" (id, username, password_hash, full_name, role, can_change_password, is_active, created_at, updated_at)
VALUES
  ('22222222-2222-4222-8222-222222222201', 'lt_doc', '__HASH__', 'Load Test Doctor', 'doctor', true, true, now(), now()),
  ('22222222-2222-4222-8222-222222222202', 'lt_ta',  '__HASH__', 'Load Test TA',     'ta',     true, true, now(), now()),
  ('22222222-2222-4222-8222-222222222203', 'lt_admin', '__HASH__', 'Load Test Admin', 'admin',  true, true, now(), now())
ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true;

INSERT INTO "DoctorAssignment" (doctor_id, subject_id)
VALUES ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111111')
ON CONFLICT DO NOTHING;

INSERT INTO "Section" (id, subject_id, ta_id, name, created_at)
VALUES ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222202', 'LT-SEC-1', now())
ON CONFLICT (subject_id, ta_id, name) DO NOTHING;

-- Reset the whole load-test subject so a re-run is a clean measurement rather than an
-- accumulation of the previous run's attempts. Scoped to the subject, not to the cohort:
-- the previous run's exams own ExamQuestion rows pointing at the question pool below, and
-- that FK is Restrict, so deleting the questions without deleting those exams fails.
-- Children always before parents.
DELETE FROM "GradeAdjustment" WHERE "student_exam_question_id" IN (
  SELECT q.id FROM "StudentExamQuestion" q
  JOIN "StudentExam" se ON se.id = q."student_exam_id"
  JOIN "Exam" e ON e.id = se."exam_id" WHERE e.subject_id = '11111111-1111-4111-8111-111111111111');
DELETE FROM "StudentExamQuestion" WHERE "student_exam_id" IN (
  SELECT se.id FROM "StudentExam" se
  JOIN "Exam" e ON e.id = se."exam_id" WHERE e.subject_id = '11111111-1111-4111-8111-111111111111');
DELETE FROM "StudentExam" WHERE "exam_id" IN (SELECT id FROM "Exam" WHERE subject_id = '11111111-1111-4111-8111-111111111111');
DELETE FROM "ExamTargetSection" WHERE "exam_id" IN (SELECT id FROM "Exam" WHERE subject_id = '11111111-1111-4111-8111-111111111111');
DELETE FROM "ExamTargetStudent" WHERE "exam_id" IN (SELECT id FROM "Exam" WHERE subject_id = '11111111-1111-4111-8111-111111111111');
DELETE FROM "ExamQuestion" WHERE "exam_id" IN (SELECT id FROM "Exam" WHERE subject_id = '11111111-1111-4111-8111-111111111111');
DELETE FROM "Exam" WHERE subject_id = '11111111-1111-4111-8111-111111111111';

DELETE FROM "Enrollment" WHERE student_id IN (SELECT id FROM "User" WHERE username LIKE 'lt\_stu\_%');
DELETE FROM "SectionMembership" WHERE student_id IN (SELECT id FROM "User" WHERE username LIKE 'lt\_stu\_%');
DELETE FROM "User" WHERE username LIKE 'lt\_stu\_%';

-- generate_series builds the cohort in one statement: no round trip per student.
INSERT INTO "User" (id, username, password_hash, full_name, student_code, role, can_change_password, is_active, created_at, updated_at)
SELECT
  ('4' || lpad(i::text, 7, '0') || '-0000-4000-8000-000000000000')::uuid,
  'lt_stu_' || lpad(i::text, 5, '0'),
  '__HASH__',
  'Load Student ' || i,
  'LT' || lpad(i::text, 5, '0'),
  'student', false, true, now(), now()
FROM generate_series(1, :student_count) AS i;

INSERT INTO "Enrollment" (student_id, subject_id)
SELECT id, '11111111-1111-4111-8111-111111111111'
FROM "User" WHERE username LIKE 'lt\_stu\_%'
ON CONFLICT DO NOTHING;

INSERT INTO "SectionMembership" (student_id, section_id)
SELECT id, '33333333-3333-4333-8333-333333333333'
FROM "User" WHERE username LIKE 'lt\_stu\_%'
ON CONFLICT DO NOTHING;

-- Question pool: 10 per difficulty. Exam difficulty_mix is 2/2/2, so the pool holds
-- 5x what any one student is asked, which is what makes per-student unique sampling
-- (spec 4.3) actually do work instead of handing everyone the same six questions.
DELETE FROM "Question" WHERE subject_id = '11111111-1111-4111-8111-111111111111';

INSERT INTO "Question" (id, subject_id, owner_type, doctor_id, question_type, text, options,
                         correct_answer, grade, difficulty, is_archived, created_at, updated_at)
SELECT
  ('5' || lpad(i::text, 7, '0') || '-0000-4000-8000-000000000000')::uuid,
  '11111111-1111-4111-8111-111111111111',
  'doctor', '22222222-2222-4222-8222-222222222201',
  'mcq',
  'Load test question ' || i || ' (' || d.difficulty || ')',
  '["Alpha", "Beta", "Gamma", "Delta"]'::jsonb,
  'Alpha', 2.00, d.difficulty::"Difficulty", false, now(), now()
FROM generate_series(1, 30) AS i
CROSS JOIN (VALUES ('easy', 0), ('medium', 1), ('hard', 2)) AS d(difficulty, ord)
WHERE ((i - 1) % 3) = d.ord;

COMMIT;
