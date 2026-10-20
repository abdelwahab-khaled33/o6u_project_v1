# Deploying to Vercel

The platform runs as **two Vercel projects out of this one repo**, plus a hosted
PostgreSQL database:

- **api project** — the Express API as a Node serverless function. The entry
  is `src/app.ts`'s default export, declared through the `functions` block in
  `apps/api/vercel.json` (Root Directory `apps/api`). There is deliberately no
  `apps/api/api/index.ts` any more — that earlier entry was removed when the
  `functions` block took over.
- **web project** — the Vite SPA as a static build, Root Directory `apps/web`.
  It proxies `/api/*` to the api project and falls back to `/index.html` for
  client-side routes through `apps/web/vercel.json`, so the browser talks to
  **one origin**. `/uploads/*` is not proxied — see §6.

The single-origin proxy is not cosmetic: the exam device session is an httpOnly
`SameSite=Lax` cookie (`exam_session_token`). If the API lived on a second
origin, that cookie would never be sent on cross-site requests and the exam
runner would break with `SESSION_TOKEN_INVALID` on every answer.

---

## 1. Hosted database (Neon, free tier)

> **Done (2026-10-20).** Provisioned from this machine with the Neon CLI
> (`neon init` + `neon deploy`): project `fancy-sun-35674457`, branch
> `production`. Both connection strings were pulled into the repo-root
> `.env.local` (gitignored) — read them from there, not the dashboard.
> `apps/api/.env` already holds the **pooled** URL for local runs.

1. Sign up at <https://neon.tech> and create a project (pick the region closest
   to the university).
2. From the dashboard, copy **both** connection strings:
   - the **pooled** one (its host ends with `-pooler`) — this is `DATABASE_URL`
   - the **direct** one — used once, for migrations

## 2. Schema and seed (run once, from your machine)

> **Done (2026-10-20).** All 9 migrations applied to the Neon database over the
> direct URL, and the seed ran over the pooled URL. Safe to re-run:
> `migrate deploy` is a no-op when up to date and the seed upserts the admin.

Migrations must go through the **direct** URL (PgBouncer-style poolers cannot
run migrations), the app uses the pooled one:

```powershell
# from the repo root, apps/api/.env does NOT need to exist for this
$env:DATABASE_URL = "<DIRECT connection string>"
npm run db:generate --workspace @exam/api
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

$env:DATABASE_URL = "<POOLED connection string>"
npm run db:seed --workspace @exam/api   # creates the admin account + permission matrix
```

This creates the admin user (`admin`) — change its password after first login.

## 3. Secrets

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"      # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # ACCESS_CODE_ENC_KEY
```

Do not use PowerShell's `RandomNumberGenerator` for the base64 key under Windows
PowerShell 5.1 — it can silently produce 32 zero bytes.

**Push secrets to Vercel unquoted.** The source `.env` files wrap their values
in double quotes; `dotenv` strips those for local runs, but `vercel env add`
stores them literally, and the deployment then sees `"<value>"`. Read the value
out of the file, strip surrounding quotes, and pipe it to `vercel env add` via
stdin — while printing only the value's *shape* (length, whether it starts with
`postgresql://`), never the value itself.

## 4. Vercel project A — the API

1. Create the project against this repo (dashboard at <https://vercel.com/new>,
   or `vercel link` from `apps/api`), then apply the settings — dashboard, or
   `vercel project update o6u-exam-api …`:
   - **Root Directory**: `apps/api`
   - **Framework Preset**: Express (auto-detected)
   - **Install Command**:
     `pwd; if [ ! -f package-lock.json ]; then cd ../..; fi; pwd; npm ci --no-audit --no-fund`
     — the lockfile lives at the repo root, so the install must climb out of
     the Root Directory first (the command starts inside it).
   - **Build Command**: `npm run build && node scripts/vendor-shared.mjs` — the
     second half is **load-bearing**: it compiles `@exam/shared` into
     `apps/api/node_modules/@exam/shared/`, which Node resolves before the root
     workspace symlink. Without it every deploy dies with
     `Cannot find module '@exam/shared'`. (The `includeFiles:
     node_modules/@exam/shared/**` entry in `apps/api/vercel.json` is
     belt-and-braces behind the same idea.)
   - turn **ON** "Include source files outside of the Root Directory"
     (the build reads `../../packages/shared` and `../../tsconfig.base.json`)
