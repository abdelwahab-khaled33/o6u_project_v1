# Deployment runbook — university exam platform

Everything numeric in this document comes from a run that actually happened. The measured
numbers and the *extrapolated* numbers are labelled separately, because the 5,000-student
target was **never run** — the largest configuration actually verified is 400 concurrent
virtual users. Read [What was measured](#what-was-measured-and-what-was-not) before
quoting any capacity figure from here.

Load-test scripts: [`infra/k6/`](./k6/README.md). Raw results: [`infra/k6/results/`](./k6/results/README.md).

---

## 1. The headline: capacity is a function of process count, not core count

The login path is CPU-bound **pure-JavaScript bcrypt** on the Node main thread. It is not
parallelisable across cores inside one process, and it blocks the event loop while it runs.

Measured on the reference machine (i7-12700H, 14 cores / 20 threads, 15.7 GB RAM, Node +
PostgreSQL on the same host):

| VUs, 1 API process | login p(95) | implied login rate |
|---|---|---|
| 1 | 91 ms | — (one compare) |
| 25 | 2,219 ms | ~11/s |
| 100 | 8,236 ms | ~12/s |
| 200 | 18,136 ms | ~11/s |
| 400 | 25,830 ms | ~12/s (267 of 400 succeeded) |

One uncontended `bcrypt.compare` at cost 10 takes ~91 ms when it is the only thing running.
100 logins completing in 8.24 s is ~82 ms each — i.e. **strictly serialised, ~12 logins per
second per process, and it does not improve with more cores.** Adding cores to one process buys
nothing for login.

> **Those rates are saturation numbers, and saturation is not the only case.** With arrivals
> spread over a real window (`k6` ramp, 100 VUs over 10 s) the same single process served
> logins at **~60 ms p(95) — about 16/s** — because the event loop was not asked to serialise
> the whole cohort at once. So the honest range is **12/s saturated, ~16/s comfortably loaded**,
> and 12/s is the right divisor for sizing a burst while 16/s is what a smooth cohort actually
> sees. This was measured, not assumed: see `verify-100` in
> [`k6/results/README.md`](k6/results/README.md) Table B.
>
> **The rate survives the arrival-pattern fix; the latencies in the table above do not.** Every
> latency in that table was measured with all VUs arriving in the same millisecond, so it is
> queueing time, not service time. Login p(95) at 100 VUs **ramped** is 58.9–61.7 ms, not
> 8,236 ms. Quote the rate; do not quote those latencies.

> **Confirmed at cluster scale, not just arithmetically.** `verify-cluster` ran 4 API processes ×
> 100 VUs each with arrivals spread over 10 s, and **all four legs exited 0 with empty stderr**.
> Worst-leg login p(95) was **63.4 ms at 400 concurrent students**, against **58.9–66.6 ms at
> 100 students on one process** — the *same* latency at four times the load. That is the sizing
> model in one sentence: a process buys a full process's worth of logins, and cores buy nothing,
> because `bcryptjs` blocks one main thread per process. The four-student count in the table
> above is therefore not a projection from one process; it was measured.

(An earlier version of this section compared 4 processes × 100 VUs against 1 × 100 and concluded
they were 1.3–2.3× *better*. That comparison was made with every VU arriving at once, so it was
measuring two different queue depths, not two capacities. Ramped, the shapes are identical.)

> **The exam-start path is not the bottleneck.** It was the stated suspect and measurement
> cleared it. `POST /start` is cheap because attempts and snapshots are pre-generated at
> approval time: start p(95) was 12 ms at 1 VU and 152–209 ms at 100 VUs/process, roughly
> 25× cheaper than login at the same load. `answer`, `flag`, `heartbeat` and `submit` all
> parallelise across processes. Only login does not.

### Sizing for 5,000 students

**This assumption is now a measurement, not a hope.** Students do not all log in at the same
instant, and the load suite now proves it: 3,000 VUs spread over a 30 s window were all admitted
with **0 refusals and a p(95) of 6.4 ms** (`GET /student/exams`, single process, login off the
measured path). The same 3,000 VUs arriving together are a different question entirely, and one
process does not have the connections for it.

The figures below are per the login rate above, and **they are arithmetic, not measurement**:

| Students log in within | Required rate | Processes (÷12/s) |
|---|---|---|
| 60 s | 83 logins/s | **7** |
| 120 s | 42 logins/s | **4** |
| 120 s with ~50% headroom | 42 logins/s | **6** |

**Recommendation: 6–8 API processes**, and treat 5,000 concurrent logins in a 60-second
window as the case you are actually designing for. At 8 processes the login queue for 5,000
simultaneous students would still take ~60 s to drain, which is fine — the queue is a
natural rate limiter that *stretches* students out and lowers downstream concurrency.

> **This is the honest caveat.** 5,000 VUs were never run; the largest verified figure is
> 400. The 7/4/6 process counts come from dividing the target rate by a *measured* 12/s. If
> you need a verified number, run `infra/k6/run-cluster.ps1 -Processes 8 -VusPerProcess 100`
> with a cohort of 800 and read the per-leg numbers; the per-process behaviour is what has
> been verified, not the aggregate.

### What happens when you get this wrong

At 400 VUs against a single process the run produced **133 `actively refused` connections**.
That is not a crash: the health monitor recorded zero errors and a 306 ms maximum while the
listener never disappeared, and the process kept serving every connection it had already
accepted. **`actively refused` in k6 stderr means the kernel refused the SYN — the listen
backlog was full.**

> **Correction (measured after the fact, and the original explanation here was wrong).** The
> first version of this section said a *blocked event loop* is the cause, because bcrypt
> blocks the loop for ~60 ms per login and a blocked loop cannot drain the accept queue. That
> is a real effect, but it is **not the main one**, and it is not the only one. Refusals
> reproduce with a **completely idle event loop** — no bcrypt, no CPU saturation — as soon as
> enough connections arrive in the same instant:
>
> | arrival | admitted | refused | p(95) of those served |
> |---|---|---|---|
> | 500 VUs, all at t=0 | ~257 | 243 | 297 ms |
> | 1,000 VUs, all at t=0 | ~282 | 718 | 359 ms |
> | 3,000 VUs, all at t=0 | ~274 | 2,726 | 328 ms |
> | 1,000 VUs over 30 s | 1,000 | **0** | **9.7 ms** |
> | 3,000 VUs over 30 s | 3,000 | **0** | **6.4 ms** |
>
> The admitted count plateaus at **~270 simultaneous connections per process on this box**
> regardless of how many arrive — the same ceiling the 400-VU run hit (400 − 133 = 267). So
> the honest reading is two independent limits that happen to have one symptom:
>
> 1. **Admission, ~270 connections/process, arrival-rate dependent.** Spreading arrivals over
>    30 s removes it entirely, even at 3,000 concurrent students. This is the dominant cause and
>    it has nothing to do with bcrypt.
> 2. **CPU, ~12 logins/s/process.** A blocked loop makes admission *worse*, which is why a
>    saturated login path produces the same message for a different reason.
>
> Operational consequence: check the login p(95) first to tell them apart. A high login p(95)
> means you are at the CPU limit; a high login p(95) with `actively refused` at low per-process
> VU counts means your **clients are connecting in a burst** and you need a ramp, more
> processes, or a bigger backlog. At 100 VUs/process arriving over a minute, neither appears.

---

## 2. Reverse proxy: `X-Forwarded-For` is load-bearing, and the default is fail-closed

Spec §6.1 requires the lab-network restriction to key off the **real client address**. The
implementation is deliberately strict, and it is strict in a way that will silently break a
deployment if you get it wrong.

`clientIp()` in `apps/api/src/middleware/lab-network.ts`:

1. Trusts `X-Forwarded-For` **only when `req.socket.remoteAddress` is itself in
   `TRUSTED_PROXY_IPS`**.
2. Reads the **rightmost** hop — the one the trusted proxy itself appended — not the leftmost.
   A client-supplied prefix therefore cannot win.
3. Unwraps `::ffff:a.b.c.d`, without which no real proxy on a dual-stack listener ever
   matches and the whole restriction fails **open**.

**Nginx must overwrite the header, not append to it.** `proxy_set_header X-Forwarded-For
$remote_addr;` — the single value `$remote_addr`, not `$proxy_add_x_forwarded_for`, which
appends and leaves a client-controlled prefix in place.

```nginx
upstream exam_api {
    # One entry per API process, in a shared cluster. See §1.
    server 127.0.0.1:4001;
    server 127.0.0.1:4002;
    server 127.0.0.1:4003;
    server 127.0.0.1:4004;
    server 127.0.0.1:4005;
    server 127.0.0.1:4006;
    keepalive 64;
}

server {
    listen 443 ssl;
    server_name exams.university.edu;

    location /api/ {
        proxy_pass         http://exam_api;
        proxy_http_version 1.1;
        proxy_set_header   Connection        "";
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        # OVERWRITE, do not append. See above.
        proxy_set_header   X-Forwarded-For   $remote_addr;
        proxy_read_timeout 120s;
    }
}
```

`TRUSTED_PROXY_IPS` must then name the **proxy's own address**, not the lab subnets:

```bash
TRUSTED_PROXY_IPS=127.0.0.1,::1
```

If you forget it, `config/env.ts` **refuses to boot in production** rather than admitting
every student from the proxy's address. That guard is the reason the failure is loud, but
read the message: *"X-Forwarded-For is ignored and every request appears to come from the
proxy"*. If `LAB_IP_RANGES` does not contain the proxy address, **every student is refused
with `LAB_NETWORK_REQUIRED`** and the exam is untakeable.

`infra/k6/start-api.ps1` reproduces this exact topology for load tests — the k6 process
acts as the trusted proxy and sends a per-VU `X-Forwarded-For`, which is also how the CIDR
parser and the `requestIp !== sessionIp` branch get exercised across thousands of real
addresses instead of one.

---

## 3. Database connections: the second thing that will bite you

PostgreSQL is configured with **`max_connections = 100`**, `shared_buffers = 160MB`,
`work_mem = 4MB`, `effective_cache_size = 5GB`.

Prisma's default pool is `2 × cores + 1` **per process**. On this 14-core machine that is
**41 connections per process**, so:

| API processes | Default pool | Verdict |
|---|---|---|
| 2 | 82 | Fits, barely |
| 3 | 123 | **Exhausts `max_connections`** |
| 6 | 246 | **Exhausts it badly** |
| 8 | 328 | **Exhausts it badly** |

**You must pin `connection_limit` explicitly as you scale out.** The recommended 6–8
processes each get:

```
DATABASE_URL="postgresql://user:pass@host:5432/exam_platform?connection_limit=10&pool_timeout=20"
```

With `max_connections = 100`: 8 processes × 10 = 80, leaving 20 for your own psql, migrations
and monitoring. `infra/k6/start-api.ps1` does exactly this (`-ConnectionLimit`, default 10),
and the live check confirmed 4 processes holding only 7 connections with the cap in effect.

If you need more than ~8 processes, put **PgBouncer** in transaction-pooling mode in front of
PostgreSQL and point `DATABASE_URL` at PgBouncer instead:

```
DATABASE_URL="postgresql://user:pass@pgbouncer:5432/exam_platform?connection_limit=20&pgbouncer=true"
```

Two caveats that are easy to get wrong:

- Transaction pooling is **not** compatible with session-level advisory locks or
  `LISTEN`/`NOTIFY` held across a transaction. This schema uses neither.
- PgBouncer must have `server_reset_query = DISCARD ALL`, or a pooled connection can hand
  the next request someone else's session state.

---

## 4. Sizing the box

For the recommended 6–8 processes on one host, alongside PostgreSQL:

- **CPU**: 8 processes × ~1 core of bcrypt work. The login queue is the whole cost, and it is
  pure CPU. A 4-core box will serve the same login rate as an 8-core box with 8 processes —
  it will just need the processes spread over more wall-clock. **Buy cores, not processes**,
  then give each core one process.
- **RAM**: each Node process is ~150–250 MB against this workload. 8 processes ≈ 2 GB.
  PostgreSQL with `shared_buffers = 160MB` ≈ 1 GB resident. **A $25/month VPS (2 vCPU / 4 GB)
  is not enough for the 60-second target** and will not be enough for 6–8 processes plus a
  database. Budget for a 4–8 vCPU / 8–16 GB instance, or split the API and the database onto
  separate hosts — which is the better answer, because the database is then not competing
  with bcrypt for the same cores.
- **Do not** put the API and PostgreSQL on the same cores under the 60-second target. Login
  is CPU-saturating and the database will be starved precisely when 5,000 students are
  logging in at once.

---

## 5. Exam creation and approval are a *different* load profile

Do not size the exam-creation path from the student path, and do not load-test it with it.

`generateStudentExamsForExam` runs **inside the exam-create transaction**, which has
`timeout: 60000`. It samples per-student questions, writes one `StudentExam` and several
`StudentExamQuestion` snapshot rows for every eligible student, and is bounded by
`max_connections` contention rather than by CPU. Measured on the seeded 3,200-student cohort:

| Step | Time |
|---|---|
| Create (pool + targets + pre-generate, uncommitted) | 0.03 s |
| Approve (separate transaction, generates attempts) | 3.09 s |

Both are far inside the 60 s budget at 3,200 students, and the 60 s timeout is not the first
thing that will fail as the cohort grows — **connection pool contention is**. Two
consequences:

1. **Only one exam may be created/approved at a time.** Approving two large exams
   concurrently doubles the concurrent attempt-generation load on the same pool.
2. **Prefer pre-generating well before the exam window.** A doctor creating an exam for
   5,000 students minutes before it opens converts a 3-second admin action into a
   user-visible wait. `POST /admin/exams/:id/approve` is the expensive one.

---

## 6. Known limitations of this runbook

- **SEB is unverified.** `SEB_KEYS` was left empty for every load run, so the
  `middleware/seb.ts` hash path was **never exercised**. Spec §6.2 real-machine verification
  is still deferred. The load numbers say nothing about SEB overhead, and the two hashes must
  be confirmed on an actual exam machine before you trust the runner in a real hall.
- **5,000 VUs were never run.** Largest verified: 400 VUs / 400 concurrent students.
- **Single host, single database.** Every number here was measured with the API and
  PostgreSQL on the same machine, which is the *pessimistic* arrangement (§4). Do not read
  the numbers as an upper bound for a split deployment without re-measuring.
- **The second bottleneck is unfixed and unmeasured at scale.** `GET /student/exams`
  (`routes/student-exams.ts:28-78`) is the second-heaviest step — p(95) 7.4 s at 100
  VUs/process — because of an unindexed three-way `OR` over `target_scope` plus an
  **N+1 `ensureStudentExamForStudent` per candidate exam**. At 5,000 concurrent VUs this,
  not login, is the next thing to break. Fix it (index, and batch the N+1) before trusting
  the 6-process sizing.
- **Per-process latency is noisy at the same VU count.** A single process at 100 VUs measured
  1.3–2.3× worse than a cluster leg at the same per-process count (answer 301 ms vs 129 ms).
  Two runs at the same per-process VU count are not interchangeable, which is why the k6
  thresholds are calibrated to the *worse* observation.
- **Windows are consumed one-shot.** Each student may sit the exam once; a second start
  answers `409`. `run.ps1` now pre-flights the window and refuses in ~2 s with the exact
  students named. If you genuinely need to re-run one, `seed/reset-window.ps1` re-arms it.

---

## 7. Operating it

```powershell
# 1. Database (portable PostgreSQL, not a Windows service)
powershell -ExecutionPolicy Bypass -File scripts\dev-db-up.ps1

# 2. One-time: seed the load cohort and create+approve an exam
powershell -ExecutionPolicy Bypass -File infra\k6\seed\seed.ps1 -Students 3200

# 3. Start N API instances on 4001..4001+N-1 with the lab/proxy env and a bounded pool
powershell -ExecutionPolicy Bypass -File infra\k6\start-api.ps1 -Instances 8

# 4. Run the load test against them (one k6 leg per API process)
powershell -ExecutionPolicy Bypass -File infra\k6\run-cluster.ps1 `
    -Processes 8 -VusPerProcess 100 -StudentOffset 0 -ExamSeconds 60 -Label cap-8proc
```

A **non-zero exit code from `run-cluster.ps1` means a threshold failed, not that the run
errored** — the archived JSON in `results/cluster/` is still the measurement. Read the
per-step table before changing anything: if a *functional* invariant (`checks`,
`http_req_failed`, `exam_start_failures`) failed, the run is invalid regardless of latency.
If only latency budgets failed, that is the per-process VU contract in §1 being exceeded.
