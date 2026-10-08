# React 19 + Tailwind + O6U Brand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `apps/web` to React 19 + Tailwind v4 with O6U branding, keeping all gates green.

**Architecture:** Toolchain bump first, then Tailwind entry + theme, then brand assets, then UI kit, then shell/Login, then page class migration, then full verification. Pages keep logic; only styling/shell change.

**Tech Stack:** React 19, Vite 8, `@vitejs/plugin-react` v5-range, `react-router-dom` v7 latest, Tailwind v4 (`tailwindcss` + `@tailwindcss/vite`), TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-react19-tailwind-o6u-design.md`

## Global Constraints

- Brand palette stays: `#455B8A` / `#F2842F` / `#FFFFFF`.
- UI language stays English.
- `apps/api` and `packages/shared` are untouched.
- Gates stay green: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test -w @exam/web`.
- All new files live inside the repo (`apps/web/...`, `docs/...`); no files outside the project folder.
- Official logo is a local copy in `apps/web/public/`; no hotlinking at runtime.

## Review Focus

- Missing `public/o6u-logo.png` must fall back to inline SVG, never a broken image — pinned in Task 3.
- A legacy `.ui-*` / `.app-*` class left unconverted renders unstyled — pinned by class audit in Task 6.
- Vite 8 proxy drift (`/api` -> `http://localhost:4000`) breaks dev only — pinned by config check in Task 1.
- React 19 types drift (`@types/react` 18 left behind) breaks `tsc` — pinned in Task 1.
- Favicon/title left as generic "Exam Platform" — pinned in Task 2.

---

### Task 1: Toolchain upgrade (React 19 + Vite 8 + Tailwind deps)

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/vite.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: React 19 + Tailwind-ready build for all later tasks; `vite.config.ts` keeps `/api` proxy and adds `tailwindcss()` plugin.

- [ ] **Step 1: Record the failing state**

Run: `npm run typecheck --workspace @exam/web` and `npm test --workspace @exam/web`
Expected: PASS on current tree (baseline before bump; versions still 18/Vite 7).

- [ ] **Step 2: Bump dependencies in `apps/web/package.json`**

Set floors (resolve exact latest at run time with `npm view`): `react ^19`, `react-dom ^19`, `@types/react ^19`, `@types/react-dom ^19`, `vite ^8`, `@vitejs/plugin-react` latest v5-range, `react-router-dom` latest `^7`, add `tailwindcss` + `@tailwindcss/vite`. Keep `vitest ^5` unless Vite 8 peer requires a minor bump.

- [ ] **Step 3: Update `apps/web/vite.config.ts`**

Add `tailwindcss()` plugin beside `react()`; keep `server.port 5173` and `/api` proxy to `http://localhost:4000` byte-identical.

- [ ] **Step 4: Install and verify**

