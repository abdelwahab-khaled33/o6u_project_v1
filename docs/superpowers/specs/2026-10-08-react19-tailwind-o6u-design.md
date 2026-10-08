# React 19 + Tailwind + O6U Brand — Design (2026-10-08)

## 1. Intent (agreed)

- Upgrade `apps/web` from React 18 to React 19.
- Replace the hand-written `index.css` system with Tailwind (full replacement, not side-by-side).
- Add October 6 University branding: official logo + university facts in Login and app shell.
- User approvals: full Tailwind replacement, comprehensive toolchain upgrade, official logo.

## 2. Constraints (non-negotiable)

- Brand palette stays: `#455B8A` (primary) / `#F2842F` (accent) / `#FFFFFF` (surface).
- UI language stays English (repo business rule).
- `apps/api` and `packages/shared` are untouched.
- Gates stay green: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test -w @exam/web`.
- No new backend routes. No behavior change in exam logic; this is shell + styling + brand only.

## 3. Current state (measured, not assumed)

- `apps/web/package.json`: `react ^18.3.1`, `react-dom ^18.3.1`, `@types/react ^18.3.3`, `@types/react-dom ^18.3.0`, `react-router-dom ^7.18.4`, `vite ^7.1.0`, `@vitejs/plugin-react ^4.3.1`, `vitest ^5.0.2`.
- No `bootstrap` / `tailwind` dependency and no such import in `apps/web` (grep clean). Styling is `src/index.css` (~259 lines, CSS vars + `.app-shell`, `.ui-*`, `.runner-*`, `.results-*` classes).
- Entry: `src/main.tsx` uses `createRoot` + `StrictMode` + `BrowserRouter` — already React 19 compatible.
- Shell: `src/components/Layout.tsx` sidebar + topbar with inline SVG icons; brand mark is a letter `E`.
- Login: `src/pages/LoginPage.tsx` renders `.login-page > .login-card`.
- UI kit: `src/components/ui/` has `Alert, Button, Card, Field, Spinner, Table` (no `Select.tsx`; `Select` is exported from `Field.tsx`).

## 4. Approaches considered

- **A (safe):** React 19 only, keep Vite 7, add Tailwind v4. Lowest risk.
- **B (chosen):** Comprehensive — React 19 + Vite 8 + latest `@vitejs/plugin-react` + latest `react-router-dom` v7 + Tailwind v4 via `@tailwindcss/vite`. Higher risk (Vite 8 config/vitest drift), accepted by user with fallback to A if Vite 8 breaks the proxy or tests.

## 5. Design

### 5.1 Toolchain (architecture)

- `apps/web/package.json`: bump `react`, `react-dom` to `^19`, `@types/react`, `@types/react-dom` to `^19`, `vite` to `^8`, `@vitejs/plugin-react` to latest v5-range compatible, `react-router-dom` to latest `^7`, add `tailwindcss` + `@tailwindcss/vite`. Keep `vitest ^5` unless Vite 8 forces a compatible minor bump; prefer no vitest major change.
- `apps/web/vite.config.ts`: register `tailwindcss()` plugin beside `react()`; keep `/api` proxy to `http://localhost:4000`.
- `src/index.css`: becomes the Tailwind entry (`@import "tailwindcss";`) plus an `@theme` block mapping brand tokens (`--color-primary: #455B8A` etc.), plus minimal base rules (font, focus ring). All `.app-*` / `.ui-*` / `.runner-*` / `.results-*` rules are deleted and each call site is converted to utilities.
- `src/main.tsx`: unchanged (already correct for React 19).

### 5.2 Component conversion

- `Layout.tsx`: sidebar gradient + active rail + topbar rebuilt with Tailwind; nav items and inline SVG icons unchanged in shape; brand block gains the O6U logo image + text; sidebar footer gains a one-line university contact line.
- `LoginPage.tsx`: card rebuilt with Tailwind; adds O6U logo, university name lines, and a facts strip (first private university in Egypt, Decree 243/1996, 13 faculties, Hotline 16704).
- `components/ui/*`: `Button, Card, Field (Input/Select/Textarea), Table, Alert, Spinner` reimplemented with Tailwind classes keeping the same props/API so pages need no logic edits. `variant` names unchanged (`primary | secondary | danger | text | accent`).
- Page files keep their logic; only `className` strings change from legacy classes to utilities. No new routes.

### 5.3 O6U brand assets and data (sourced 2026-10-08)

- Source site: `https://o6u.edu.eg/` — logo at `images/logo.png`, favicon at `Images/o6u logoicon.ico`.
- Local copies (no hotlink): `apps/web/public/o6u-logo.png` (downloaded from the URL above), favicon wired in `apps/web/index.html` (title becomes `O6U Exam Platform`).
- New component `src/components/brand/O6ULogo.tsx` rendering the PNG with university wordmark text and a pure-SVG fallback mark if the image is missing.
- Facts rendered (English, from `o6u.edu.eg`): first private university in Egypt (Decree 243/1996); member of Association of Arab Universities and Association of African Universities; 13 faculties (Medicine, Pharmacy, Dentistry, Physical Therapy, Applied Medical/Health Sciences, Engineering, Information Systems & Computer Science, Applied Arts, Mass Media, Education, Economics & Management, Tourism & Hotels, Languages & Translation; plus Nursing); address 6th of October City, Giza; phones (+202) 383 55 275/276; hotline 16704; `adminoct@o6u.edu.eg`.

### 5.4 Data flow

- No data-flow change. Brand component is static (props: `size` only). No fetch of external assets at runtime.

### 5.5 Error handling

- Missing logo file: `O6ULogo` falls back to inline SVG monogram `O6U`, never a broken `<img>`.
- Vite 8 incompatibility (proxy, plugin, vitest): fallback is approach A (revert `vite` + plugin lines only, keep React 19 + Tailwind).
- Any page whose classes are missed in conversion renders unstyled but functional; verification pass covers every route per role.

### 5.6 Testing / verification

- `npm run typecheck`, `npm run lint`, `npm run build` exit 0.
- `npm test -w @exam/web` all green (no test logic change expected; only class strings).
- Browser pass: Login (logo, facts, favicon/title), admin/doctor/ta/student shells (sidebar logo, active rail, footer contact), one representative table + form page.
- Logo files verified present in `public/` and served by dev server.

## 6. Files touched (only `apps/web`)

- `package.json`, `vite.config.ts`, `index.html`, `src/index.css`, `src/components/Layout.tsx`, `src/pages/LoginPage.tsx`, `src/components/ui/*`, new `src/components/brand/O6ULogo.tsx`, new `public/o6u-logo.png` (+ favicon), plus `className` edits in `src/pages/**` where legacy classes are used.

## 7. Explicitly out of scope

- No RTL/Arabic UI (rule: UI in English).
- No `apps/api` or `packages/shared` change. No migration. No new npm workspace.
- No `prettier --write` repo-wide (config is aspirational; hand style rules).
