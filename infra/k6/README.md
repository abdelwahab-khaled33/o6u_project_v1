# k6 load test — student exam path

One suite, one scenario: **login → exam list → start → answer/flag/heartbeat → submit**, the
path a student walks to sit an exam. It is the only k6 suite in the project; spec §11.3 puts
scripts in `/infra/k6` and there was no pre-existing one to maintain.

Deployment sizing derived from these runs lives in [`../DEPLOYMENT.md`](../DEPLOYMENT.md).
The measurements the thresholds came from live in
[`results/README.md`](./results/README.md).

---

## What it is actually measuring, and what it is not

The scenario is deliberately split so the **login storm** (spec §11.2: 5,000 password hashes
in 1–2 minutes) and the **start storm** stay separable. They are different bottlenecks and
they fail for different reasons — a blended p(95) hides precisely the thing this test exists
to find, so every step gets its own `Trend`.

Two load shapes in this project are kept apart on purpose:

- **Taking an exam (measured here).** Attempts and snapshots are pre-generated at approval
  time (spec §4.3), so `start` is an update plus a read of already-written rows.
- **Exam creation (not measured here).** `generateStudentExamsForExam` runs inside the
  create transaction under `timeout: 60000` and writes every snapshot row for the cohort in
  one transaction. That is a batch job wearing an HTTP request's clothes.
  `seed/seed.ps1` times it instead — a single timed event is the only honest way to see it,
  and it is not a sustained rate.

**Not exercised: SEB.** `SEB_KEYS` is empty for every load run, so `middleware/seb.ts`'s
hash path never ran. Spec §6.2 real-machine verification is still deferred, and these numbers
say nothing about SEB overhead.

---

## Layout

| File | Role |
|---|---|
| `student-exam-path.js` | The scenario. `per-vu-iterations`, 1 iteration per VU — a VU is a student, and a student sits one exam once. Staggers arrivals over `RAMP_SECONDS`. |
| `list-only.diagnostic.js` | Isolation probe: fires `GET /student/exams` and **nothing else**, with pre-minted tokens, so no login is on the measured path. This is how `exam_list` was cleared of suspicion. |
| `lib/config.js` | `__ENV`-driven config, fixture loading, per-student lab address, session-cookie parsing. |
| `run.ps1` | Runs one k6 leg and archives the summary. Includes the window pre-flight. |
| `run-cluster.ps1` | N API processes × N k6 legs, disjoint student windows. |
| `start-api.ps1` | Starts 1..N load-test API instances on 4001+ with the lab/proxy env and a bounded Prisma pool. |
| `seed/seed.ps1`, `seed/01-fixture.sql` | Idempotent cohort seed; creates and approves the exam through the **real API**. |
| `seed/reset-window.ps1` | Re-arms a consumed student window. |
| `results/` | Archived JSON, console transcripts and stderr. The threshold source. |

---

## Running it

```powershell
# one-time
powershell -ExecutionPolicy Bypass -File infra\k6\seed\seed.ps1 -Students 3200
powershell -ExecutionPolicy Bypass -File infra\k6\start-api.ps1 -Instances 4

# a single leg against one API process
powershell -ExecutionPolicy Bypass -File infra\k6\run.ps1 -Vus 100 -ExamSeconds 60 -Label check

# the real shape: one process and one k6 leg per 100 students
powershell -ExecutionPolicy Bypass -File infra\k6\run-cluster.ps1 `
    -Processes 4 -VusPerProcess 100 -StudentOffset 0 -ExamSeconds 60 -Label cap-4proc
