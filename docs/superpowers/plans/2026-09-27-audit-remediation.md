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
- [x] Shared/API/operativa unit tests, dedicated PostgreSQL/Redis integration tests, 12 local browser journeys, lint and production builds pass (latest local run; remote CI remains unrun).
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
- Task 01.5 frontend/session binding committed as `f0d6a4b`: both frontends consume the validated shared `comanda.session`; role-aware UI uses dedicated availability/occupancy endpoints; Socket.IO obtains the current token at each handshake, refreshes before reconnect, and the API disconnects sockets at verified JWT expiry while clearing early-disconnect timers. Architecture/offline docs updated.
- Task 01.5 verification: shared Jest after the retry follow-up → **2 suites, 44 tests passed**; shared TypeScript build, web and operativa `tsc --noEmit`, realtime gateway Jest (**1 suite, 8 tests**) and `git diff --check` all exit 0. Commit `f22d244` adds capped transient refresh retries, online/focus recovery, and explicit socket/timer cleanup. Browser/multitab acceptance remains pending plan 04; whole-workspace API lint is temporarily blocked by the planned Task 02.1 payment-attempt schema change and is rerun after Task 02.4.
- Task 02.1 committed as `43d51ee`: additive receipt/attempt schema and migration, guarded preflight/backfill scripts, tenant-checked branch lock. Root reran disposable PostgreSQL migration suite → **1 suite, 4 tests passed**. `prisma validate` and `prisma generate` exit 0.
- **Ruling:** PostgreSQL 16 rejects use of a newly added enum value in a partial index within the same Prisma migration transaction (`55P04`); text casts are not immutable (`42P17`). Split `creando`/`incidente` enum additions into `20260927005900_money_payment_states` before `20260927010000_money`; migration rollback was verified clean.
- **Ruling:** Do not add a temporary PagosService shim for Task 02.1. Schema pluralizes Pago attempts, makes preference URLs nullable, and requires a stable external reference; shimmed Pedido-ID references/guessed URLs would violate the approved Task 02.4 contract. The five corresponding API type errors and one blocked Pagos suite are explicitly deferred until Task 02.4; Prisma validation/generation and migration integration remain Task 02.1's focused exit evidence.
- Task 02.2 committed as `9e491b3`: branch-serialized order/table/catalog writes, canonical idempotency fingerprints, actor/tenant validation, input bounds and availability, expected-version fulfillment, receipt-aware state handling, and shared/web/operativa callers. Root reran the PostgreSQL orders integration against the disposable database → **1 suite, 7 tests passed**. Implementer additionally reports focused API unit tests **7 suites, 83 tests**, shared **38 tests + build**, and web/operativa TypeScript checks passed. API typecheck remains deferred to Task 02.4 for the five known old payment-service errors; no RxDB v1 version bump, deletion, or migration was made.
- **Ruling for Task 02.3 response fields:** expose `cobrosDigitalesSinTurno:number` as the tenant/branch count of Mercado Pago receipts with no cash shift, and `pedidosLegacySinCobro:number` per shift as pedidos still linked through legacy `turnoCajaId` but with no receipt. This makes the design's separate unassigned-digital and unresolved-legacy signals explicit without inventing tender or date evidence; cost if wrong is a small response-contract rename before reporting consumers depend on it.
- Task 02.3 committed as `5b07938`: branch-serialized cash/open/movement/close, idempotent same-amount close and cash replay, receipt-based safe-range `BigInt` totals, separate cash/digital/sales amounts, visible unassigned/legacy counts, and a real `postDigital` primitive for Task 02.4. Root reran Caja + Pedido PostgreSQL integration → **15 + 7 tests passed**; focused Caja/Pedido unit tests → **25 passed**; shared → **50 tests plus build/typecheck**; web TypeScript check and commit `git diff --check` passed. Implementer reports 77 focused API unit tests. API typecheck still has only the five Task 02.4 `pagos.service.ts` failures; provider changes were not included in this commit.
- Task 02.4 committed as `fb1005c`: UUID checkout attempts, external preference recovery/search with full pagination, merchant/currency/amount/reference/preference verification, durable incidents, safe approval replay, cash collision handling, explicit admin recovery and transient webhook 503. Real fake-provider/PostgreSQL + signed Nest HTTP integration → **24/24**; payment/adapter/runtime units → **9/9**; shared → **52 tests + build/typecheck**, web and operativa typechecks passed. Root reran the complete disposable API integration suite → **5 suites, 53 tests passed**; complete API unit suite → **25 suites, 193 tests passed**; API `tsc --noEmit` passed. Root also ran `corepack pnpm --version` → **9.1.2**, then workspace `turbo run lint` and `turbo run build` → **all 5 lint and 4 build tasks succeeded**. On this Windows host, installed dependency junctions required elevated local verification; sandbox-only attempts could not resolve `@nestjs/throttler`.
- Full API unit rerun found a stale signed-actor test fixture after branch-locked service and `CobrosService` additions; root fixed it test-first/RED→GREEN and committed only `apps/api/src/auth/tenant-http.spec.ts` as `96d847f` (`test: update tenant fixture for transactional services`). No production regression was hidden.
- **Ruling for plan 03 legacy storage discovery:** history contains three recognized IndexedDB naming generations (`comanda-operativa`, organization-keyed, current org+sucursal-keyed), not just the immediately previous tenant database. Recovery/export may enumerate only these known patterns; no ambiguous organization-only command is rebound to the active branch. Keep raw records exportable/quarantined until user verification/server validation. Refresh the old offline spec during Task 03 to distinguish transient (retry) from permanent (recoverable failed) HTTP errors per the approved design.
- Plan 03 Task 1 committed as `2db3bd4`: durable outbox-before-projection, startup projection rebuild, v1 Pedido and outbox migration, proof-gated tenant assignment/quarantine, read-only legacy export, and visible pending count. Root verified Operativa Jest → **2 suites, 11 tests**, lint/typecheck and Vite build → exit 0; `git diff --check` passed. Actual browser IndexedDB migration remains pending Plan04; transient send/retry is Task 2. Updating the manifest required pnpm 9.1.2 lock-only then frozen install; a forced frozen reinstall repaired a local partial `ts-jest` extraction before verification.
- Plan 03 Task 2 committed as `cc45060`: tenant-keyed singleflight + Web Locks where supported, abortable requests and session/tenant-generation guards, bounded retry with Retry-After, permanent-error recovery state, authoritative response validation and local persistence before projection removal, plus online/focus/visibility/socket/timer triggers. TDD regression for a previously persisted `auth_required` command first showed a later command being POSTed on a new flush; a queue-wide tenant gate now blocks all commands until session notification. Root independently verified Operativa Jest → **2 suites, 37 tests**, shared Jest → **2 suites, 52 tests**, TypeScript checks, Vite/shared builds and `git diff --check` → exit 0. Real browser IndexedDB, multi-tab locks and socket reconnection remain pending Plan04.
- Plan 03 Task 3 committed as `60d79e7`: Mozo sees durable pending/failed commands even without optimistic projections, can retry with the same immutable request key/input, and can confirm local discard; retries/discards/flush share tenant queue/Web Lock and recheck authoritative rows. Cocina excludes optimistic/unversioned Pedidos. Root verified Operativa Jest → **2 suites, 44 tests**, typecheck, Vite build and `git diff --check` → exit 0. Actual browser interactions and multi-tab locking remain pending Plan04.
- Plan 03 Task 4 committed as `7c78d24`: post-commit CRUD/Pedido publications, tenant-scoped delete envelopes, Caja/receipt invalidations, gateway transport-failure containment, and shared typed event contracts. Runtime Zod validation is owned by event receivers to preserve the API CommonJS/shared ESM boundary. Root verified shared Jest → **2 suites, 55 tests**; API Jest → **25 suites, 205 tests**; disposable PostgreSQL+Redis integration → **5 suites, 53 tests**; API `tsc --noEmit` and `git diff --check` → exit 0.
- Plan 03 Task 5 committed as `28b8db2`: tenant/session/schema-fenced authoritative snapshots, version/timestamp-aware event application, short local write lock for enqueue/snapshot/delivery mutations, acknowledged-command crash recovery, dirty single follow-up, Operativa snapshot triggers and Web invalidation refetches. Root independently verified recursive workspace Jest → shared **55**, Operativa **57**, API **205** tests passed; workspace lint → **5/5**, build → **4/4**, `git diff --check` → exit 0. Real IndexedDB, browser lifecycle, multi-tab locks and Socket.IO reconnect acceptance remain pending Plan04.

### Plan 04 Task 2 clarification ruling

- **Ruling:** `pedidosLegadoSinCobro` is a global per-branch unresolved count, not filtered by `Pedido.createdAt` or report range. A closed/cobrado legacy pedido without `Cobro` has no proven collection date; using order creation time would imply an unsupported sales date. Cost if wrong: the historical warning may include records outside the selected report period, but it will not misstate them as dated sales.

## Next step

Plan 03 and the committed Plan 04 implementation are complete on the local branch. The Plan 04 follow-up closes two browser-discovered defects and keeps configurable local ports; its remaining planned browser edge cases and hosted CI execution are explicitly unchecked in the Plan 04 ledger. Do not push or deploy without an explicit request. No additional design ceremony or automatic SDD artifacts are required.
