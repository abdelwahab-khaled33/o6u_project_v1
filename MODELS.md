# AI Model Usage Plan — University Exam Platform

**Budget target:** ~$25/month (aspirational planning figure — a single large task can cost several dollars on its own; the real lever is task splitting + context discipline, see below) · **Access:** API pay-as-you-go · **Experience:** Junior developer

## Strategy

Never use a top model for everything. Escalate based on task complexity. Keep context small, use cache-friendly patterns, and review structure of big file reads.

**Who this file is for:** the human orchestrator (model choice + budget planning). Coding agents should NOT read this file on implementation tasks — `AGENTS.md` is their single entry point, and its "Cost & Context Discipline" section tells them what to read. Re-read this file only when switching models, planning budget, or deciding what to outsource next.

## Tiers

| Tier | Models | Price (Input/Output per 1M) | Use for |
|---|---|---|---|
| Cheap (daily driver) | GPT-5.6 Luna, Gemini Flash, DeepSeek, Claude Haiku 4.5 | ~$0.2–$1 / $1.2–$5 | Repetitive code, CRUD, UI, migrations, explanation |
| Mid (workhorse) | Claude Sonnet 5, GPT-5.6 Terra | ~$2 / $10 | Core project logic, complex logic, architecture |
| Top (sparingly) | Claude Opus 5, GPT-5.6 Sol | ~$5 / $25 | Stubborn bugs, security review, overall design review |

## Per-Phase Model Assignment

| # | Phase | Recommended model | Why |
|---|---|---|---|
| 1 | Scaffolding monorepo (Node+TS+React+Prisma+Docker) | GPT-5.6 Luna / Gemini Flash | Templated boilerplate |
| 2 | Prisma models + DB schema (spec §7) | Claude Sonnet 5 / Terra | Decisions affect whole project |
| 3 | Auth (JWT + roles + bcrypt) | Sonnet 5 / Terra | Security — not a place to save |
| 4 | Permission system (matrix + overrides) | Sonnet 5 / Terra | Cross-table logic |
| 5 | Excel import with dry-run validation (§2.2) | Sonnet 5 / Terra | Most edge cases |
| 6 | Question banks (Doctor private / TA shared) | Haiku / Luna | Direct CRUD + ownership |
| 7 | Exam generation engine (unique sample, difficulty mix, shuffle) | Sonnet 5 / Terra | Critical per-student sampling |
| 8 | Approval workflow (state machine) | Sonnet 5 / Terra | Many rules (FR-7..11) |
| 9 | Exam-taking engine (wall-clock timer, heartbeat, resume, auto-submit) | Sonnet 5 / Terra | FR-31..33 — worst if broken |
| 10 | SEB integration (hash validation middleware) | Sonnet 5 | Only open design item |
| 11 | React UI for 4 roles | Luna / Gemini Flash | Fast component bootstrap |
| 12 | Bug fixing / debugging | Opus 5 / Sol (rare) + Sonnet (regular) | Best ROI from top model |
| 13 | Unit/integration tests + k6 (5000-scenario) | Sonnet 5 / Terra | Precise test logic |
| 14 | Final security review + key decisions | Opus 5 / Sol | A couple of times in whole project |

## Budget Allocation ($25)

| Item | Allocation |
|---|---|
| Daily driving (Luna/Flash/Haiku) ~70% of usage | ~$6–10 |
| Workhorse (Sonnet/Terra) ~25% | ~$12–15 |
| Frontier (Opus/Sol) — few times | ~$3–4 |

**Reality check:** the Exams phase alone consumed several dollars in one long session — building a project like this end-to-end in long agent sessions will realistically exceed $25/month. Treat the table as a planning split, not a cap: cost is driven primarily by context size × session length, not model price. Split the remaining phases into separate fresh sessions — Results/Export, Grade Compensation, React UI, security review, k6 — each is its own session.

## Golden Rules (save 50–70%)

1. **Enable caching** — cache hits are heavily discounted (DeepSeek cache-hit ~$0.07/1M).
2. **Keep context small** — don't dump whole files into cheap models; pass only the relevant part (`file:line`).
3. **Use Batch API** when the provider supports it (up to 50% off) — good for bulk test-file generation.
4. **Maintain an AGENTS.md** so every model starts with project constants (brand colors, stack, business rules like "students can't change passwords") — fewer reworks = automatic savings.
5. **Pick the model manually per session** for expensive work; don't rely on auto for everything.
6. **k6 load-test scripts** → write with Sonnet/Terra, analyze long reports with Gemini Flash (cheap).
7. **One phase = one fresh session** — split big phases (Results/Export ≠ Grade Compensation ≠ UI ≠ security review). A fresh small session starts from cached prefixes; one ever-growing session re-reads everything each turn.

## Dependency Security Notes

- Root `package.json` has `overrides` forcing `deepmerge-ts@8.0.2` and `uuid@^11.1.1` (both patched against CVEs).
- `npm ls` will report these as `invalid` — expected; Prisma CLI (validate/generate/migrate) confirmed working.
- Excel parsing uses `exceljs` (actively maintained). Do NOT switch to `xlsx` (unmaintained on npm, high-severity CVEs, no fix).
- Prisma config lives in `apps/api/prisma.config.ts` (Prisma 7-style) — `prisma` key in package.json is gone.

## Project Constants (remember in every session)

- Stack: Node.js + TypeScript (backend), React (frontend), PostgreSQL + Prisma ORM
- Hosting: self-hosted on-prem (no cloud)
- Scale: ~5,000 concurrent exam-sessions stress scenario
- UI language: English · Brand: Primary Blue `#455B8A` · Accent Orange `#F2842F` · White `#FFFFFF`
- Roles: Admin, Doctor, TA, Student
- v1 question types: MCQ + True/False only · Difficulty: Easy/Medium/Hard (fixed mix per exam)
- Students CANNOT change passwords; Doctors/TAs/Admin can.
- Doctor-authored exams require Admin approval; TA quizzes do not.
- Exam can only be edited before its Start Time; immutable once in progress.
- After submission, student never sees grade/answers again.