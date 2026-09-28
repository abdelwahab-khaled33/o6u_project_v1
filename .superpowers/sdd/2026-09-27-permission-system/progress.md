# SDD ledger — plan: C:\Users\user\Desktop\o6u_project_v1\docs\superpowers\plans\2026-09-27-permission-system.md

Pre-flight: Task 1 produces the shared PermissionKey/defaults consumed by Task 2; Task 2 produces resolvePermission consumed by Task 3; Task 4 consumes Task 1 defaults. Interfaces agree with the plan and spec.

Ruling: The supplied workspace has no `.git` metadata, so task commits, a Git diff, and the skill's Git-backed workspace scripts are unavailable; implementation and verification proceed in place — cost if wrong: no commit-level recovery record.
Task 1: complete (no Git base available; tests: npm test -w @exam/api -- permissions.test.ts -> 5/5 pass)
Task 2: complete (no Git base available; tests: npm test -w @exam/api -- permissions.test.ts -> 5/5 pass)
Task 3: complete (no Git base available; tests: npm run typecheck -> pass)
Task 4: complete (no Git base available; tests: npm exec -w @exam/api prisma validate -> schema valid)
Final: fixed missing active-account enforcement on direct permission paths — `denies an inactive account even when its permission row allows the action` RED->GREEN, focused suite 6/6.
Final: fixed missing `exams.manage_all` checks on Admin cross-owner exam detail and session release — reviewed conditional gates added to both branches; focused suite 6/6.
Final: Ruling: JWT role claims remain authoritative until token expiry — this is pre-existing behavior of `requireRoles`, and changing role freshness/session revocation exceeds the explicitly scoped permission matrix work — cost if wrong: a demoted user retains claim-based role access until their token expires.
Final: minor (deferred): Route-level gate regression tests were not added because the requested test scope limits this task to pure resolver and mocked Prisma behavior; the service-level regression test covers the new active-account helper.
