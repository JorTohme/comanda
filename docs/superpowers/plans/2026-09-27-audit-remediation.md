# Audit remediation execution index

**Status:** design approved; these implementation plans await user approval. No remediation product code has been applied by this planning change.

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
- No product implementation until plan approval; then execute tasks, run red/green checks and commit reviewable work units. Plans are references, not proof of passing tests.
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

## Next step

User review and approval of this execution plan, then start plan 01 task 1. No additional design ceremony or automatic SDD artifacts are required.
