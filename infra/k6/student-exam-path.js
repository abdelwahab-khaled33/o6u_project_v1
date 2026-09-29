// Student exam path load test: login -> start -> answer/flag/heartbeat -> submit.
//
// Spec 11.3 asks for "start + answer loop + heartbeat". This covers that plus the login it
// depends on, and it is written so the login storm (spec 11.2: 5,000 password hashes inside
// 1-2 minutes) and the start storm stay separable in the output rather than blending into one
// number, because they are different bottlenecks and they fail for different reasons.
//
// The two genuinely different load shapes in the project, kept apart on purpose:
//
//   * HERE (taking an exam). Attempts are pre-generated at approval (spec 4.3), so start is an
//     update plus a read of already-written snapshot rows. This is the steady state.
//   * Exam CREATION. generateStudentExamsForExam runs inside the create transaction with
//     timeout 60000 and writes every snapshot row for the cohort in one transaction. That is a
//     batch job wearing an HTTP request's clothes and a different profile entirely, so it is
//     NOT measured here. seed.ps1 times it instead, because a single timed event is the only
//     honest way to see it and it is not a sustained rate.
//
// Thresholds at the bottom are set from observed runs, not from a guess about what a laptop
// should manage. results/README.md records the numbers they came from and what the
// 5,000-concurrent target still needs before they mean anything.

import http from 'k6/http';
import { check, fail, sleep } from 'k6';
// `exec` is a module in k6 v2, not a global. Importing it as a default from 'k6/execution'
// is the documented form; `import { exec } from 'k6'` is not, and the failure is a bare
// "ReferenceError: exec is not defined" thrown from inside the first iteration.
import exec from 'k6/execution';
import { Trend, Rate, Counter } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
import {
  CONFIG,
  VUS,
  RESULTS_DIR,
  RUN_LABEL,
  loadFixture,
  labIpFor,
  studentNameFor,
  sessionCookieFrom,
} from './lib/config.js';

const fixture = loadFixture();
const EXAM = fixture.examId;

const startLatency = new Trend('exam_start_latency', true);
const startAttempts = new Counter('exam_start_attempts');
const startFailures = new Rate('exam_start_failures');

// Per-step trends, rather than reading `http_req_duration{name:...}`.
//
// k6 v2 does not put tag-filtered sub-metrics in the summary JSON unless a threshold names
// one, so a single blended p(95) is all you get for free -- and a blended number hides exactly
// what this test exists to find: the login is one bcrypt.compare and the answer is one indexed
// UPDATE, and only one of them is the bottleneck. Naming a threshold per step to force the
// sub-metric would have meant inventing the threshold before measuring it.
const loginLatency = new Trend('login_latency', true);
const loginFailures = new Rate('login_failures');
const examListLatency = new Trend('exam_list_latency', true);
const answerLatency = new Trend('answer_latency', true);
const flagLatency = new Trend('flag_latency', true);
const heartbeatLatency = new Trend('heartbeat_latency', true);
const submitLatency = new Trend('submit_latency', true);
const submitted = new Counter('exam_submitted');
const sessionElsewhere = new Counter('exam_session_elsewhere');
const labRefused = new Counter('exam_lab_refused');
const wrongCode = new Counter('exam_wrong_access_code');

