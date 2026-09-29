# Load test results

Archived artefacts for every run, and the measurements
[`../student-exam-path.js`](../student-exam-path.js)'s `thresholds` block was derived from.
**Re-derive by re-running the ramp and diffing these numbers — do not edit the thresholds by
feel.** A latency budget that is loosened to make a run green is indistinguishable from one
that was measured.

Sizing conclusions: [`../../DEPLOYMENT.md`](../../DEPLOYMENT.md). How to run:
[`../README.md`](../README.md).

> **The raw `summary.json` / console / stderr files for these runs are not in git.** They are
> ignored by the `infra/k6/results/**` rule in the root `.gitignore` (~1.5 MB of output), because
> every number quoted below is transcribed here and the output is regenerable with
> [`../run.ps1`](../run.ps1) and [`../run-cluster.ps1`](../run-cluster.ps1). This file is
> explicitly exempted from that rule — **it is the record.** If you need an original artefact,
> re-run the labelled run named in the relevant table row rather than looking for a committed
> file. Note that thresholds never appear in `summary.json` at all: the k6 exit code and the
> `crossed` column read from the stderr sidecar are the only record of what a run breached.

---

## Reference machine

i7-12700H, 14 cores / 20 threads, 15.7 GB RAM. **Node and PostgreSQL on the same host** —
the pessimistic arrangement, since login is CPU-saturating bcrypt. PostgreSQL
`max_connections=100`, `shared_buffers=160MB`. k6 v2.3.0, Node ESM API on ports 4001+.
Load-test API instances run with `NODE_ENV=development`, `TRUSTED_PROXY_IPS=127.0.0.1,::1`,
`LAB_IP_RANGES=10.20.0.0/16`, and an explicit Prisma `connection_limit=10`.

`SEB_KEYS` empty ⇒ **the SEB hash path was never exercised** in any run below (spec §6.2
still deferred).

---

## All runs, per-step p(95) in ms

Extracted from the archived JSON, not from memory. `started/sub` is
`exam_start_attempts / exam_submitted`; a low pair means the answer/heartbeat schedule
starved, not that the server was slow.

