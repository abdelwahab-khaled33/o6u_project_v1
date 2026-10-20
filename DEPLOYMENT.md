# Deploying to Vercel

The platform runs as **two Vercel projects out of this one repo**, plus a hosted
PostgreSQL database:

- **api project** — the Express API as a Node serverless function
  (`apps/api/api/index.ts`), Root Directory `apps/api`.
- **web project** — the Vite SPA as a static build, Root Directory `apps/web`.
  It proxies `/api/*` and `/uploads/*` to the api project through
  `apps/web/vercel.json`, so the browser talks to **one origin**.

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

## 4. Vercel project A — the API

1. <https://vercel.com/new> → import this repo → set:
   - **Root Directory**: `apps/api`
   - **Framework Preset**: Other
   - turn **ON** "Include source files outside of the Root Directory"
     (the function imports `../src/*`)
2. Settings → Environment Variables (Production):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the **pooled** Neon connection string |
   | `JWT_SECRET` | the hex value from step 3 (≥ 32 chars) |
   | `ACCESS_CODE_ENC_KEY` | the base64 value from step 3 |
   | `LAB_IP_RANGES` | `0.0.0.0/0` for now (see note below) |
   | `TRUSTED_PROXY_IPS` | `::1,127.0.0.1` |

   The server has production boot guards: it **refuses to start** if
   `JWT_SECRET` is a placeholder, if `ACCESS_CODE_ENC_KEY` is missing or not
   32 bytes, or if `LAB_IP_RANGES` / `TRUSTED_PROXY_IPS` are empty. Vercel sets
   `NODE_ENV=production` automatically.

   `LAB_IP_RANGES=0.0.0.0/0` keeps the lab restriction satisfied-but-open while
   the platform is hosted publicly. Before a real lab exam, replace it with the
   actual lab subnets (e.g. `10.20.0.0/16`) — the restriction fails closed by
   design.

   `TRUSTED_PROXY_IPS=::1,127.0.0.1` is correct **on Vercel**: the socket the
   function sees is itself, and Vercel injects the client address into
   `X-Forwarded-For` at that socket (clients cannot spoof it there).

3. Deploy, then verify before touching the web project:

   ```
   https://<api-project>.vercel.app/api/v1/health
   ```

   must return `{"status":"ok","database":"connected"}`. `503 degraded` means
   the database URL/network is wrong; anything else means env vars are missing
   (the function log will name the variable).

## 5. Vercel project B — the web app

1. Import the same repo again → **Root Directory**: `apps/web`
   (Framework Preset: Vite is auto-detected). No environment variables needed.
2. **After project A exists**, edit `apps/web/vercel.json` and replace
   `YOUR_API_PROJECT` with project A's hostname (`<api-project>.vercel.app`),
   commit and push — or paste the same rewrite in the dashboard.
3. Deploy and open the site: the welcome page, login, and
   `https://<web-project>.vercel.app/api/v1/health` (proxied) must all respond.

If you skip step 2, every page still renders but all API calls fail with a 404
from the rewrite placeholder — that is the expected failure mode, not a bug.

## 6. Known limitations on Vercel (deliberate, documented)

- **Uploaded question images do not survive.** Uploads land on the serverless
  function's temporary disk, which is wiped on every cold start. The upload
  itself validates and the question still works until the next cold start.
  Follow-up if needed: store image bytes in the database instead of disk.
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
