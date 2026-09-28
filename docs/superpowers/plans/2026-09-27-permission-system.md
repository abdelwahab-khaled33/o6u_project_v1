# Permission System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the specification's 18-key permission matrix across the API while preserving all role, ownership, and result-scope restrictions.

**Architecture:** `@exam/shared` exports the sole permission vocabulary, applicability matrix, and defaults. A permissions service resolves an active user's effective permission from an override or role row; middleware and the role-dependent create-exam handler consume it. Routes retain their role and scope checks and add the corresponding permission check.

**Tech Stack:** TypeScript ESM, Express, Prisma, PostgreSQL, Vitest.

**Spec:** `exam-platform-spec.md:458-481`; `exam-platform-prd.md:86`; `exam-platform-spec.md:52,299,533`.

## Global Constraints

- Keep ESM relative API imports suffixed with `.js` and call `next(err)` from async-handler failures.
- Never replace role, ownership, or record-scope gates with permissions.
- A missing Permission row resolves false; a user override wins when its row exists, including `allowed: false`.
- Do not change result scoping, exam-taking behavior, sampling, grading, lab/device sessions, access codes, or the web app.
- Do not return 401 for an authenticated invalid request; unknown middleware permission keys remain a 500 programmer error.

## Review Focus

- An explicit false override must deny a role-default permission.
- A missing role permission must deny access even when no override exists.
- TAs must be denied both grade-compensation routes while retaining result access.
- Doctor and TA creation permissions must select `exam.create` and `quiz.create` respectively.
- The data migration must update existing permissive rows, not merely create absent rows.

---

### Task 1: Shared Permission Vocabulary

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/constants.ts`
- Test: `apps/api/src/services/permissions.test.ts`

**Interfaces:**
- Produces `PermissionKey`, `PERMISSION_KEYS`, `ROLE_APPLICABLE_PERMISSIONS`, and `DEFAULT_PERMISSIONS` exported from `@exam/shared`.

- [ ] **Step 1: Write failing vocabulary/default tests**

Assert 18 unique keys, every key appears in an applicable-role list, `grades.adjust` excludes TA, and `exam.take` includes only student.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -w @exam/api -- permissions.test.ts`

- [ ] **Step 3: Export the §9 vocabulary and matrices from `index.ts`**

Define `DEFAULT_PERMISSIONS` as `Record<PermissionKey, readonly Role[]>`; remove the duplicate permission declarations from `constants.ts` while preserving its other schema dependencies.

- [ ] **Step 4: Re-run the focused test**

Run: `npm test -w @exam/api -- permissions.test.ts`

### Task 2: Effective Permission Service

**Files:**
- Create: `apps/api/src/services/permissions.ts`
- Create: `apps/api/src/services/permissions.test.ts`
- Modify: `apps/api/src/middleware/auth.ts`

**Interfaces:**
- Produces `resolvePermission(userId: string, role: Role, key: PermissionKey): Promise<{ allowed: boolean; default_allowed: boolean; override: boolean | null }>`.

- [ ] **Step 1: Write failing resolution tests with a Prisma singleton mock**

Test true and false overrides over a true default, default fallback without override, missing permission default denial, plus doctor `exam.create` and TA `quiz.create` mapping.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -w @exam/api -- permissions.test.ts`

- [ ] **Step 3: Implement `resolvePermission` and delegate middleware resolution to it**

Query the role Permission row and user override; preserve inactive-account and unknown-key middleware behavior.

- [ ] **Step 4: Re-run the focused test**

Run: `npm test -w @exam/api -- permissions.test.ts`

### Task 3: Route Permission Gates

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/routes/admin-exams.ts`
- Modify: `apps/api/src/routes/questions.ts`
- Modify: `apps/api/src/routes/exams.ts`
- Modify: `apps/api/src/routes/grade-adjustments.ts`
- Modify: `apps/api/src/routes/results.ts`
- Modify: `apps/api/src/routes/student-exams.ts`
- Modify: `apps/api/src/routes/auth.ts`

**Interfaces:**
- Consumes `requirePermission` and `resolvePermission` from Task 2.

- [ ] **Step 1: Migrate every stale permission key and add the §9 route gates**

Apply the user-specified keys; keep all existing role and scope checks. Remove TA from both compensation role lists. Resolve the create key by authenticated role and keep Admin unable to create.

- [ ] **Step 2: Run typecheck to identify un-migrated obsolete keys**

Run: `npm run typecheck`

- [ ] **Step 3: Correct all permission-key compilation errors without restoring obsolete keys**

Use only keys exported by `@exam/shared`.

### Task 4: Defaults, Migration, and Documentation

**Files:**
- Modify: `apps/api/prisma/seed.ts`
- Create: `apps/api/prisma/migrations/20260930010000_permission_matrix/migration.sql`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes `DEFAULT_PERMISSIONS` from Task 1.

- [ ] **Step 1: Replace seed's blanket allow loop**

Upsert all role/key rows using whether `DEFAULT_PERMISSIONS[key]` includes the role.

- [ ] **Step 2: Add idempotent SQL data migration**

Insert all 72 rows and use conflict updates to reset existing rows to §9 defaults.

- [ ] **Step 3: Update the project checkpoint**

Record the 18-key vocabulary, universal role-plus-permission route gates, deliberate TA compensation 403, and enforced versus currently unenforced keys.

### Task 5: Verification

**Files:**
- Verify the files changed above.

- [ ] **Step 1: Run focused tests and full API tests**

Run: `npm test -w @exam/api -- permissions.test.ts` and `npm test -w @exam/api`

- [ ] **Step 2: Run static and schema verification**

Run: `npm run typecheck`, `npm run build`, `npm exec -w @exam/api prisma validate`, and ESLint only over changed API TypeScript files.

- [ ] **Step 3: Inspect the final diff and report evidence**

Confirm the requested scope was respected and disclose any unrelated pre-existing lint findings.
