# Audit remediation design

Status: written design and executable implementation plans approved by the user on 2026-09-27; implementation is in progress on `codex/audit-remediation`.

## Outcome

Make Comanda's existing restaurant workflows reliable across roles, branches, concurrent requests and network failures. Preserve the modular NestJS monolith, Prisma/PostgreSQL, shared contracts and two frontends. Deliver independently testable corrections rather than a rewrite.

**Confirmed business rule:** cash closing compares declared physical cash with expected physical cash. Mercado Pago and other digital receipts appear separately and never inflate expected drawer cash.

## Baseline and reuse

- The audited checkout was `main` at `054019a`.
- The locally recorded `origin/main` and `fix/production-hardening` both point to `8d1b3ed`, eighteen commits ahead. These are local references, not a freshly fetched remote state.
- That work already contains branch-bound refresh tokens, conditional token consumption, organization-and-branch IndexedDB names, invitation-only onboarding and production configuration checks. Reuse it instead of implementing those features twice.
- Existing fixes are not accepted solely because a document or mock-based test says they work. For example, newer `CurrentUser` returns full JWT claims while existing services spread its value into Prisma tenant filters. Restore an explicit tenant projection before relying on those paths.
- Work remains on `codex/audit-remediation`; do not rewrite `main`, push, deploy or modify external provider settings as part of this design.

## Delivery order

| Slice | Outcome | Depends on |
|---|---|---|
| 1. Reuse, authorization and sessions | Existing hardening retained without tenant regressions; actor-specific permissions and consistent sessions | Baseline verification |
| 2. Orders and monetary consistency | Idempotent orders, protected shifts, explicit tender and recoverable payment reconciliation | Slice 1 |
| 3. Offline and realtime recovery | Durable branch-scoped commands and authoritative reconnect recovery | Slices 1–2 contracts |
| 4. Operational completeness | Installable offline shell, usable staff invitations and accurate reports | Slices 1–3 |
| 5. Delivery evidence and documentation | Repeatable tests, CI and an honest description of implemented behavior | Each preceding slice |

Tests and documentation travel with each slice; slice 5 is a whole-system verification, not permission to postpone testing.

## 1. Authorization and session lifecycle

### Tenant boundary

Keep separate accessors for complete actor claims and the projected tenant `{ orgId, sucursalId }`. Business queries and writes must use the projection, never spread a JWT into Prisma arguments. Verify organization-and-branch ownership on every foreign-key lookup and preserve the intended organization-wide admin scope of branch management and consolidated reports.

### Action policy

| Action | Allowed actor |
|---|---|
| Create a pedido | admin, caja, mozo |
| Send a pedido to cocina | admin, caja, mozo |
| Start preparation / mark ready | admin, cocina |
| Dispatch own delivery / mark delivered | admin, caja, mozo |
| Record cash collection / close a paid pedido | admin, caja |
| Record verified Mercado Pago receipt | Internal provider reconciliation only |
| Change catalog name, price or category | admin |
| Change dish availability | admin, cocina |
| Configure/create/delete tables and their layout | admin |
| Operate table occupancy | admin, mozo; cannot free a table with an active pedido |
| Change branch or issue employee invitation | admin, limited to the same organization |

Enforce transition policy at the service boundary as well as HTTP metadata. A role permitted to mutate pedidos does not receive permission for every destination state. The console must hide or disable actions unavailable to the current actor; UI checks never replace server authorization.

Preserve the existing invitation workflow from the hardening branch: owner CLI for the first administrator; administrators invite only caja/mozo/cocina into a branch of their organization. Add the missing usable console invitation flow rather than introducing a second password-provisioning system.

### Session continuity

- Refresh tokens remain server-bound to their selected branch. The client cannot select another branch through refresh.
- Consume the old token and persist the replacement in one database transaction; failure must not permanently consume a valid token without issuing its replacement.
- Coordinate concurrent refresh attempts in a tab through one shared promise and in supported multiple-tab browsers through the Web Locks API. Inside the lock, reread the stored token and reuse a newer session rather than submit an already consumed refresh token.
- Use one shared session persistence/notification path for web and operativa. Clear stale `comanda.session` when migrating to that path; do not discard a valid current token pair.
- A transient refresh network/5xx failure preserves the session and surfaces connectivity failure. Only a confirmed invalid/expired session clears it.
- Logout and account/branch changes invalidate pending asynchronous callbacks: a late refresh or fetch must not restore a logged-out session or write under the next tenant.
- Realtime authenticates with the latest token, refreshes before an expired-token reconnect, and disconnects when the server-side token expires. Socket callbacks validate payload contracts and tenant identity.

## 2. Orders, cash shifts and payments

### Concurrency boundary

Use PostgreSQL, not a process-local or Redis-only mutex, as the correctness boundary. Acquire a tenant-validated `Sucursal` row lock inside each transaction that couples pedido state, table occupancy, receipt posting or shift state. Acquire branch locks before other row locks in a consistent order. This deliberately serializes critical mutations within a branch; no global lock and no new distributed lock subsystem.