2. Settings → Environment Variables (Production):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the **pooled** Neon connection string |
   | `JWT_SECRET` | the hex value from step 3 (≥ 32 chars) |
   | `ACCESS_CODE_ENC_KEY` | the base64 value from step 3 |
   | `LAB_IP_RANGES` | `0.0.0.0/0` for now (see note below) |
   | `TRUSTED_PROXY_IPS` | `0.0.0.0/0` for now (see note below) |

   The server has production boot guards: it **refuses to start** if
   `JWT_SECRET` is a placeholder, if `ACCESS_CODE_ENC_KEY` is missing or not
   32 bytes, or if `LAB_IP_RANGES` / `TRUSTED_PROXY_IPS` are empty. Vercel sets
   `NODE_ENV=production` automatically.

   `LAB_IP_RANGES=0.0.0.0/0` and `TRUSTED_PROXY_IPS=0.0.0.0/0` are the
   approved **temporary demo config** currently deployed: the lab restriction
   stays satisfied-but-open while the platform is hosted publicly, and only
   Vercel's own proxy can reach the function anyway — `clientIp` reads the
   **rightmost** `X-Forwarded-For` hop (the one that proxy appended), so a
   client-supplied prefix cannot win. Before a real lab exam, replace
   `LAB_IP_RANGES` with the actual lab subnets (e.g. `10.20.0.0/16`) — the
   restriction fails closed by design.

3. Deploy **from the repo root** — a deploy launched from inside `apps/api`
   fails with `…\apps\api\apps/api does not exist` — then verify before
   touching the web project:

   ```powershell
   vercel deploy --prod --project o6u-exam-api --scope abdelwahab-khaled33s-projects --yes
   ```

   `https://o6u-exam-api.vercel.app/api/v1/health`

   must return `{"status":"ok","database":"connected"}`. `503 degraded` means
   the database URL/network is wrong; anything else means env vars are missing
   (the function log will name the variable).

   Environment-variable changes only take effect on a **new** deployment —
   redeploy after changing one.

## 5. Vercel project B — the web app

1. Create the project for the same repo with **Root Directory** `apps/web`
   (Framework Preset: Vite, auto-detected) and apply the same adaptive Install
   Command as project A plus **Build Command** `npm run build` — via the
   dashboard or:

   ```powershell
   vercel project update o6u-exam-web --root-directory apps/web --framework vite `
     --install-command "pwd; if [ ! -f package-lock.json ]; then cd ../..; fi; pwd; npm ci --no-audit --no-fund" `
     --build-command "npm run build" --scope abdelwahab-khaled33s-projects --yes
   ```

   No environment variables are needed — the client calls `/api/v1/…`
   relatively.

2. `apps/web/vercel.json` is committed with the real rewrites: `/api/*` →
   `https://o6u-exam-api.vercel.app/api/*`, then `/(.*)` → `/index.html`
   (SPA fallback; Vercel checks the filesystem first, so static assets still
   win). If the api project ever gets a different hostname, that is the one
   line to edit.

3. Deploy from the repo root, same as project A:

   ```powershell
   vercel deploy --prod --project o6u-exam-web --scope abdelwahab-khaled33s-projects --yes
   ```

4. Verify all three, not just the first: the landing page renders, a deep link
   such as `/login` returns the SPA (not a 404), and
   `https://o6u-exam-web.vercel.app/api/v1/health` (proxied — same origin as
   the page) returns the same `database":"connected"` JSON as project A.

## 6. Known limitations on Vercel (deliberate, documented)

- **Uploaded question images cannot be written at all on Vercel.**
  `POST /question-bank/images` validates the bytes (magic-number sniff) and
  then `writeFileSync`s them into `uploads/images/` — but that path sits on the
  serverless function's read-only filesystem, so the request fails with a 500.
  The boot-time `mkdirSync` is guarded (it used to crash the whole function);
  the request-time write cannot be fixed the same way, because there is nothing
  writable to write to. Text-only questions are unaffected, and the web project
  does not proxy `/uploads/*`. Follow-up if needed: store image bytes in the
  database instead of disk.
- **The auto-submit sweep does not run by itself.** `npm run
  exams:auto-submit-sweep` is a local script; on Vercel, abandoned attempts are
  finalized lazily when the student next touches the exam. If you need the
  sweep, add a Vercel Cron Job calling `POST /api/v1/admin/exams/auto-submit-sweep`
  with an admin token (needs a small auth change first — do not expose it
  unauthenticated).
- **Free-tier database compute pauses when idle**, so the first request after a
  few idle minutes can take a few seconds. `{"status":"degraded"}` in the health
  check usually means the compute is still waking up.
- **Preview deployments**: Vercel env vars default to Production only. Either
  scope them to all environments or ignore preview URLs for the API.