> **The two tables below measure different things and must never be compared across.**
> **Table A** ran before the arrival ramp was implemented, so every VU hit the server in the same
> millisecond and every number in it is dominated by queueing behind bcrypt. **Table B** is the
> same scenario with a real arrival window. The threshold budgets come from Table B only — see
> [harness defect 3](#3-the-arrival-ramp-was-documented-but-never-implemented).

### Table A — burst arrivals (superseded; kept as the record)

| run | shape | login | list | start | answer | flag | hb | submit | checks | req fail | started/sub |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `base-001` | 1 proc × 1 | 91 | 12 | 12 | 15 | 15 | 12 | 17 | 100% | 0 | 1/1 |
| `base-025` | 1 proc × 25 | 2,219 | 448 | 114 | 159 | 42 | 105 | 89 | 100% | 0 | 25/25 |
| `base-100` | 1 proc × 100 | **8,236** | **7,383** | **336** | **301** | **178** | **234** | **272** | 100% | 0 | 100/100 |
| `ramp-200` | 1 proc × 200 | 18,136 | 16,778 | 767 | 481 | 297 | 542 | 441 | 100% | 0 | 200/200 |
| `ramp-400` | 1 proc × 400 | 25,830 | 23,894 | 885 | 623 | 399 | 548 | 351 | 94.9% | 3.58% | 267/267 |
| `clu-2proc` (worst leg) | 2 proc × 100 | 5,892 | 5,330 | 159 | 114 | 62 | 164 | 111 | 100% | 0 | 100/100 |
| `clu-4proc` (worst leg) | 4 proc × 100 | 6,479 | 5,102 | 180 | 129 | 67 | 138 | 100 | 100% | 0 | 100/100 |
| `sust-4proc` (worst leg) | 4 proc × 100, 300 s | 6,498 | 5,988 | 166 | 109 | 70 | 125 | 46 † | 96% | 4.95% | 100/**0** |
| `thr2` (worst leg) | 4 proc × 100 | 6,772 | 6,153 | 204 | 150 | 73 | 144 | 120 | 100% | 0 | 100/100 |

† `sust-4proc`'s submit and `checks` figures are **known wrong** and are kept only as the
record of the defect described below. Every other cell is a real successful request.

`clu-4proc` has only legs 0, 2 and 3 archived: leg 1's `summary.json` was destroyed by the
rename race described below. Its console transcript survived.

Table A is retained rather than deleted because it is the evidence for harness defect 3, and
because "we used to believe this" is worth more to a reader than a silently replaced table. Its
`login` column in particular is **not** a per-request latency and must never be quoted as one.

### Table B — ramped arrivals (current; the budgets come from here)

Per-step p(95) in ms, plus a `crossed` column naming the metrics k6 itself reported as
breached. Thresholds never appear in `summary.json`; the k6 exit code and the stderr sidecar
are the record, so `crossed` is read out of stderr, never computed.

| run | shape | window | login | list | start | answer | flag | hb | submit | checks | crossed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `ramp100-calib` | 1 proc x 100 | 60 s | 64.0 | 6.8 | 14.8 | 15.2 | 6.4 | 11.8 | 14.0 | 100% | -- |
| `ramp100-2228` | 1 proc x 100 | 60 s | 62.7 | 6.6 | 13.6 | 13.1 | 6.2 | 11.9 | 14.4 | 100% | -- |
| `ramp100-2328` | 1 proc x 100 | 60 s | 66.6 | 10.6 | 13.6 | 20.0 | 9.5 | 21.0 | 17.5 | 100% | -- |
| `r10-100-2428` | 1 proc x 100 | 10 s | 58.9 | 6.0 | 9.9 | 11.5 | 6.5 | 11.8 | 12.7 | 100% | -- |
| `thr-new-1proc` | 1 proc x 100 | 10 s | 60.3 | 9.5 | 14.4 | 19.7 | 22.0 | 15.8 | **85.9** | 100% | submit |
| `r10-100-2828` | 1 proc x 100 | 10 s | 60.4 | 7.4 | 12.3 | 23.1 | 19.5 | 14.3 | **47.6** | 100% | -- |
| `r10-100-2928` (t) | 1 proc x 100 | 10 s | **141.9** | **358.3** | **454.3** | 13.5 | 7.2 | 62.9 | 15.3 | 100% | list, login, start |
| `r10-100-3028` | 1 proc x 100 | 10 s | 59.6 | 7.4 | 10.5 | 13.0 | 6.8 | 12.6 | 13.1 | 100% | -- |
| `clean-2428` | 1 proc x 100 | 10 s | 60.5 | 13.9 | 8.3 | 16.8 | 8.9 | 13.2 | 16.3 | 100% | -- |
| `clean-2528` | 1 proc x 100 | 10 s | 60.4 | 15.8 | 7.9 | 16.2 | 9.6 | 15.0 | 17.4 | 100% | -- |
| `verify-100` | 1 proc x 100 | 10 s | 61.7 | 19.5 | 10.0 | 15.9 | 12.2 | 17.2 | 20.2 | 100% | -- |
| `r10-200-2528` (t) | 1 proc x 200 | 10 s | **2,368.8** | **5,367.8** | **6,158.6** | 227.1 | 171.0 | **1,057.9** | 53.7 | 99.9% | hb, start (old budgets) |
| `verify-200` | 1 proc x 200 | 10 s | **2,012.7** | **5,434.6** | **5,489.8** | 96.0 | 79.1 | 97.8 | 85.5 | 100% | **6 of 7** |

(t) = a contaminated or superseded run, excluded from the threshold derivation. See
[The noise floor](#the-noise-floor) for why `r10-100-2928` is excluded, and the note below the
table for why `r10-200-2528` cannot be used as the tripwire evidence.

### The noise floor on this machine

Three of the thirteen runs above were blown out, and **each was blown out on different steps**:

| run | what was slow | signature |
|---|---|---|
| `thr-new-1proc` | submit 85.9 (clean-run value: 17.5) | write-heavy steps only |
| `r10-100-2828` | submit 47.6, answer max 127.7 | write-heavy steps only |
| `r10-100-2928` | list 358, start 454, login 142 | early read path only |

That is the fingerprint of a **multi-hundred-millisecond stall that hits whichever requests are
in flight at the time**, not of a step-specific cost -- `exam_list` is a pure read and has nothing
to share a cause with the grading write, yet each run picked a different victim. I did not
isolate the cause, and the honest entry is that this box has an intermittent stall of a few
hundred ms. Two candidate mechanisms were considered and neither is proven: a timed Postgres
checkpoint (`checkpoint_timeout` 300 s against runs roughly 4 minutes apart, `shared_buffers`
128 MB, `synchronous_commit on`) and host-level I/O interference. **Do not record either as
the cause.**

`r10-100-2928` is excluded for a separate and more specific reason: **I contaminated it.** I ran
two `pg_stat` catalog queries from psql *while it was in flight*, which is exactly the error
this file's own "harness defects" section warns about. It is listed above rather than deleted so
the exclusion is visible and reversible.

**Rule: a single failing run on this machine is not a finding.** Re-arm the window and re-run
before believing it:

```powershell
powershell -ExecutionPolicy Bypass -File infra\k6\seed\reset-window.ps1 -StudentOffset <off> -Vus <n>
powershell -ExecutionPolicy Bypass -File infra\k6\run.ps1 -Vus <n> -StudentOffset <off> -ExamSeconds 60 -RampSeconds 10 -Label recheck
```

If a metric breaches the same budget twice in a row on a re-armed window with nothing else
running, that is a result. If it breaches once, it is the noise floor.

**Do not run diagnostics during a run.** `Get-NetTCPConnection`, a `pg_stat` query, a `git
status`, even a file write, is enough to move a p(95) by an order of magnitude on a stalled run.
Measure, then step away.

### Reference shape = 100 VUs per API process, ramped

One process, 100 VUs is the reference. In the burst era `base-100` was the worst observation at
*every* step -- counter-intuitively worse than a 4-process leg at the same per-process count
(answer 301 ms vs 129 ms) -- and that is why the single-process run was chosen. That
counter-intuitive result is an **artefact of the burst shape and does not reproduce once the
ramp exists**: the ramped 100-VU runs above agree to within a few milliseconds on login, and the
per-process contract is now simply *"one process seats ~100 concurrent students"*.

Two runs at the same per-process VU count are still **not interchangeable** -- arrival rate and
window length are part of the shape, which is why the window is now recorded on every row.

---

## How the thresholds were derived

**Re-derived after the arrival-ramp fix (harness defect 3 below).** The previous set came from
burst runs, where latency was mostly queueing behind bcrypt rather than work done by the server.
The clearest single demonstration is `r10-200-2528` in Table B: at 200 VUs on one process login
p(95) was **2,368.8 ms** against 58.9 ms at the reference shape -- 40x worse -- and the old
`login_latency < 11,000` **passed it**. A budget derived from a burst is a budget for the queue,
not for the server.

### The rule

Worst p(95) at the reference shape -- **100 VUs on one API process, arrivals spread over a real
window** -- plus roughly 40% headroom.

**p(95), not the max.** This was re-decided against measurement, and the first answer was wrong.
A run seats `VUS` students with `iterations: 1`, so there are only 100 samples: p(95) is the 95th
of 100, five samples sit above it, and it is **p(99)** that tracks the max. `ramp100-2328`
`exam_start`: p(95) 13.6, p(99) 67.1, max 67.1. Budgeting off the max would be budgeting off a
statistic the threshold never evaluates.

The correction is not theoretical. `verify-100` had an `exam_list` **max of 117.1 ms** against a
budget of 25 -- 4.7x its own budget -- while its p(95) of 19.5 passed comfortably. A max-based
budget would have failed the reference shape on a single unlucky request.

### The budgets

| step | worst p(95) @ 100/proc | budget | headroom |
|---|---|---|---|
| `login_latency` | 66.6 | **100** | 50% |
| `exam_list_latency` | 15.8 | **25** | 58% |
| `exam_start_latency` | 14.8 | **25** | 69% |
| `answer_latency` | 23.1 | **40** | 73% |
| `flag_latency` | 22.0 | **30** | 36% |
| `heartbeat_latency` | 21.0 | **30** | 43% |
| `submit_latency` | 85.9 | **120** | 40% |

Source: the nine uncontaminated 100-VU runs in Table B. `submit` and `flag` are set by the two
noisy runs rather than by the clean-run figures (submit 17.5, flag 9.6) because the budgets must
survive [the noise floor](#the-noise-floor) -- a tripwire that fires at random gets ignored, which
is worse than having none. **Do not tighten these without 20+ clean runs.**

### What the budgets are for

They are a **per-process contract**, not absolute SLAs: they assume `VUS <= 100 x processes`.
Running a larger cohort against one process is *expected* to fail, and that is the finding, not
a false alarm. 5,000 students need 6-8 processes -- see [`../../DEPLOYMENT.md`](../../DEPLOYMENT.md) §1.

### The tripwire, measured with these budgets

A budget is only useful if it still fires when the system is actually overloaded, so this was
**re-measured rather than inferred**: `verify-200` (200 VUs, one process, 10 s window) against
the budgets above. It **exited 99** and stderr named the six it crossed --
`answer_latency, exam_list_latency, exam_start_latency, flag_latency, heartbeat_latency,
login_latency` -- with **empty stderr otherwise and 3680/3680 checks, 0 failed requests**.

| step | p(95) @ 100/proc | p(95) @ 200/proc | budget | |
|---|---|---|---|---|
| `login` | 61.7 | **2,012.7** | 100 | crossed |
| `exam_list` | 19.5 | **5,434.6** | 25 | crossed |
| `exam_start` | 10.0 | **5,489.8** | 25 | crossed |
| `answer` | 15.9 | **96.0** | 40 | crossed |
| `flag` | 12.2 | **79.1** | 30 | crossed |
| `heartbeat` | 17.2 | **97.8** | 30 | crossed |
| `submit` | 20.2 | 85.5 | 120 | **not crossed** |

That is the useful property: *one process seats about 100 concurrent students, not 200.*

**`submit` cannot be a capacity tripwire at any budget.** At 200 VUs it measured 85.5 ms, which is
below its own 100-VU budget and only 1.4x its reference p(95). Grading is a 7-row write
transaction that never touches bcrypt, so it is the last step to notice CPU saturation and the
first to notice the disk. Its budget is a regression detector only, and the set relies on the
other six to catch overload.

### A correction about the earlier tripwire evidence

This section previously claimed `r10-200-2528` "exited 99 with every latency budget broken". That
was **arithmetic on archived numbers, not a measurement, and it was wrong.** Its stderr sidecar
reads `thresholds on metrics 'exam_start_latency, heartbeat_latency'` -- only two. The reason is
a sequencing error: `r10-200-2528` ran at 16:20, *before* the re-derived budgets were written, so
it was judged against the original burst-era set, under which only `exam_start` (6,159 > 500) and
`heartbeat` (1,058 > 350) breached. `verify-200` is the real tripwire evidence, and the
correction is the reason the re-derivation was worth doing: the same run that broke two of the
old budgets would break six of the new ones.

### Functional thresholds (load-independent)

`checks > 0.99`, `http_req_failed < 0.01`, `login_failures < 0.01`,
`exam_start_failures < 0.01`, and `count == 0` for `exam_session_elsewhere`,
`exam_lab_refused`, `exam_wrong_access_code`.

`count == 0` is the right form for "must never happen": **k6 passes a threshold on a metric
with zero observations**, so `rate < 0.01` would silently pass on a counter that never fired.
If a functional threshold fails, the run is invalid regardless of latency.

---

## The confirmatory run — `thr2`, 4 processes × 100 VUs, 60 s exam

The run that validated the **pre-ramp, burst-derived** thresholds, after the two harness defects
below were fixed.

> **Read this section as evidence about the functional invariants, not about the latency
> budgets.** It ran before the arrival ramp existed, so its per-step numbers are burst-era
> (login 6,389-6,772 ms) and were judged against the old budget set. What it does still
> establish, and establishes well: all four legs passed every *load-independent* invariant —
> 1840/1840 checks each, 100/100 started and submitted, `SESSION_ACTIVE_ELSEWHERE` 0,
> `LAB_NETWORK_REQUIRED` 0, wrong access code 0, empty stderr — and the grading it produced is
> correct in the database.
>
> **The current budgets were confirmed at the same shape by `verify-cluster` in the next
> section** — that run, not this one, is the calibration evidence. Read this one for the burst
> era and for the anomaly it recorded.

| leg | checks | started/sub | login | list | start | answer | flag | hb | submit | req fail | stderr |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 (`:4001`) | 1840/1840 | 100/100 | 6,389 | 4,475 | 291 | 150 | 71 | 144 | 80 | 0 | empty |
| 1 (`:4002`) | 1840/1840 | 100/100 | 6,666 | 5,668 | 276 | 115 | 45 | 108 | 54 | 0 | empty |
| 2 (`:4003`) | 1840/1840 | 100/100 | 6,772 | 6,153 | 204 | 114 | 73 | 117 | 120 | 0 | empty |
| 3 (`:4004`) | 1840/1840 | 100/100 | 6,422 | 5,447 | 197 | 113 | 64 | 111 | 112 | 0 | empty |

**All 4 legs exited 0** — k6 exits 99 on any threshold failure, so every budget and every
functional invariant held. Every leg: 12/12 named checks green, `SESSION_ACTIVE_ELSEWHERE`
0, `LAB_NETWORK_REQUIRED` 0, wrong access code 0, and **empty stderr** (not one warning).

### Verified in the database, not just in the client's 200s

Client-side success is not evidence. For the 400 students this run seated:

```
status      attempts  snapshots  graded  min_grade  max_grade  total = sum(parts)
submitted   400       2400       2400    0.00       10.00      true
```

400 attempts all `submitted`, 2,400 snapshot rows (6 per student, matching the 2/2/2
difficulty mix), **all 2,400 graded** — i.e. every student answered every question — a
realistic 0.00–10.00 grade spread out of 12, and the grading invariant
`total_grade == sum(grade_awarded)` holding for every single student.

> A first attempt at this query reported **2,400 attempts** and was wrong: `count(*)` over a
> join to `StudentExamQuestion` counted snapshot rows, not attempts. This is the same trap as
> the wrong `JOIN` count in the results-verification work. **Use `count(DISTINCT …)` whenever
> a fan-out is possible**, and a wrong count in a verification query is worse than no query
> at all because it looks like a finding.

---

## The cluster confirmation — `verify-cluster`, 4 processes × 100 VUs, 10 s ramp

`thr2` above validated the functional invariants at cluster scale but ran before the arrival ramp
existed, so it said nothing about whether the *current* latency budgets hold across processes.
This run closes that gap: 4 API processes, one k6 leg each, disjoint 100-student windows
(`lt_stu_02101..02500`), arrivals spread over 10 s.

| leg | login | list | start | answer | flag | hb | submit | checks | req fail | stderr |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 (`:4001`) | 62.5 | 20.2 | 13.1 | 13.0 | 8.0 | 12.9 | 16.2 | 1840/1840 | 0 | clean |
| 1 (`:4002`) | 63.4 | 12.5 | 11.8 | 11.3 | 6.8 | 9.8 | 13.1 | 1840/1840 | 0 | clean |
| 2 (`:4003`) | 63.1 | 15.7 | 9.9 | 11.9 | 9.0 | 11.4 | 14.9 | 1840/1840 | 0 | clean |
| 3 (`:4004`) | 62.6 | 13.2 | 12.9 | 14.9 | 8.8 | 14.2 | 17.0 | 1840/1840 | 0 | clean |

**All four legs exited 0** (k6 exits 99 on any threshold failure), 400/400 started and submitted,
`SESSION_ACTIVE_ELSEWHERE` 0, `LAB_NETWORK_REQUIRED` 0, wrong access code 0, and **empty stderr
on every leg** — so no budget was crossed by even one request.

Verified in the database as well, not just by the client's 200s: **400 attempts all
`submitted`**, **2,400 snapshot rows all graded** (6 per student, matching the 2/2/2 mix), and
**0 violations of `total_grade == sum(grade_awarded)`**.

> A first attempt at that verification query returned **0 rows** and looked like a clean result.
> It was a wrong query: `student_id` is a UUID and `lt_stu_02101` is a *username*, so the window
> has to be matched through `"User"`. A zero-row answer must always be paired with a control
> that proves the predicate can match at all — here `count(*)` of students in the window, which
> returned the expected 400. **A green query that found nothing is not a green query.**

### What this actually settles

**The per-process contract holds, and capacity scales with process count.** Worst-leg login
p(95) here is **63.4 ms at 4 × 100 VUs**, against **58.9–66.6 ms at 1 × 100 VUs** in Table B.
Four times the students produced the *same* login latency. That is the direct confirmation of
the sizing model in [`../../DEPLOYMENT.md`](../../DEPLOYMENT.md) §1: adding a process buys a
full process's worth of logins and nothing else, because `bcryptjs` blocks one main thread per
process.

It also **resolves the burst-era anomaly**, which was the most confusing number in the archived
table. `thr2` recorded 4-process legs measuring **1.3–2.3× better** than one process at the same
per-process VU count (answer 301 ms vs 129 ms), and the old calibration note reached for an
explanation — that single-process runs are somehow the worst shape. With the ramp in place the
two shapes are simply **the same**, which is what a per-process contract predicts and what a
thundering herd could never produce. The anomaly was an artefact, not a finding.

For scale, login p(95) across the ramped era: **~63 ms at cluster scale, 58.9–66.6 ms at one
process, and 6,389–6,772 ms in the burst era.** The last figure is a 100× improvement from a
change to the load generator alone, with no server change whatsoever.

> **A harness trap that cost 30 minutes, written down so it is not repeated.** Piping a script
> that launches long-lived processes hangs *forever*: `start-api.ps1 … | Select-Object -Last 8`
> never returns, because the API instances inherit the pipe's write end and never close it,
> while `Select-Object` waits for every writer. This is the same class as the Postgres
> `-Wait` / `-NoNewWindow` trap recorded further down. `run-cluster.ps1` is affected too,
> because it calls `start-api.ps1` in-process (line 49), so the rule is: **redirect to a file
> (`*>`) and never pipe anything that spawns a server.** The deeper risk is not the hang — those
> child processes share a pipe that can fill, and a process blocked writing a log line in the
> middle of a measurement produces numbers that look exactly like application latency.

---

## Three harness defects these runs found

All three were in the load test, not the product. All three are recorded because each produced
numbers that looked like a real result. The third is the largest error in the whole suite and
it is the reason the two before it took a session to find.

### 1. The answer/heartbeat schedule drifted, so the sixth question was never asked

`nextQuestionAt = now + questionEvery` quantised every slot to the tick boundary and pushed
it later each time. At `examSeconds=300` (15 s tick, one question per 50 s) the fifth
question slid from 250 s to 305 s and the **sixth was never asked at all**. Every VU then
submitted with a blank, hit the server's `409 unanswered_count` branch, and reported
`attempts submitted: 0` with a submit p(95) of 34–60 ms that was really the *rejection*.

Proved arithmetically before touching the script (300 s ⇒ 5/6 answered; the `+=` form ⇒ 6/6),
then both schedules were changed to `+=` anchored at a new `loopStart`. `thr2` is the proof:
`100/100` submitted on every leg and all 2,400 snapshots graded.

**A submit p(95) far *below* the answer p(95) is the tell.** A rejection is cheaper than a
real request.

### 2. A consumed student window is indistinguishable from a capacity failure

`thr` leg 0 reported `start failure rate: 1.0000`, 57% checks, and 100 HTTP failures —
while the other three legs were clean. It was not capacity. The cause, found by reading
`started_at` out of the database: those students had `started_at` **3 h 16 m before the run**,
left `in_progress` by the `sust-4proc` run, whose schedule had walked past its declared
window (see below). A second `start` on an `in_progress` attempt answers
`409 SESSION_ACTIVE_ELSEWHERE`; on a `submitted` one, `409` "already submitted".

Two fixes:

- **`run.ps1` pre-flights the window** against the database and refuses in ~2 seconds,
  naming the exact students and the exact remedy. It costs one query and is the difference
  between a legible error and a full run whose artefacts are worthless.
- **`seed/reset-window.ps1`** re-arms a window through the real FK order
  (`GradeAdjustment` → `StudentExamQuestion` → `StudentExam`).

The root cause is a modelling decision worth stating plainly: `studentExamPath()` uses
`exec.scenario.iterationInTest`, so **every iteration consumes a new student**. With
`iterations: 1` a run seats exactly `VUS` students from `-StudentOffset` — but a run with
more iterations per VU walks far past its declared window and eats students a later run
believes are free. That is how a 400-VU run came to be sitting on 3,200 students' worth of
ground without the driver saying so.

### 3. The arrival ramp was documented but never implemented, so every run was a thundering herd

This one invalidates the interpretation of every number above it, which is why it is listed
third and not first — it was invisible until the "second bottleneck" was chased down.

`lib/config.js` documented a ramp, in these words: *"Students do not appear in the lab
instantaneously; the exam start window in practice is 1-2 minutes for a cohort (spec 11.2),
and a zero-second ramp measures a thundering herd rather than the real thing."*
`student-exam-path.js` also promised to model *"the login storm (spec 11.2: 5,000 password
hashes inside 1-2 minutes)"*.

**Neither was true.** The scenario is `per-vu-iterations` with `iterations: 1` and no
`startTime`, so all VUs fire their first request in the same millisecond. `rampSeconds` was
read in exactly one place — the arithmetic inside `maxDuration` — and ramped nothing. **Every
archived run in this directory is a burst.** A comment described a control that did not exist,
which is the most expensive kind of harness bug: it made a wrong measurement look deliberate.

**How it was found.** `exam_list` was recorded as the second bottleneck (p(95) 7,383 ms at 100
VUs/process) and attributed to an unindexed three-way `OR` plus an N+1 in
`routes/student-exams.ts:28-78`. Rather than index first and ask later, the path was isolated:
`list-only.diagnostic.js` mints tokens up front, so **no login is on the measured path at all**,
and fires 100 `GET /student/exams` at a process whose event loop is idle.

| shape | login on the path? | p(95) `exam_list` | admitted | refused |
|---|---|---|---|---|
| 1 VU, burst | no | **11.6 ms** | 1 | 0 |
| 100 VUs, burst | no | **182 ms** | 100 | 0 |
| 100 VUs, burst | **yes** | **7,383 ms** | 100 | 0 |

182 ms against 7,383 ms, same endpoint, same process, same 100 VUs. **~7,200 ms of that p(95)
was queueing behind bcrypt, and at most 182 ms was ever the query.** The bottleneck was real
but it was the *first* one wearing the second one's name, and no index was going to move it.

Pushing the same diagnostic to scale then produced the admission ceiling, and with a ramp the
"bottleneck" disappears:

| VUs | arrival | admitted | refused | p(95) of those served |
|---|---|---|---|---|
| 1,000 | all at t=0 | 282 | 718 | 359 ms |
| 3,000 | all at t=0 | 274 | 2,726 | 328 ms |
| 1,000 | over 30 s | **1,000** | **0** | **9.7 ms** |
| 3,000 | over 30 s | **3,000** | **0** | **6.4 ms** |

**`exam_list` is 6.4 ms at 3,000 concurrent students.** It was never a bottleneck. The refusals
are the listen backlog filling because every VU connected in the same instant — reproducible
with a completely idle event loop, which is what rules bcrypt out as their cause.

**The fix** is a stagger inside the iteration, so arrival time varies while the iteration count
does not (a VU is one student, and a student sits one exam once, so `ramping-vus` is the wrong
executor — it re-runs the function for the whole stage):

```js
if (CONFIG.rampSeconds > 0) sleep((index / VUS) * CONFIG.rampSeconds);
```

Same 100 VUs, same single process, **no change to the server at all**:

| step | burst (archived `base-100`) | ramped (1 process, 100 VUs, 60 s window) |
|---|---|---|
| `login` | 8,236 | **64** |
| `exam_list` | 7,383 | **6.8** |
| `exam_start` | 336 | **14.8** |
| `answer` | 301 | **15.2** |
| `flag` | 178 | **6.4** |
| `heartbeat` | 234 | **11.8** |
| `submit` | 272 | **14.0** |

**A 129× improvement in login p(95) from a change to the load generator alone.** Every latency
in the left column was dominated by how many VUs happened to be mid-bcrypt when the request
arrived.

**What survives, and what does not.** The *throughput* claim is untouched, because throughput is
total-over-total and does not depend on arrival pattern: 100 logins in 8.24 s is still 12/s per
process, and the ramped runs measure ~60 ms for one uncontended `bcrypt.compare` (~16/s). What
does not survive is any per-request latency, any threshold derived from one, and the runbook's
explanation that a blocked event loop is what refuses connections. The thresholds in
`student-exam-path.js` were re-derived from ramped runs (see above), because at a 64 ms
observation an 11,000 ms budget would pass a server that had gone 100× worse — and
`r10-200-2528` is the proof that it did: login p(95) 2,368.8 ms, 40× the reference shape, and it
**passed** the old budget.

---

## Other harness traps hit along the way

- **A `Move-Item` race destroyed a leg's `summary.json`.** With one k6 process per API
  instance, the first `run.ps1` to finish renamed *whichever* `summary.json` existed,
  including another leg's. Fixed by having k6 write its own final name via `RUN_LABEL` and
  deleting the rename entirely. Leg `clu-4proc-1` is permanently lost to this.
- **`Start-Process -PassThru` returned an empty `ExitCode`**, so four healthy legs were
  reported as "4 non-zero of 4". The handle has to be read (`$null = $p.Handle`) *before*
  the process exits. A harness bug that invents a failure is as bad as one that hides one.
- **`run.ps1` died on k6's first stderr warning.** Windows PowerShell wraps a native
  command's stderr into `ErrorRecords`, and under `$ErrorActionPreference = 'Stop'` the first
  one is terminating — so the run that timed out most, the one whose numbers mattered most,
  archived nothing. Fixed by relaxing the preference around the call and redirecting stderr
  to its own file.
- **`Set-Content -Encoding UTF8` writes a BOM** on Windows PowerShell 5.1. It broke JSON
  parsing of `fixture.json` and, earlier in this project, aborted a migration with
  `syntax error at or near "<BOM>"`. Use `UTF8Encoding($false)`.
- **psql `-c` is unusable here**: PowerShell strips the double quotes out of a native
  command's arguments, so `from "User"` arrives as `from User`. Always `-f` a temp file.
- **k6 v2 specifics**: `exec` is a default import from `k6/execution`; a Trend's `values`
  has **no `count`**; tag-filtered `http_req_duration{name:…}` sub-metrics are absent from
  the summary JSON unless a threshold names one; and thresholds do not appear in the
  summary JSON at all — **the k6 exit code is the record**.

---

## Caveats

- **5,000 VUs were never run.** Largest verified: 400 concurrent students. The 6–8 process
  sizing in `DEPLOYMENT.md` is a *measured per-process rate* divided into a target, not a
  measurement of the target.
- **Per-process latency is noisy** at a fixed VU count (§reference shape above). Threshold
  changes should be justified by the worst observation, not the median run.
- **The `sust-4proc` numbers are void** for `submit` and `checks` (defect 1). The sustained
  leg should be re-run if a sustained 300 s figure is ever needed.
- **SEB is unmeasured** in every run here.
- **The second bottleneck is unfixed.** `exam_list` is 7.4 s p(95) at 100 VUs/process from an
  unindexed three-way `OR` over `target_scope` plus an N+1 `ensureStudentExamForStudent` per
  candidate exam (`apps/api/src/routes/student-exams.ts:28-78`). At 5,000 concurrent VUs this
  is the next thing to break, and it should be fixed before trusting the process sizing.