Add a partial unique database index for one open cash shift per organization/branch. Migration must fail with a diagnostic if duplicates already exist; never close or delete them silently. State mutations include expected state/version conditions and return conflict on incompatible stale commands. Shift closing freezes its computed cash snapshot in the same transaction that prevents further receipt/movement posting.

### Pedido invariants

- A tenant-scoped idempotency key identifies a canonical creation payload. Retrying the same key and payload returns the same pedido, including under concurrency; reusing it with a different payload returns conflict.
- Recover an existing pedido after an insertion uniqueness race rather than expose `P2002` as a server error.
- Validate positive bounded quantities, totals and available dishes on the server before snapshotting names/prices. The UI also filters unavailable dishes, but the server remains authoritative.
- Permit at most one non-closed pedido per table in the current creation-only workflow. Reject another creation while one is active. Do not add item-merging or multi-check features to this remediation.
- Table closing/freeing checks active pedidos transactionally; manual occupancy changes cannot bypass the invariant.
- Delivery validation rejects blank/whitespace-only platform or address values and preserves the existing own-delivery `en_camino` branch.

### Explicit receipt instead of inferred payment

Introduce one small `Cobro` record per pedido, with a unique pedido reference, tenant identifiers, integer-cent amount, tender (`efectivo` or `mercadopago`), collection timestamp, optional provider payment reference, optional collecting user and optional cash shift. This is a receipt for a single full payment, not a generic accounting/event-sourcing subsystem.

- Cash collection requires a delivered, unpaid pedido and an open shift. Create its receipt and advance its state atomically. A repeat of the same collection returns the original receipt rather than collecting twice.
- Remove direct generic state advancement to `cobrado` from browser clients. The console uses an explicit collection action; internal payment reconciliation uses the same monetary invariants without impersonating a browser role.
- A digital payment can be approved before delivery or without an open cash shift. Persist the verified receipt once; preserve fulfillment states until delivery. If already paid at delivery, fulfillment can advance to `cobrado` without requiring physical cash to be open.
- Attach a digital receipt only to a shift open at posting time. With no open shift, leave it unassigned and show it explicitly as an unassigned digital receipt; never modify a closed shift or silently assign it to the next shift.
- Expected drawer cash = opening cash + cash receipts + cash ingress − cash egress. Show digital receipts, total sales and unassigned receipts separately.
- Existing `turnoCajaId` remains a legacy compatibility field until all consumers are migrated; new arithmetic is based on receipts, not all pedidos attached to a shift.
- Refunds, partial payments, split tender and other digital providers are outside this change. New providers can add an explicit tender later; never infer them as cash.

### Provider reconciliation

- Require valid production configuration and verified webhook signatures before processing. Keep the explicitly documented development-only bypass; it must not activate in production.
- Compare provider payment ID, currency, amount in integer cents, external reference and the expected merchant/checkout association with the stored local preference. Never accept a merely `approved` response as sufficient proof for a different payment.
- Repeated approval must independently verify whether receipt creation and fulfillment reconciliation succeeded; a stored terminal payment state is not a reason to skip unfinished work.
- Process valid approval and local receipt changes transactionally under the branch lock. Perform provider HTTP calls outside the database transaction.
- Return a retriable non-2xx for transient reconciliation failures; do not acknowledge work that was neither completed nor stored durably. Permanent mismatches remain visible as reconciliation incidents, without collecting or silently disappearing.
- Provide a tenant-scoped admin reconciliation action for pending/failed known payments; recovery is possible without depending solely on another webhook.
- Guard preference creation against concurrent calls and already collected orders. A rejected attempt does not permanently prevent a legitimate new payment attempt; keep history rather than overwrite a previous successful receipt.
- Reserve each attempt with `externalReference = Pago.id`, expected cents, `ARS`, merchant identity and a 60-second lease under the `Sucursal` lock. Create/search Mercado Pago preferences outside transactions; after an ambiguous timeout, search every result page by stable reference and retrieve complete preference records before attaching the unique verified result. Zero or multiple matches become blocking incidents instead of a blind second checkout.
- Expose tenant-scoped `incidente` attempts to administrators in Caja, with an explicit provider payment ID verification action. Keep incident history; refunds and payment reversals remain out of scope and require provider-side investigation.

## 3. Offline and realtime

### Durable commands

- Continue using RxDB/IndexedDB. Every store, read and command includes organization and branch, and verifies that the active session matches before sending.
- Treat the outbox command as the durable source for optimistic creation. Write it first, derive/rebuild the optimistic view from it after interruption, and remove it only after the real pedido is stored successfully.
- Serialize flushing in each store and across tabs using native browser coordination. Stable server idempotency remains the ultimate duplicate-prevention guarantee.
- Retry network failures, timeouts, 408, 429 and 5xx with bounded exponential backoff while foregrounded; also trigger on startup, online, focus and reconnect. Reattempts stop on logout/tenant change.
- Invalid-session errors suspend sending until login. Permanent validation conflicts move to an explicit failed-command state with visible error and user retry/discard; do not silently delete the only copy of the pedido.
- Store migration preserves old queued data. Legacy organization-only commands with no provable branch remain quarantined with an explicit recovery/export path; never send them under the currently selected branch by guesswork.
- Prevent sending an optimistic local ID to the normal state endpoint before server creation is acknowledged. Show pending synchronization status.