```

A **non-zero exit code from `run-cluster.ps1` means a threshold failed, not that the run
errored.** The archived JSON in `results/cluster/` is still the measurement.

Load-test API instances are started **separately from the dev server** on ports 4001+, with
their own `LAB_IP_RANGES` / `TRUSTED_PROXY_IPS` / `connection_limit`. `apps/api/.env` and the
dev server on 4000 are never touched.

---

## Five things that will waste your time if you do not know them

### 1. Every student may sit the exam only once

This is the product, not a harness quirk:

- an attempt that is still `in_progress` answers `409 SESSION_ACTIVE_ELSEWHERE` — it holds
  the `session_ip` and `session_token` of whoever started it;
- an attempt that is `submitted` answers `409` "already submitted".

In an archived summary **both are indistinguishable from a capacity failure**: every check on
that leg fails while the other legs pass, and the numbers get filed as a result. This
happened — a 4-leg run reported `start failure rate: 1.0000` on one leg, and the cause was
a window an earlier multi-iteration run had already walked over, found only by reading
`started_at` out of the database.

So a window is consumed one-shot, and `-StudentOffset` slides a run through **one** seeded
cohort instead of re-seeding between steps. `run.ps1` now pre-flights the window against the
database and refuses in ~2 seconds, naming the exact students:

```
Offset 726 with 100 VUs seats students lt_stu_00727 .. lt_stu_00826, and those attempts are
already consumed: submitted=100.
```

To deliberately re-run one:

```powershell
powershell -ExecutionPolicy Bypass -File infra\k6\seed\reset-window.ps1 -StudentOffset 726 -Vus 100
```

Add `-DryRun` to see what it would touch. It deletes that slice's attempts and snapshots
through the real FK order (`GradeAdjustment` → `StudentExamQuestion` → `StudentExam`), so the
students genuinely have never sat the exam — which the product's *release* route
deliberately does not do, because it leaves the attempt, its start time and its deadline
alone.

### 2. The student index is the global iteration counter

`studentExamPath()` uses `exec.scenario.iterationInTest`, so **each iteration consumes a new
student from the cohort**. That is the right model for a wave of students arriving, but it
means:

- a run with `iterations: 1` seats exactly `VUS` students starting at `-StudentOffset`;
- a run with more iterations per VU walks **far past** its declared window and will consume
  students a later run believes are free.

`labIpFor()` adds the same offset, so a student's simulated lab address is stable across
runs — which is what keeps `session_ip` matching on every later request.

### 3. `RAMP_SECONDS` is not a cosmetic knob — it decides what you are measuring

`per-vu-iterations` starts every VU at t=0, so VU *i* sleeps `i/VUS * RAMP_SECONDS` before its
first request. `RAMP_SECONDS` used to feed only `maxDuration` and ramped nothing, so **every run
archived before the fix was a thundering herd** and its latencies were mostly queueing behind
bcrypt. One process, 100 VUs, no server change at all:

| | `RAMP_SECONDS=0` | `RAMP_SECONDS=60` |
|---|---|---|
| `login` p(95) | 8,236 ms | **64 ms** |
| `exam_list` p(95) | 7,383 ms | **6.8 ms** |
| `submit` p(95) | 272 ms | **14 ms** |

`RAMP_SECONDS=0` is still legitimate — it is how the connection-admission ceiling is measured
(~270 concurrent connections per process, then the kernel refuses) — but it is not a production
shape, and **latency budgets derived from it are budgets for queueing, not for the server.**
Set it to roughly the real cohort window (spec 11.2: 1–2 minutes).

To attribute a step's latency to the server rather than to the login storm, run the isolation
probe, which never logs in at all:

```powershell
powershell -ExecutionPolicy Bypass -File infra\k6\start-api.ps1 -Instances 1
node infra\k6\mint-tokens.mjs 3200          # writes %TEMP%\lt-tokens.json, prints a verify command
& "$env:USERPROFILE\k6\k6-v2.3.0-windows-amd64\k6.exe" run --quiet `
    -e VUS=3000 -e RAMP_MS=30000 -e FIXTURE="$PWD\infra\k6\seed\fixture.json" `
    -e "TOKENS=$env:TEMP\lt-tokens.json" `
    -e API_BASE=http://localhost:4001/api/v1 `
    .\infra\k6\list-only.diagnostic.js
