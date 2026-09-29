// Mints load-test student JWTs directly, so a diagnostic can measure the DATABASE path
// without putting bcrypt on the measured path.
//
//   node infra\k6\mint-tokens.mjs [count] [outfile]
//
// Why this exists. list-only.diagnostic.js needs thousands of valid tokens. A k6 setup()
// that logs in 3,000 students would spend 3000 x ~60 ms = ~3 minutes of pure CPU minting them,
// because bcryptjs is single-threaded. For an experiment about query cost, spending three
// minutes on authentication is backwards. requireAuth only verifies the signature and re-reads
// the user row, so a correctly signed token is indistinguishable from a login-issued one --
// and that equivalence is verified against a real /auth/me call before any measured number is
// believed, not assumed from reading auth.ts.
//
// The id pattern is copied from seed/01-fixture.sql:
//   '4' || lpad(i::text, 7, '0') || '-0000-4000-8000-000000000000'
// It was checked against a real seeded row (lt_stu_02128 -> 40002128-0000-4000-8000-000000000000)
// before being relied on. If the seed ever changes its id scheme this script goes wrong
// silently and every token 401s, which is loud rather than subtle -- but re-check it first.
//
// SCOPE: this signs student tokens with the app's own secret so a load test can bypass the
// password check. It is a developer load-test helper, not part of the product, and it must
// never be copied into apps/api.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

// jsonwebtoken lives in the repo's hoisted node_modules, which is not on the resolution path
// for a script run from elsewhere. Resolve it against apps/api explicitly.
const require = createRequire(path.join(root, 'apps', 'api', 'package.json'));
const jwt = require('jsonwebtoken');

const envPath = path.join(root, 'apps', 'api', '.env');
if (!fs.existsSync(envPath)) {
  console.error(`No ${envPath}. The app reads its config from there; so does this script.`);
  process.exit(1);
}

const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

if (!env.JWT_SECRET) {
  console.error('apps/api/.env has no JWT_SECRET.');
  process.exit(1);
}

const count = Number(process.argv[2] || 3200);
// Deliberately OUTSIDE the repo. results/ is committed, and a file of valid student tokens
// should never be a candidate for a commit even if a later .gitignore entry is forgotten.
// They are also short-lived (8h) and worthless outside a local run, so the temp dir costs
// nothing.
const out = process.argv[3] || path.join(os.tmpdir(), 'lt-tokens.json');

if (!Number.isInteger(count) || count < 1) {
  console.error(`count must be a positive integer, got ${process.argv[2]}`);
  process.exit(1);
}

const tokens = [];
for (let i = 1; i <= count; i += 1) {
  const id = `4${String(i).padStart(7, '0')}-0000-4000-8000-000000000000`;
  tokens.push(jwt.sign({ userId: id, role: 'student' }, env.JWT_SECRET, { expiresIn: '8h' }));
}

fs.writeFileSync(out, JSON.stringify(tokens), 'utf8');
console.log(`wrote ${tokens.length} student tokens -> ${out}`);
console.log('verify one before trusting it:');
console.log(`  $t = (Get-Content '${out}' -Raw | ConvertFrom-Json)[0]`);
console.log('  Invoke-RestMethod http://localhost:4001/api/v1/auth/me -Headers @{ Authorization = "Bearer $t" }');