export const options = {
  scenarios: {
    student_exam_path: {
      executor: 'per-vu-iterations',
      vus: VUS,
      // 1, not VUS. `per-vu-iterations` counts iterations PER VU, so `iterations: VUS` would
      // run VUS x VUS -- 25 million student exams at the 5,000 target. One iteration per VU
      // is also the correct model: a VU is a student, and a student sits one exam once.
      iterations: 1,
      // A hard ceiling so one stalled VU cannot hold the run open indefinitely. Generous on
      // purpose: the point of the max is to stop the test, not to truncate a slow student.
      maxDuration: `${CONFIG.examSeconds + CONFIG.rampSeconds + 300}s`,
      gracefulStop: '30s',
      exec: 'studentExamPath',
    },
  },
  thresholds: {
    // ---- Derived from the archived runs in results/, not from intuition. results/README.md is
    // the table these came from AND the record of how they were derived; re-run the ramp and
    // re-derive, do not edit these by feel. A budget loosened to make a run green is
    // indistinguishable from one that was measured.
    //
    // The calibration reference is 100 VUs on ONE process, ramped. The burst-era justification
    // for the single-process run -- that `base-100` was the worst observation at EVERY step --
    // does NOT survive the arrival ramp: the ramped 100-VU runs agree to within a few ms on
    // login, so the counter-intuitive 1.3-2.3x gap against a 4-process leg was an artefact of
    // the burst shape. The per-process contract is now simply "one process seats ~100 concurrent
    // students", verified by `verify-200`: 200 VUs on one process crossed six of the seven
    // latency budgets and exited 99.
    //
    // These budgets are now validated at BOTH scales. `verify-200` (200 VUs, one process, 10 s
    // window) exited 99 crossing six of the seven, so the tripwire fires when a process is
    // overloaded. `verify-cluster` (4 processes x 100 VUs, 10 s window) exited 0 on all four
    // legs with empty stderr, so four processes really do seat four times the students at the
    // SAME login p(95) (worst leg 63.4 ms vs 58.9-66.6 ms on one process). That equality is the
    // per-process contract, and it is the whole basis of the sizing in DEPLOYMENT.md: bcryptjs
    // blocks one main thread per process, so a process buys capacity and cores do not.
    //
    // `thr2` (4 processes x 100 VUs, all legs exit 0, 1840/1840 checks) is the earlier
    // pre-ramp run of the same shape. It remains the record of the burst era and the source of
    // the archived 1.3-2.3x "4 processes beat 1 process" anomaly, which the ramp then dissolved:
    // ramped, the two shapes are identical, as a per-process contract predicts.
    //
    // The latency budgets below are a PER-PROCESS contract: they assume VUS <= 100 x processes.
    // Running a larger cohort against one process is EXPECTED to fail the login budget, and that
    // is the finding, not a false alarm. 5,000 students need 6-8 processes -- the arithmetic is
    // in infra/DEPLOYMENT.md section 1, and it is an extrapolation from the measured per-process
    // rate, not a measurement of 5,000.

    // Functional invariants. These do not depend on the load shape, so they must hold at every
    // VU count and are the first thing to check when a latency budget fails.
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
    login_failures: ['rate<0.01'],
    exam_start_failures: ['rate<0.01'],
    // `count==0` on a Counter that never fires is the correct way to assert "this must never
    // happen": k6 passes a threshold on a metric with zero observations. A wrong access code, a
    // lab-network refusal or a stray SESSION_ACTIVE_ELSEWHERE would each be a real defect.
    exam_session_elsewhere: ['count==0'],
    exam_lab_refused: ['count==0'],
    exam_wrong_access_code: ['count==0'],

    // Per-step latency budgets.
    //
    // RE-DERIVED after the arrival ramp was implemented. The previous set came from burst
    // runs, where latency was dominated by queueing behind bcrypt rather than by the server,
    // so at a 66 ms observation an 11,000 ms budget would have passed a server 100x worse
    // than the one measured. A budget derived from a burst is a budget for the queue.
    //
    // Rule: worst p(95) at the reference shape -- 100 VUs on ONE API process, arrivals spread
    // over a real window -- plus ~40% headroom. p(95), not max: a run seats VUS students with
    // `iterations: 1`, so there are 100 samples, p(95) is the 95th of 100 (five samples sit
    // above it) and p(99) is what tracks the max. exam_start in `ramp100-2328`: p(95) 13.6,
    // p(99) 67.1, max 67.1. Budgeting off the max would be budgeting off a statistic this
    // threshold never evaluates.
    //
    // worst p(95) at 100 VUs/process over 9 uncontaminated runs, in ms:
    //   login 66.6 | exam_list 15.8 | exam_start 14.8 | answer 23.1
    //   flag  22.0 | heartbeat 21.0 | submit 85.9
    //
    // The submit and flag budgets are set by two noisy runs rather than by the clean-run
    // figures (submit 17.5, flag 9.6). This box intermittently stalls a few hundred ms, and
    // when it does it hits whichever requests are in flight -- in different runs it hit
    // submit, then submit+answer, then the early read path. The budgets must survive that, or
    // the tripwire cries wolf and gets ignored, which is worse than having none. See "The
    // noise floor" in results/README.md, and do not tighten these without 20+ clean runs.
    //
    // Still fails at 200 VUs on one process, which is the useful tripwire -- one process seats
    // ~100 concurrent students, not 200. Measured at 200 VUs/process over a 10 s window:
    // login 2,369 > 100, list 5,368 > 25, start 6,159 > 25, answer 227 > 40, flag 171 > 30,
    // heartbeat 1,058 > 30. Six of seven fire; k6 exits 99.
    //
    // submit is the seventh and CANNOT be a capacity tripwire, at any budget: at 200 VUs it
    // measured 53.7, which is below its own 100-VU noise floor. Grading is a 7-row write
    // transaction that never touches bcrypt, so it is the last step to notice saturation and
    // the first to notice the disk. Treat its budget as a regression detector only.
    login_latency: ['p(95)<100'], // [66.6]  one serialised pure-JS bcryptjs queue per process
    exam_list_latency: ['p(95)<25'], // [15.8]  3 read paths; 0.12 ms query + 0.02 ms N+1
    exam_start_latency: ['p(95)<25'], // [14.8] attempts pre-generated, so mostly a read
    answer_latency: ['p(95)<40'], // [23.1]
    flag_latency: ['p(95)<30'], // [22.0]
    heartbeat_latency: ['p(95)<30'], // [21.0]
    submit_latency: ['p(95)<120'], // [85.9] the 7-row grading write; disk-bound, not CPU-bound
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  noConnectionReuse: CONFIG.noConnectionReuse,
  batch: 20,
  batchPerHost: VUS,
  userAgent: 'k6-student-exam-path/1.0',
};

function headers(token, ip, cookie) {
  const h = {
    'Content-Type': 'application/json',
    // The load generator plays the part of Nginx. Without this the API compares the allowlist
    // against the loopback socket address and refuses every simulated lab machine with
    // LAB_NETWORK_REQUIRED before the request is ever measured.
    'X-Forwarded-For': ip,
  };
  if (token) h.Authorization = `Bearer ${token}`;
  if (cookie) h.Cookie = cookie;
  return h;
}

export function studentExamPath() {
  const index = exec.scenario.iterationInTest;
  const ip = labIpFor(index);
  const username = studentNameFor(index, fixture);

  // ---------------------------------------------------------------- arrival ramp
  // THE FIX for a measurement defect, and the reason this file looked like it had two
  // bottlenecks when it has one.
  //
  // The executor is per-vu-iterations with iterations: 1, so without this sleep every VU fires
  // its first request in the same millisecond and the run measures a thundering herd, not a
  // cohort. That is not the thing the header above promises to model (spec 11.2: the login
  // window is 1-2 minutes) and it was not what the archived runs measured either -- rampSeconds
  // used to feed only maxDuration, so the ramp it documented did not exist.
  //
  // Measured cost of the missing ramp, one process, exam_list only, no bcrypt on the path:
  //     1,000 VUs all at t=0  ->  718 of 1,000 connections REFUSED, p95 of the survivors 359 ms
  //     1,000 VUs over 30 s    ->    0 of 1,000 refused,          p95              9.7 ms
  //     3,000 VUs all at t=0  -> 2,726 of 3,000 REFUSED,          p95              328 ms
  //     3,000 VUs over 30 s    ->    0 of 3,000 refused,          p95              6.4 ms
  // A single Node process on this box admits about 270 simultaneous connections and the kernel
  // refuses the rest -- independently of bcrypt, on a completely idle event loop. Under a
  // realistic arrival rate that ceiling is never reached, and exam_list is 6 ms at 3,000
  // concurrent students. It is not a bottleneck; it was an artefact of arriving all at once.
  //
  // The stagger is a sleep inside the iteration rather than a ramping-vus executor on purpose:
  // a VU is one student and a student sits one exam once, so the arrival time has to vary
  // without the iteration count changing.
  if (CONFIG.rampSeconds > 0) {
    sleep((index / VUS) * CONFIG.rampSeconds);
  }

  // ---------------------------------------------------------------- login
  // Every VU logs in for real. bcrypt.compare at cost 10 is the most expensive thing in the
  // student path, and minting tokens in setup() instead would delete exactly the number spec
  // 11.2 most wants measured.
  const login = http.post(
    `${CONFIG.apiBase}/auth/login`,
    JSON.stringify({ username, password: fixture.password }),
    { headers: headers(null, ip), tags: { name: 'login', step: 'login' } },
  );

  loginLatency.add(login.timings.duration);
  loginFailures.add(login.status !== 200);

  const loggedIn = check(login, {
    'login: 200': (r) => r.status === 200,
    'login: token issued': (r) => !!(r.json('token') || '').length,
  });
  if (!loggedIn) {
    // A VU that cannot log in cannot take the exam. Continuing would report a start failure
    // for what is really a seed or password problem, 5,000 times over, which is unreadable.
    fail(`login failed for ${username} (status ${login.status})`);
  }
  const token = login.json('token');

  // ------------------------------------------------------------ exam list
  // The real client calls this before showing the start button. It sits above the lab-network
  // middleware (student-exams.ts mounts requireLabNetwork after GET /), so it is the one
  // student route that must keep working from home. Tagged apart for that reason.
  const list = http.get(`${CONFIG.apiBase}/student/exams`, {
    headers: headers(token, ip),
    tags: { name: 'exam_list', step: 'list' },
  });
  examListLatency.add(list.timings.duration);
  check(list, { 'exam_list: 200': (r) => r.status === 200 });

  // ---------------------------------------------------------------- start
  // The suspected bottleneck. Sampling already happened at approval, so what is left is the
  // eligibility check, the session update, and a read of the snapshot rows.
  const start = http.post(
    `${CONFIG.apiBase}/student/exams/${EXAM}/start`,
    JSON.stringify({ access_code: fixture.accessCode }),
    { headers: headers(token, ip), tags: { name: 'start', step: 'start' } },
  );

  startLatency.add(start.timings.duration);
  startAttempts.add(1);
  startFailures.add(start.status !== 200);
  if (start.status === 409 && /SESSION_ACTIVE_ELSEWHERE/.test(start.body || '')) {
    sessionElsewhere.add(1);
  }
  if (start.status === 403 && /LAB_NETWORK_REQUIRED/.test(start.body || '')) labRefused.add(1);
  if (start.status === 403 && /Invalid access code/.test(start.body || '')) wrongCode.add(1);

  const cookie = sessionCookieFrom(start);
  const started = check(start, {
    'start: 200': (r) => r.status === 200,
    'start: session cookie issued': () => !!cookie,
    'start: questions returned': (r) =>
      Array.isArray(r.json('questions')) && r.json('questions').length > 0,
    // The security invariant, asserted rather than assumed: FR-36 / spec 5.5 say the student
    // never sees a grade, and 4.4 says the snapshot must not leak the answer.
    'start: no correct_answer or grade leaked': (r) => {
      const qs = r.json('questions') || [];
      return qs.every((q) => q.correct_answer === undefined && q.grade === undefined);
    },
  });
  if (!started) return; // an attempt that never started cannot be answered or submitted

  const questions = start.json('questions');
  const cookieHeaders = headers(token, ip, cookie);

  // ------------------------------------------------- answer / flag / heartbeat
  // Time-driven rather than question-driven. A student sends a heartbeat every 30 s whether or
  // not they are answering anything (spec 5.4), and a 6-question exam held open for 5 minutes
  // is ten heartbeats and six answers, not six of each. Driving the loop off the question index
  // would have quietly measured a heartbeat rate of one-per-question instead.
  const loopStart = Date.now();
  const endAt = loopStart + CONFIG.examSeconds * 1000;
  const questionEvery = (CONFIG.examSeconds * 1000) / questions.length;
  // Tick finely enough that neither a question nor a heartbeat is ever more than one tick late.
  const tick = Math.max(500, Math.min(questionEvery, CONFIG.heartbeatIntervalMs) / 2);

  let nextQuestionAt = loopStart;
  let nextHeartbeatAt = loopStart;
  let qi = 0;
  let flagged = 0;

  while (Date.now() < endAt && qi < questions.length) {
    sleep(tick / 1000);
    const now = Date.now();

    if (now >= nextHeartbeatAt) {
      const beat = http.post(
        `${CONFIG.apiBase}/student/exams/${EXAM}/heartbeat`,
        null,
        { headers: cookieHeaders, tags: { name: 'heartbeat', step: 'heartbeat' } },
      );
      heartbeatLatency.add(beat.timings.duration);
      check(beat, { 'heartbeat: 200': (r) => r.status === 200 });
      // The heartbeat response is how a client learns the server auto-submitted an overdue
      // attempt, so a 200 here is not always a good outcome.
      if (beat.status === 200 && beat.json('status') === 'auto_submitted') {
        submitted.add(1);
        return;
      }
      if (beat.status === 409) {
        if (/SESSION_ACTIVE_ELSEWHERE/.test(beat.body || '')) sessionElsewhere.add(1);
        return; // the session is gone; nothing after this would be accepted
      }
      nextHeartbeatAt += CONFIG.heartbeatIntervalMs;
    }

    if (now >= nextQuestionAt) {
      const question = questions[qi];

      // Students choose from the options they were actually given. Grading compares option
      // TEXT, not index, so a value outside this list is a 400 and would measure the wrong
      // thing entirely. The `(qi + index)` rotation gives a spread of right and wrong answers
      // rather than 5,000 identical all-correct submissions.
      const options =
        Array.isArray(question.options) && question.options.length
          ? question.options
          : ['true', 'false'];
      const pick = options[(qi + index) % options.length];

      const answer = http.patch(
        `${CONFIG.apiBase}/student/exams/${EXAM}/answer`,
        JSON.stringify({ question_id: question.id, selected_answer: pick }),
        { headers: cookieHeaders, tags: { name: 'answer', step: 'answer' } },
      );
      answerLatency.add(answer.timings.duration);
      check(answer, { 'answer: 200': (r) => r.status === 200 });

      // Flagging is real but minority. It is a second write to the same table, so it carries
      // its own tag rather than being folded into the answer rate.
      if (flagged < CONFIG.flagMax && ((qi + index) % 10) / 10 < CONFIG.flagRate) {
        const flag = http.patch(
          `${CONFIG.apiBase}/student/exams/${EXAM}/flag`,
          JSON.stringify({ question_id: question.id, is_flagged: true }),
          { headers: cookieHeaders, tags: { name: 'flag', step: 'flag' } },
        );
        flagLatency.add(flag.timings.duration);
        check(flag, { 'flag: 200': (r) => r.status === 200 });
        flagged += 1;
      }

      qi += 1;
      // Advance the SCHEDULE, not the clock. `nextQuestionAt = now + every` quantised the next
      // slot to the tick boundary and so pushed it later every time: at a 300 s exam (tick 15 s,
      // one question per 50 s) the fifth question slid from 250 s to 305 s and the sixth was
      // never asked before the `endAt` guard fired. The run then submitted with a blank, hit the
      // server's 409 `unanswered_count` branch, and reported `attempts submitted: 0` and a
      // submit p(95) of 34 ms that was really the rejection -- a green-looking number measuring
      // the wrong endpoint. Anchored to loopStart, all six are answered with 45 s to spare.
      nextQuestionAt += questionEvery;
    }
  }

  // ---------------------------------------------------------------- submit
  // Reached only with every question answered, so the 409 "unanswered" branch is not what is
  // being measured here.
  const submit = http.post(
    `${CONFIG.apiBase}/student/exams/${EXAM}/submit`,
    null,
    { headers: cookieHeaders, tags: { name: 'submit', step: 'submit' } },
  );
  submitLatency.add(submit.timings.duration);
  check(submit, {
    'submit: 200': (r) => r.status === 200,
    // FR-36: the submission response carries no grade. Asserted on every single submit, so a
    // regression that started returning one would fail the run rather than pass quietly.
    'submit: no grade in response': (r) => !/\b(total_grade|grade_awarded)\b/.test(r.body || ''),
  });
  if (submit.status === 200) submitted.add(1);
}

export function handleSummary(data) {
  const m = data.metrics;
  const n = (name, field) => (m[name] && m[name].values ? m[name].values[field] : 0);
  // A Count for "attempts started", not a field off the Trend. In k6 v2 a Trend's `values`
  // object carries only avg/min/med/percentiles/max -- no `count` -- so reading one printed
  // "undefined" and the summary quietly under-reported the most important number in the run.
  const attemptsStarted = n('exam_start_attempts', 'count');
  const startFailRate = n('exam_start_failures', 'rate');
  const loginFailRate = n('login_failures', 'rate');
  // One line per step: p(95) is the number a threshold can be written against, and the spread
  // between them is the finding. p(99) is included because a queue that only shows up in the
  // last percentile is exactly what a login storm looks like.
  const row = (label, metric) => {
    const m2 = metric;
    if (!m2 || !m2.values) return `  ${label.padEnd(24)} (not reached)`;
    return `  ${label.padEnd(24)} p(95)=${String(m2.values['p(95)']).padEnd(10)} p(99)=${String(
      m2.values['p(99)'],
    ).padEnd(10)} max=${m2.values.max}`;
  };
  const header = [
    '\n=== student exam path ===',
    `  VUs (students):          ${VUS}`,
    `  simulated exam:          ${CONFIG.examSeconds}s, ramp ${CONFIG.rampSeconds}s`,
    `  attempts started:        ${attemptsStarted}`,
    `  attempts submitted:      ${n('exam_submitted', 'count')}`,
    `  total requests:          ${n('http_reqs', 'count')}`,
    `  start failure rate:      ${typeof startFailRate === 'number' ? startFailRate.toFixed(4) : startFailRate}`,
    `  login failure rate:      ${typeof loginFailRate === 'number' ? loginFailRate.toFixed(4) : loginFailRate}`,
    `  SESSION_ACTIVE_ELSEWHERE: ${n('exam_session_elsewhere', 'count')}`,
    `  LAB_NETWORK_REQUIRED:    ${n('exam_lab_refused', 'count')}`,
    `  wrong access code:       ${n('exam_wrong_access_code', 'count')}`,
    '',
    '  per-step latency (ms):',
    row('login', m.login_latency),
    row('exam_list', m.exam_list_latency),
    row('start', m.exam_start_latency),
    row('answer', m.answer_latency),
    row('flag', m.flag_latency),
    row('heartbeat', m.heartbeat_latency),
    row('submit', m.submit_latency),
    '',
  ].join('\n');
  return {
    stdout: header + textSummary(data, { indent: '  ', enableColors: true }),
    // Written by k6 itself under this run's own name -- see RUN_LABEL in lib/config.js for why
    // nothing renames it afterwards. CWD-relative, so it lands wherever k6 was launched from; the
    // runner script cds into infra/k6 so the artefacts collect in one place.
    [`${RESULTS_DIR}/${RUN_LABEL}.json`]: JSON.stringify(data, null, 2),
  };
}