```

`RAMP_MS` selects the arrival shape: `0` = every VU at t=0 (measures admission), `>0` = spread
(measures whether the process can *serve* that many students, which is the question capacity
planning needs answered). `mint-tokens.mjs` signs them with the app's own `JWT_SECRET` instead of
logging in, because 3,000 sequential logins would burn ~3 minutes of bcrypt before the first
measured request; run the `verify one` command it prints before believing any number.

### 4. A failed run is not a result until you have re-run it

This box intermittently stalls for a few hundred milliseconds, and when it does it hits whichever
requests happen to be in flight — in different runs it hit `submit`, then `submit` + `answer`,
then the early read path. Three of thirteen reference-shape runs were blown out this way, each
one differently. Full evidence in
[`results/README.md`](results/README.md#the-noise-floor-on-this-machine).

So a single breached budget on this machine is **not** a finding. Re-arm the window and re-run:

```powershell
powershell -ExecutionPolicy Bypass -File infra\k6\seed\reset-window.ps1 -StudentOffset <off> -Vus <n>
powershell -ExecutionPolicy Bypass -File infra\k6\run.ps1 -Vus <n> -StudentOffset <off> -ExamSeconds 60 -RampSeconds 10 -Label recheck
```

Breach the same budget twice in a row on a re-armed window and it is a result. Breach it once
and it is the noise floor.

**And do not touch the machine during a run.** This is not a warning in the abstract: running
two `pg_stat` catalog queries from psql while a leg was in flight is what disqualified one of
those three runs. `Get-NetTCPConnection`, a `git status`, even a file write is enough. Start the
run, then stop working until it exits.

The two `verify-*` runs in Table B are the clean comparison: `verify-100` exits 0 with
`exam_list` at a **117.1 ms max** against a 25 ms budget — which is exactly why the budgets are
set on p(95) and not on the max. `verify-200` exits 99 and its stderr names the six budgets it
crossed. `verify-cluster` (4 processes × 100 VUs) exits 0 on all four legs.

### 5. Never pipe a script that starts a server

```powershell
powershell … -File infra\k6\start-api.ps1 -Instances 4 | Select-Object -Last 8   # HANGS FOREVER
```

The API instances inherit the pipe's write end and never close it, so `Select-Object` waits for
a writer that will not arrive. `run-cluster.ps1` has the same hazard because it calls
`start-api.ps1` in-process. Redirect to a file instead:

```powershell
powershell … -File infra\k6\run-cluster.ps1 … *>> $log
```

This cost 30 minutes of wall clock on this project. The worse failure mode is quieter: the
children share one pipe, it can fill, and a server blocked writing a log line mid-run produces
numbers that look exactly like application latency.

---

## How the simulated lab network works

Spec §11.5: distinct IP per machine, no NAT. Each VU gets its own address, supplied via
`X-Forwarded-For` with the **k6 process acting as the trusted proxy** — the same topology as
the production Nginx setup in `../DEPLOYMENT.md` §2, which makes that runbook note testable
rather than theoretical.

> **The device session is bound per *attempt*, not per host.** The premise that N VUs from one
> address would trip `409 SESSION_ACTIVE_ELSEWHERE` is **incorrect** and was disproved by
> probe before the suite was written: every VU owns a different student, hence a different
> attempt, so N VUs can share one address without ever colliding. Distinct addresses buy
> fidelity — the CIDR parser and the `requestIp !== sessionIp` branch get exercised across
> thousands of real addresses — not collision avoidance. What *is* required is a **stable
> per-VU** address, and a VU that rotated its IP mid-exam would get exactly the 409 the
> design is avoiding.

---

## Reading a result

`checks` and `http_req_failed` are **functional** and load-independent: if they fail, the run
is invalid regardless of latency. The per-step latency budgets are a **per-process
contract** — they assume `VUS ≤ 100 × processes`, and exceeding it is the finding, not a
false alarm.

When a run fails, read in this order:

1. `checks` / `http_req_failed` / `exam_start_failures` — is the run valid at all?
2. `exam_start_latency` — if the start storm is already over budget, login is the cause and
   login's p(95) will show it.
3. `login_latency` — the per-process serialised bcrypt queue (`../DEPLOYMENT.md` §1).
4. `actively refused` in the `.stderr.txt` — a past-the-budget process cannot drain the
   accept queue. The process is alive; `/health` will still be fine.
5. `exam_list_latency` — the unindexed exam-scope `OR` plus an N+1 per candidate exam
   (`apps/api/src/routes/student-exams.ts:28-78`). The known second bottleneck.