Run: `npm install` (repo root) then `npm run typecheck --workspace @exam/web`
Expected: PASS. If Vite 8 breaks install/config, fallback: revert `vite` + plugin lines only (approach A), keep React 19 + Tailwind.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/vite.config.ts package-lock.json
git commit -m "chore(web): upgrade to React 19 + Vite 8 + Tailwind deps"
```

### Task 2: Tailwind entry, theme, document head

**Files:**
- Modify: `apps/web/src/index.css`
- Modify: `apps/web/index.html`

**Interfaces:**
- Consumes: Task 1 (Tailwind plugin present).
- Produces: `@theme` brand tokens + `index.html` title/favicon consumed by Tasks 4-6.

- [ ] **Step 1: Write the failing check**

Run: `npm run build --workspace @exam/web`
Expected: PASS but output CSS has no Tailwind utilities (entry not yet converted).

- [ ] **Step 2: Rewrite `apps/web/src/index.css`**

Content: `@import "tailwindcss";` + `@theme { --color-primary: #455B8A; --color-primary-dark: #304269; --color-primary-ink: #232f4d; --color-accent: #F2842F; --color-accent-dark: #c9661a; }` + minimal base (font stack, focus-visible ring). Delete all legacy `.app-*` / `.ui-*` / `.runner-*` / `.results-*` rules in the same edit.

- [ ] **Step 3: Update `apps/web/index.html`**

Title becomes `O6U Exam Platform`; add favicon link to `/o6u-favicon.ico` (added in Task 3). Test: file contains `O6U Exam Platform` and `o6u-favicon`.

- [ ] **Step 4: Verify**

Run: `npm run build --workspace @exam/web` and `npm run typecheck --workspace @exam/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/index.css apps/web/index.html
git commit -m "style(web): Tailwind entry with O6U brand theme"
```

### Task 3: O6U brand assets (`public/` + `O6ULogo`)

**Files:**
- Create: `apps/web/public/o6u-logo.png`
- Create: `apps/web/public/o6u-favicon.ico`
- Create: `apps/web/src/components/brand/O6ULogo.tsx`
- Test: `apps/web/src/components/brand/O6ULogo.test.tsx`

**Interfaces:**
- Consumes: nothing (independent of Tasks 1-2).
- Produces: `O6ULogo({ size?: 'sm' | 'md' | 'lg' })` used by Tasks 5-6.

- [ ] **Step 1: Write the failing test**

```tsx
it('falls back to SVG when image is missing', () => {
  render(<O6ULogo imageMissing />);
  expect(screen.getByLabelText(/October 6 University/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @exam/web -- O6ULogo`
Expected: FAIL with "O6ULogo not defined".

- [ ] **Step 3: Add assets + implement `O6ULogo` in `apps/web/src/components/brand/O6ULogo.tsx`**

Download `https://o6u.edu.eg/images/logo.png` to `apps/web/public/o6u-logo.png` (curl, no hotlink); derive `o6u-favicon.ico` from the same mark. Component renders `<img src="/o6u-logo.png" alt="October 6 University">` + wordmark, with `imageMissing` (or `onError`) rendering an inline SVG `O6U` monogram instead. Props: `size?: 'sm' | 'md' | 'lg'` mapping to fixed heights.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace @exam/web -- O6ULogo` then `npm run typecheck --workspace @exam/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/o6u-logo.png apps/web/public/o6u-favicon.ico apps/web/src/components/brand/
git commit -m "feat(web): add O6U brand assets and logo component"
```

### Task 4: UI kit conversion (same props, Tailwind classes)

**Files:**
- Modify: `apps/web/src/components/ui/Button.tsx`
- Modify: `apps/web/src/components/ui/Card.tsx`
- Modify: `apps/web/src/components/ui/Field.tsx`
- Modify: `apps/web/src/components/ui/Table.tsx`
- Modify: `apps/web/src/components/ui/Alert.tsx`
- Modify: `apps/web/src/components/ui/Spinner.tsx`

**Interfaces:**
- Consumes: Task 2 theme tokens.
- Produces: unchanged component APIs (`variant` names identical) with Tailwind styling for Tasks 5-6.

- [ ] **Step 1: Write the failing check**

Run: `npm test --workspace @exam/web`
Expected: PASS (baseline; styling change has no logic test yet — conversion correctness is proven by typecheck + visual pass).

- [ ] **Step 2: Reimplement the six components with Tailwind**

Keep every prop/API identical (`Button variant primary | secondary | danger | text | accent`, `Field/Input/Select/Textarea`, `Table`, `Alert`, `Card`, `Spinner label`). Map: primary -> `bg-[#455B8A]`, accent rail/border -> `bg-[#F2842F]` / `border-t-[#F2842F]`, focus ring accent. Min touch target 44px preserved.

- [ ] **Step 3: Verify**

Run: `npm run typecheck --workspace @exam/web` and `npm test --workspace @exam/web` and `npm run lint --workspace @exam/web`
Expected: PASS all three.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/
git commit -m "style(web): convert UI kit to Tailwind, same APIs"
```

### Task 5: Shell + Login with O6U brand

**Files:**
- Modify: `apps/web/src/components/Layout.tsx`
- Modify: `apps/web/src/pages/LoginPage.tsx`

**Interfaces:**
- Consumes: Tasks 3 (`O6ULogo`), 4 (UI kit).
- Produces: branded shell + login consumed visually by Task 7 verification.

- [ ] **Step 1: Convert `Layout.tsx`**

Sidebar gradient (`#304269` -> `#232f4d`), orange active rail, topbar, user footer unchanged in structure; brand block uses `O6ULogo size="sm"` + workspace label; footer adds one muted line: `O6U · Hotline 16704`. Nav items, icons, `RequireRole` behavior untouched.

- [ ] **Step 2: Convert `LoginPage.tsx`**

Card uses `O6ULogo size="md"`, heading `O6U Exam Platform`, subtitle unchanged, plus facts strip: `First private university in Egypt (Decree 243/1996) · 13 faculties · 6th of October City, Giza`. Form logic (`login`, error, submitting) untouched.

- [ ] **Step 3: Verify**

Run: `npm run typecheck --workspace @exam/web` and `npm run lint --workspace @exam/web` and `npm test --workspace @exam/web`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/Layout.tsx apps/web/src/pages/LoginPage.tsx
git commit -m "feat(web): Tailwind shell and login with O6U brand"
```

### Task 6: Page className migration (logic untouched)

**Files:**
- Modify: className strings across `apps/web/src/pages/**` (admin, doctor, ta, student, results, compensation, monitoring) wherever legacy `.page`, `.filter-bar`, `.row-actions`, `.ui-table-wrap`, `.status--*`, `.runner-*`, `.results-*`, `.comp-warn` classes remain.

**Interfaces:**
- Consumes: Tasks 2, 4.
- Produces: zero legacy class references.

- [ ] **Step 1: Audit legacy classes**

Run: `grep -rn "ui-button\|ui-card\|ui-table\|app-shell\|app-sidebar\|filter-bar\|row-actions\|runner-\|results-\|status--\|comp-warn\|login-card" apps/web/src --include="*.tsx" | wc -l`
Expected: count > 0 (the failing state).

- [ ] **Step 2: Convert each occurrence to Tailwind utilities**

Rule: logic/JSX structure unchanged; only `className` values change. Status pills keep color semantics (pending amber, approved/submitted green, rejected red, in-progress amber).

- [ ] **Step 3: Verify zero legacy references**

Re-run the grep above.
Expected: `0` (plus `O6ULogo` untouched). Then `npm run typecheck`, `lint`, `test` for `@exam/web` PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/
git commit -m "style(web): migrate pages from legacy classes to Tailwind"
```

### Task 7: Full verification (gates + browser)

**Files:** none (verification only).

- [ ] **Step 1: Run all gates**

Run: `npm run typecheck` then `npm run lint` then `npm run build` (repo root) then `npm test -w @exam/web`
Expected: exit 0 on all four; web tests count unchanged-or-grown (baseline 390).

- [ ] **Step 2: Browser pass (dev servers)**

Run `npm run dev:api` + `npx vite --port 5177` in `apps/web`; visit Login (logo, facts, title `O6U Exam Platform`), admin/doctor/ta/student shells (sidebar logo, active rail, footer contact), one table page + one form page. Zero console errors.
