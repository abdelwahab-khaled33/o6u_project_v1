// Shared load-test configuration.
//
// Everything is __ENV-driven so one script serves the calibration run, the capacity ramp and
// the sustained 5,000-VU run without editing a literal. That matters for threshold setting:
// the thresholds in student-exam-path.js are derived from observed data, and re-deriving them
// has to be a re-run of the same file, not a fork of it.

// The default is relative to THIS file, not to the entry script: k6 resolves a relative
// `open()` path against the module that calls it, so './seed/fixture.json' from lib/config.js
// looks for infra/k6/lib/seed/fixture.json and fails with a bare "path not found". The runner
// script always passes an absolute path via -e FIXTURE=, so this default only has to be right
// for someone running k6 by hand from the repo root.
const FIXTURE_PATH = __ENV.FIXTURE || '../seed/fixture.json';

let cached = null;

export function loadFixture() {
  if (cached) return cached;
  // The init-context `open` global, which is SYNCHRONOUS. Do not import `open` from
  // k6/experimental/fs here: that one is async and returns a Promise, so `JSON.parse` would
  // be handed the string "[object Promise]" and fail with a baffling
  // "invalid character 'o' looking for beginning of value" -- 'o' being the second character
  // of "[object Promise]". The init context runs once per k6 process, so a module-level cache
  // is all the de-duplication this needs; SharedArray would be ceremony for nothing here.
  cached = JSON.parse(open(FIXTURE_PATH));
  return cached;
}

function intEnv(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`${name} must be an integer, got ${raw}`);
  return n;
}

export const CONFIG = {
  apiBase: __ENV.API_BASE || 'http://localhost:4001/api/v1',

  // How many VUs. Defaults to the whole seeded cohort: one VU per student, because an
  // attempt is per-student, so this is what actually seats N concurrent students.
  vus: intEnv('VUS', 0), // 0 = "use the fixture's studentCount"

  // Simulated seconds each student spends in the exam. The VU stays alive this long, so this
  // is the real duration of the sustained-load phase. 300s is a plausible exam.
  examSeconds: intEnv('EXAM_SECONDS', 300),

  // Ramp-up. Students do not appear in the lab instantaneously; the exam start window in
  // practice is 1-2 minutes for a cohort (spec 11.2), and a zero-second ramp measures a
  // thundering herd rather than the real thing.
  //
  // This value is HONOURED by the scenario: VU i sleeps i/VUS * rampSeconds before its first
  // request. It used to feed only maxDuration, so the ramp described here did not exist and
  // every archived run was a burst -- see the arrival-ramp block in student-exam-path.js for the
  // measurements that showed what that cost. Setting it to 0 is legitimate and is how the
  // admission ceiling is measured, but it is not a production shape.
  rampSeconds: intEnv('RAMP_SECONDS', 60),

  // A student's pace. One question every QUESTION_INTERVAL_MS, heartbeat every
  // HEARTBEAT_INTERVAL_MS, which is the 30s the spec fixes (5.4).
  questionIntervalMs: intEnv('QUESTION_INTERVAL_MS', 20000),
  heartbeatIntervalMs: intEnv('HEARTBEAT_INTERVAL_MS', 30000),

  // Fraction of students who flag a question, and of those, how many they flag.
  flagRate: Number(__ENV.FLAG_RATE ?? 0.3),
  flagMax: intEnv('FLAG_MAX', 2),

  // First two octets of the simulated lab network. Must match LAB_IP_RANGES on the API, or
  // every request is refused with LAB_NETWORK_REQUIRED before it is ever measured.
  labPrefix: __ENV.LAB_PREFIX || '10.20',

  // Which student in the seeded cohort this run starts from.
  //
  // A ramp needs each step to use students nobody has already sat the exam with: the second
  // attempt at an already-submitted exam answers 409 "already submitted", which would be read as
  // a capacity failure when it is really a stale-fixture artefact. Offsetting the window instead
  // of re-seeding between every step means the whole ramp runs against ONE seeded cohort, so the
  // only thing changing between steps is the number of concurrent students.
  studentOffset: intEnv('STUDENT_OFFSET', 0),

  timeout: __ENV.REQUEST_TIMEOUT || '30s',
  noConnectionReuse: __ENV.NO_CONNECTION_REUSE === 'true',
};

export const VUS = CONFIG.vus > 0 ? CONFIG.vus : loadFixture().studentCount;

// Where handleSummary writes the machine-readable artefact. CWD-relative on purpose: the
// runner script changes into infra/k6 before invoking k6, so 'results/' resolves to
// infra/k6/results/ regardless of where the repo lives.
export const RESULTS_DIR = __ENV.RESULTS_DIR || 'results';

// Name this run's artefact gets, so two concurrent k6 processes can share a RESULTS_DIR.
//
// This is not tidiness. The first version wrote a fixed summary.json and let run.ps1 rename it
// afterwards, which is a race: with one k6 process per API instance, process A's rename step
// grabbed process B's summary.json because B's k6 had just exited and A's rename ran first.
// One cluster leg lost its machine-readable summary that way while its console output looked
// perfectly complete -- so the fix is for k6 itself to write the final name, never for a second
// process to move it.
export const RUN_LABEL = __ENV.RUN_LABEL || 'run';

// A stable, distinct lab address per VU.
//
// "Distinct" is for fidelity, not to avoid the 409: the device session is bound per attempt,
// and every VU owns a different student, so all VUs could share one address without ever
// tripping SESSION_ACTIVE_ELSEWHERE. What distinctness buys is that the CIDR parser and the
// `requestIp !== sessionIp` comparison in evaluateDeviceSession are exercised across
// thousands of real addresses instead of one, which is what the lab deployment actually does
// (spec 11.5: distinct IP per machine, no NAT).
//
// "Stable" is what matters for correctness: the address is derived from the iteration index
// and never changes, so session_ip recorded at start still matches on every later request.
// A VU that rotated its IP mid-exam would get 409 SESSION_ACTIVE_ELSEWHERE, which is the
// real failure mode this design has to avoid.
export function labIpFor(index) {
  const perThirdOctet = 254; // stay clear of .0 and .255
  const i = index + CONFIG.studentOffset;
  const third = Math.floor(i / perThirdOctet);
  const fourth = (i % perThirdOctet) + 1;
  return `${CONFIG.labPrefix}.${third}.${fourth}`;
}

export function studentNameFor(index, fixture) {
  const n = String(index + 1 + CONFIG.studentOffset).padStart(5, '0');
  return `${fixture.studentPrefix}${n}`;
}

// Pulls the session cookie out of Set-Cookie.
//
// k6's cookie jar would do this, but doing it by hand keeps the token visible in the script
// next to where it is sent, and the token is rotated on every resume (student-exams.ts), so
// the value that is sent is never the one that was first issued after a resume.
export function sessionCookieFrom(response) {
  const setCookie = response.headers['Set-Cookie'] || [];
  const raw = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const entry of raw) {
    if (typeof entry === 'string' && entry.startsWith('exam_session_token=')) {
      return entry.split(';')[0];
    }
  }
  return null;
}