### Authoritative recovery

On authenticated connection/reconnection, reload authoritative mesas, platos and relevant pedidos, reconcile removals, and retain local pending/failed commands. Buffer or recheck changes arriving during the snapshot so stale HTTP responses cannot overwrite newer events. Compare `updatedAt` where applicable; server state wins over acknowledged local state.

Emit create/update/delete catalog and table events after successful commit. Add missing dish listeners in Mozo. Web Pedidos/Caja update from relevant events and refresh after reconnect. A failed event publish must not turn an already committed order into an apparent failed write; authoritative refresh and a modest foreground refresh fallback recover missed events without adding a backend message broker.

## 4. PWA, reporting and safe maintenance

### Offline shell

Add a manifest, icons and a versioned service worker that caches the built shell and required static assets. Do not cache authenticated API responses or credentials in shared HTTP caches. API reads remain tenant-scoped in IndexedDB. After one online installation, cold reload works offline with a previously saved valid session and local data. New login requires network. Updates must preserve IndexedDB/outbox and not force-reload a screen with pending input.

### Reporting semantics

Use receipt collection time for sales totals and paid-dish rankings. Use pedido creation time for demand/hour-of-order statistics; label them as order activity instead of cash collection. Add an IANA timezone to Sucursal, default `America/Argentina/Buenos_Aires`. Convert local inclusive date ranges into UTC half-open intervals and group in the branch timezone. Consolidated results use each branch's own timezone. Avoid `::int` narrowing of monetary aggregate sums; validate safe JSON integer output.

### Existing data and rollout

- Add schema fields and receipt structures without deleting business data.
- Backfill only facts that can be established: a verified historical Mercado Pago approval can identify digital tender; historical orders with no receipt evidence remain explicitly unknown. Neither `updatedAt` nor pedido creation time proves collection time.
- Preserve old closed shift snapshots as legacy mixed-tender totals and label them accordingly. Do not reinterpret historical `totalCalculado` as physical cash.
- Unknown historical receipts are excluded from new authoritative cash-close calculations and shown as unresolved legacy records. Migration/preflight reports an existing open shift with ambiguous history; its owner must reconcile or close it under the old release before enabling new cash-close semantics.
- Make demo seeding explicitly development-only, scoped to a fixed demo identity rather than organization name, and transactional. Seed data includes realistic receipt methods/timestamps.
- Update architecture/authentication/offline specs and maintainer guides to describe implemented scope, migration/rollback, verification and known limits.

## 5. Verification and acceptance

Preserve existing tests and add behavior-oriented regressions beside the affected code. Replace the tautological smoke test with a compiled Nest HTTP boundary test. Add frontend sync/session tests and a small browser suite for the workflows that mocks cannot establish.

| Evidence | Required scenarios |
|---|---|
| HTTP authorization | Real signed claims reach safe Prisma tenant arguments; mozo cannot collect/change branch; cocina cannot edit prices; invitations cannot escalate role or cross organization |
| PostgreSQL integration | Concurrent creation-key retries, refresh rotation, shift opening, close versus collection/movement, stale transitions and table creation races |
| Payment integration with fake provider | Wrong amount/currency/reference, retry after transient failure, approval before delivery, approval without open shift, duplicate events and already-cash-collected conflict |
| Browser/session | Parallel 401s, logout during refresh, multiple tabs, latest-token socket reconnect and branch/account switching |
| Browser/offline | Offline creation survives reload; HTTP503/429 preserves commands; crash between persistence steps; rejection recovery; old database migration; reconnect snapshot/deletion recovery |
| Reports/migration | Collection after midnight, distinct branch timezones, unknown legacy tender/date, existing duplicate shifts and aggregate totals beyond PostgreSQL int32 |

CI provisions a disposable PostgreSQL/Redis environment for integration tests, applies migrations from a clean database and verifies upgrade fixtures. Run unit/integration/browser tests, type checks and production builds with the declared pnpm toolchain. Never point tests or demo seed at a live business database. Missing infrastructure is reported as unverified, not passing.

## Acceptance gate

Every audit finding must map to a change, a runnable regression and updated documentation. Reusing a pre-existing branch fix does not waive its boundary/integration test. Cash snapshots must remain consistent under races; an interrupted client/server operation must either commit once or remain recoverable, never lose the only record.

## Non-goals and workflow

No microservices, generic repository layer, CRDT, new backend queue, UI redesign, automated email delivery, payment refunds or external deployment configuration. Use native database/browser guarantees and installed libraries first. Receipt-driven reviews remain disabled unless the user explicitly enables them; do not manufacture review approvals.

After approval of this written design, create separately executable plans for slices 1–4 with tests/documentation included, then execute them in dependency order. Use narrow delegated implementation for non-trivial multi-file slices according to repository routing; the coordinating agent owns integration and final evidence. No product implementation has been performed at this stage.
