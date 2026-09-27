# Audit remediation execution index

**Status:** design and implementation plans approved; remediation execution is in progress. The planning commit itself did not change product code.

Implement four ordered slices on `codex/audit-remediation`, preserving existing hardening and proving money, authorization and offline behavior with real infrastructure. This is delegated-direct work, not SDD and not receipt-driven review.

## Execution order

| Order | Plan | Result |
|---|---|---|
| 1 | [Authorization and sessions](2026-09-27-remediation-01-auth-sessions.md) | Reuse recorded hardening, repair tenant projection, enforce actor policy, coordinate sessions, real auth integration harness |
| 2 | [Orders and money](2026-09-27-remediation-02-money.md) | Transactional orders/shifts, explicit receipts, physical cash separation, recoverable provider reconciliation |
| 3 | [Offline and realtime](2026-09-27-remediation-03-offline-realtime.md) | Durable commands, failed-command recovery, authoritative reconnect snapshots and committed events |
| 4 | [Operational completeness](2026-09-27-remediation-04-operations.md) | Installable operational shell, receipt-date reports, invitation console, safe seed, browser/CI verification |

Read the [approved design](../specs/2026-09-27-audit-remediation-design.md) with every slice. Each task carries its tests and documentation. Money schema migration is additive but has a rollout gate: ambiguous existing open shifts must be reconciled or closed under the old release before new cash semantics go live. Unknown historical payment method/date remains unknown.

## Working rules

- Root coordinates one narrow writer for a nontrivial multi-file task; integration and plan self-check remain local. Do not dispatch receipt reviewers or activate a disabled review switch.
- Read relevant execution/TDD/debugging/verification skills before implementing their tasks. Use worktree isolation when needed, preserve unknown working changes, and never reset/rewrite `main`.
- Execute approved tasks with red/green checks and commit reviewable work units. Plans are references, not proof of passing tests.
- Use `corepack pnpm` and verify version `9.1.2` before installation; do not invoke the host's unrelated pnpm runtime. Frozen install at reuse; deliberate dependency additions regenerate lock through that version.
- No push, deploy, external provider account/settings mutation or automatic evidence backfill. Use local disposable PostgreSQL/Redis and fake provider responses in tests.
- Receipt-driven delivery status is `disabled/unmanaged`, not approved. No invented assertions about live remote state or provider settlement.
- Extend existing neutral Spanish UI; technical planning artifacts are English. Conventional commits only, no AI attribution.

## Coverage ledger

| Audit concern | Owning tasks | Evidence required |
|---|---|---|
| Newer hardening tenant projection regression / stale local main | 01.1–2 | Reused history; full-JWT HTTP regression |
| Branch bypass and unauthorized state/catalog/table actions | 01.2–3, 02.2 | Signed actor HTTP/service tests and foreign-tenant rejection |
| Refresh race, failed mint, stale logout/session callbacks | 01.3–6, 04.5 | Transaction rollback, real DB race, actual multitab refresh |
| Socket stale credentials, expired branch-room membership | 01.5, 03.4–5, 04.5 | Fake-clock expiry plus real reconnect/current-token browser |
| Duplicate cash shifts, movement/close race | 02.1, 02.3 | PostgreSQL unique constraint and forced race orderings |
| State/occupancy lost updates, duplicate active table orders | 02.2 | Version conflicts, branch-lock contention and table invariant |
| Order idempotency race, changed-payload retries | 02.2 | Parallel PostgreSQL creates and canonical fingerprint conflict |
| Invalid quantities, blank delivery, unavailable dishes, money overflow | 02.2–3 | Boundary tests and transactional catalog reads |
| Cash versus digital confusion / unknown legacy history | 02.1, 02.3, 04.2 | Drawer arithmetic, immutable close snapshots, safe migration |
| Provider amount/currency/association validation and poisoned retry | 02.4 | Signed webhook HTTP, crash/retry, receipt uniqueness and visible incidents |
| Offline command deletion, crash between writes, no retry | 03.1–3 | Durable outbox unit and actual IndexedDB reload/retry |
| Branch-scoped local data / ambiguous legacy storage | 03.1–2, 04.5 | Tenant switch cancellation and quarantine/export migration |
| Missing CRUD/availability/cash signals and snapshot recovery | 03.4–5 | Committed publish tests, deleted-row and reconnect browser |
| Missing operational install/offline cold reload/safe updates | 04.1, 04.5 | Production shell, browser cold reload and pending-input update gate |
| Reports use creation date/server timezone/int32 aggregates | 04.2 | Receipt timestamp, DST/branch boundaries, safe large totals |
| Staff invitation backend not usable in console | 04.3, 04.5 | Admin create/accept, nonadmin denial, stale callback protection |
| Name-based/destructive/nonatomic demo seed | 04.4 | Fixed identity, environment gate, transaction rollback, repeat seed |
| Mock-only CI and documentation overclaims | All tasks, 04.5 | Real service/browser jobs and finding-to-test traceability |

## Final acceptance gate

