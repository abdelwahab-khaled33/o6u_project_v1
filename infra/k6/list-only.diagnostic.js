// Isolation diagnostic -- separates the exam_list query from bcrypt queueing.
// Kept deliberately, not discarded: it is the reproducible proof for the finding that
// exam_list was never a bottleneck, and that finding is what justifies a threshold budget.
// Run it before re-deriving any budget, so the premise is re-checked rather than inherited.
//
// The archived runs (infra/k6/results/) show exam_list p95 = 7,383 ms at 100 VUs on one
// process, but 11.6 ms at 1 VU. Those two numbers are consistent with two completely
// different root causes, and they cannot be told apart from the archived run alone:
//
//   (a) the query in routes/student-exams.ts:28-78 is genuinely slow, or
//   (b) the request is fine and is simply queued behind bcrypt on the single JS thread,
//       which blocks the loop for its whole ~82 ms duration.
//
// This script measures (b) directly. Every VU issues exactly one GET /student/exams and
// NOTHING else -- no login is on the measured path -- so the latency it reports is the
// query plus the connection pool, uncontended by any CPU-bound work.
//
// Tokens are pre-minted (see mint-tokens.mjs) rather than obtained from a setup() login,
// because 3,000 sequential logins would cost 3000 x 82 ms = 246 s of pure bcrypt before the
// first measured request. That is backwards for an experiment about the database path.
// requireAuth only verifies the signature and re-reads the user row, so a correctly signed
// token is indistinguishable from a login-issued one here -- and that is verified with a
// real /auth/me and /student/exams call before any number below is believed.
//
// It also answers the question the deployment runbook leaves open: is exam_list "the next
// thing to break" at 5,000 VUs? Run it with -e VUS=3000 to find out rather than assume.

import http from 'k6/http';
import exec from 'k6/execution';
import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { CONFIG, labIpFor } from './lib/config.js';

// The init-context `open` is synchronous. Relative paths resolve against THIS module, so the
// runner must pass an absolute TOKENS= path.
const TOKENS = JSON.parse(open(__ENV.TOKENS));

const VUS = CONFIG.vus;
const RAMP_MS = Number(__ENV.RAMP_MS || 0);

// Fail loudly at load time rather than 401-ing 3,000 times. TOKENS[i] out of range produces an
// Authorization header of "undefined", which the server rejects for a reason that has nothing
// to do with the thing being measured -- the exact failure mode this script exists to avoid.
if (!Array.isArray(TOKENS) || TOKENS.length < VUS) {
  throw new Error(
    `VUS=${VUS} but TOKENS holds ${Array.isArray(TOKENS) ? TOKENS.length : 'a non-array'}. ` +
      `Re-mint with enough: node infra\\k6\\mint-tokens.mjs ${VUS}`,
  );
}

const listLatency = new Trend('exam_list_only', true);
const listFailures = new Counter('exam_list_only_failures');
const listEmpty = new Counter('exam_list_empty');

// Two arrival shapes, because "it refused 85% of connections" has two completely different
// meanings depending on which one produced it:
//
//   RAMP_MS=0  every VU fires in the same millisecond. This is what the archived runs do, and
//              it measures whether the process can ADMIT a burst.
//   RAMP_MS>0  VU i sleeps i/VUS * RAMP_MS before its request, so arrivals spread over the
//              window while each VU still issues exactly ONE request. This measures whether
//              the process can SERVE that many students, which is the question the deployment
//              plan actually needs answered.
//
// The stagger is a sleep inside per-vu-iterations rather than a ramping-vus executor on
// purpose: ramping-vus re-runs the function for the whole stage, so each "VU" would send many
// requests instead of one, and a VU is supposed to be one student.
// If the refusals vanish under a ramp, they are a listen-backlog artefact of simultaneous
// connects, not a capacity ceiling, and the two must never be reported as the same number.
export const options = {
  scenarios: {
    list_only: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: `${Math.ceil(RAMP_MS / 1000) + 300}s`,
      gracefulStop: '30s',
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  noConnectionReuse: CONFIG.noConnectionReuse,
  batch: 20,
  batchPerHost: VUS,
  userAgent: 'k6-list-only-diagnostic/1.0',
};

export default function () {
  const i = exec.scenario.iterationInTest;
  if (RAMP_MS > 0) sleep((i / VUS) * (RAMP_MS / 1000));
  const res = http.get(`${CONFIG.apiBase}/student/exams`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': labIpFor(i),
      Authorization: `Bearer ${TOKENS[i]}`,
    },
    tags: { name: 'exam_list_only' },
  });
  listLatency.add(res.timings.duration);
  listFailures.add(res.status !== 200);
  const exams = res.json('exams');
  listEmpty.add(Array.isArray(exams) && exams.length === 0);
}