- [ ] Every ledger row points to an executed test and its actual output; no required suite silently skipped.
- [ ] Shared/API/operativa unit tests, dedicated PostgreSQL/Redis integration tests, browser acceptance, lint and production builds pass.
- [ ] Database migrations tested on clean and representative legacy fixtures; open-shift rollout gate and historical unknowns documented.
- [ ] Authentication, receipts, branches and local command recovery verified together; no fake order ID submitted as a server order.
- [ ] Committed receipt/command data is preserved by update and rollback policy; no receipt deletion used to fake a successful downgrade.
- [ ] `git diff --check` passes; no secrets, generated caches or unrelated files staged.
- [ ] Only then summarize changed files, actual checks and remaining external/unverified limitations. Use finishing-branch guidance without pushing or deploying automatically.

## Execution evidence

Planning baseline: audited old `main` at `054019a`; 207 API tests and 17 shared tests passed, four workspace typechecks passed. These runs did not exercise PostgreSQL/Redis races, browser offline reload or real payment delivery and are **not** acceptance evidence for the future remediation branch.

Recorded hardening source: locally available `8d1b3ed`, eighteen commits ahead of the audited main. No fresh remote fetch verified during planning. Design documentation committed at `cbf97e5`.

During execution, append each task's commit, exact command, tool version, exit status/test totals and environmental limitations here. Keep an unexecuted or blocked task unchecked and state its cause; never substitute a passing mock suite for required real infrastructure.

### 2026-09-27 — Slice 01 baseline reuse

- Merged locally recorded `8d1b3ed` into `codex/audit-remediation` with `git merge --no-ff`; no remote fetch, push or `main` mutation. The checkout was clean before merge.
- `corepack pnpm --version` → `9.1.2` with `COREPACK_HOME` in the OS temporary directory. `corepack pnpm install --frozen-lockfile` → exit 0. The default Corepack cache had EPERM; network access to download pnpm was permitted only for the escalated command. No lockfile change from install.
- Regenerated Prisma using `apps/api/node_modules/.bin/prisma.cmd generate --schema prisma/schema.prisma` → exit 0. The planned `corepack pnpm --filter api exec prisma generate` wrapper failed to resolve the command on this Windows host despite the binary existing; direct declared local binary was used.
- API Jest `apps/api/node_modules/.bin/jest.cmd --runInBand --silent` → **20 suites, 223 tests passed**, exit 0. Shared Jest `packages/shared/node_modules/.bin/jest.cmd --runInBand` → **1 suite, 18 tests passed**, exit 0.
- `tsc --noEmit` for shared, API, operativa and web → exit 0 each, after building `packages/shared` once to refresh its generated declarations. Web's first run failed on the old declaration artifact (`acceptInvitation` missing); the current source exports it. The API's first run failed on stale Prisma types and unreadable newly installed `@nestjs/throttler` junction; regeneration and escalated verification resolved those environment failures.
- Official `corepack pnpm -r lint` → exit 0 for API, shared, operativa and web under pnpm `9.1.2`. The test commands above used installed local Jest binaries because this Windows host initially failed to resolve `prisma` through `corepack pnpm --filter api exec` despite the local binary existing.
- The baseline verification above is unit/typecheck evidence only. At the time it ran, no PostgreSQL/Redis race, browser offline session or provider acceptance had run.

### 2026-09-27 — Slice 01 refresh rotation

- Commit `3a1b173` moves conditional old-token consumption, branch ownership validation and replacement creation into one Prisma transaction.
- TDD regression tests first failed on nontransactional mint, concurrent double use, cross-organization branch and expiry not in the conditional update; after implementation, focused API Jest `auth.service` → **1 suite, 22 tests passed**, exit 0. Root independently repeated the focused command with the same result.
- Real PostgreSQL concurrency/rollback evidence is pending task 01.6; a mocked transaction test does not prove database rollback.

### 2026-09-27 — Slice 01 tenant policy, session and integration harness

- Task 01.2 commit `1731a4e`: signed-JWT HTTP regression and actor policy. Root reran API → **24 suites, 269 tests passed**, API `tsc --noEmit` exit 0.
- Task 01.4 commit `c143550`: canonical validated session, complete legacy-key migration, tab-lock/single-flight refresh, generation guards, HTTP errors and abort signal. Shared build + Jest → **2 suites, 35 tests passed**, exit 0. A new anonymous-request→login-before-response test failed first by resolving stale data, then passed after guarding generation for anonymous requests too.
- Task 01.6 commit `317dc93`: disposable Docker services, real Nest application/Jest harness and Redis adapter cleanup. Initial HTTP integration boot exposed that dynamic `ThrottlerModule` could not resolve `RedisThrottlerStorage` declared only in the parent AuthModule. After extracting/exporting the storage module and importing it into the dynamic module, disposable Postgres 16/Redis 7 applied 13 migrations and HTTP tests passed: **1 suite, 3 tests** for single-winner concurrency, insert-failure rollback and branch binding. API unit tests → **24 suites, 269 tests passed**, API typecheck exit 0.
- Test infrastructure is isolated under Compose project `comanda-remediation-test`, database `comanda_test`, ports 55432/56379. Keep it isolated for money migration tests and remove only that compose project afterward.
- Task 01.5 frontend migration/socket expiry and combined browser acceptance remain pending; mocked/unit socket tests are not multitab browser evidence.

## Next step

Continue plan 01 task 5 frontend migration, then begin plan 02. No additional design ceremony or automatic SDD artifacts are required.
