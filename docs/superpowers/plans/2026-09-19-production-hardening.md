# Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` task-by-task. Steps use checkbox syntax.

**Goal:** Eliminate the review's production security and correctness failures while preserving existing product behavior.

**Architecture:** Production configuration is validated at bootstrap. Refresh tokens become atomically single-use and branch-bound. Payment approval is persisted independently and reconciled when an order reaches `entregado`. Offline storage is branch-isolated. Frontends retain existing APIs except for removing the refresh branch hint.

**Tech Stack:** NestJS 10, Prisma/PostgreSQL, Next.js, React/Vite/RxDB, Jest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-19-production-hardening-design.md`

## Global Constraints
- Do not add a broker, worker, new payment provider, product role, or order state.
- Tests precede each behavioral fix and must fail before implementation.
- Production must fail closed; development defaults are explicit and localhost-only.
- Preserve queued offline orders; never clear a browser database during migration.

## Review Focus
- Two parallel refresh requests must produce only one replacement session.
- A non-admin refresh must never change `sucursalId`.
- An approved payment before delivery must charge exactly once after delivery.
- An unsigned production webhook and incomplete production config must be rejected.
- Branch A cache/outbox data must not appear or flush while running Branch B.

### Task 1: Upgrade and validate runtime boundaries
**Files:** `apps/web/package.json`, `apps/api/package.json`, `pnpm-lock.yaml`, `apps/api/src/main.ts`, `apps/api/.env.example`, `apps/api/src/main.spec.ts`.
- [ ] Add failing bootstrap tests for production missing `CORS_ORIGINS`, payment values and unsigned webhook configuration.
- [ ] Implement a small config reader in `main.ts`: production requires `JWT_SECRET`, `CORS_ORIGINS`, `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `PUBLIC_BASE_URL`; parse allowed CORS origins; expose Swagger only outside production.
- [ ] Upgrade Next and resolvable Nest/Express transitive dependencies, regenerate lockfile, run `pnpm audit --prod --audit-level=high`.
- [ ] Run API tests, lint and build; commit `fix(security): harden production configuration`.

### Task 2: Bind and atomically rotate refresh tokens
**Files:** `apps/api/prisma/schema.prisma`, new migration, `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/dto/refresh.dto.ts`, `apps/api/src/auth/auth.service.spec.ts`, `packages/shared/src/index.ts`, `packages/shared/src/index.spec.ts`.
- [ ] Add failing tests: refresh ignores a supplied foreign/same-org branch hint; concurrent refresh yields one success and one unauthorized result; admin switch creates a token bound to the selected branch.
- [ ] Add non-null `sucursalId` relation/index to `RefreshToken`, backfill legacy rows from `Usuario.sucursalId`.
- [ ] Replace read-then-update revocation with conditional `updateMany({ where: { id, revokedAt: null } })`; reject count zero. Persist `sucursalId` when issuing every session and read it from the refresh row. Remove `sucursalIdHint` from the DTO/client refresh protocol.
- [ ] Run auth/shared tests and Prisma migration deploy; commit `fix(auth): bind refresh tokens to branches`.

### Task 3: Make payment configuration and reconciliation durable
**Files:** `apps/api/src/pagos/webhook-signature.ts`, `apps/api/src/pagos/pagos.service.ts`, `apps/api/src/pedidos/pedidos.service.ts`, `apps/api/src/pagos/*.spec.ts`, `apps/api/src/pedidos/pedidos.service.spec.ts`.
- [ ] Add failing tests for missing webhook secret rejection outside development, missing `PUBLIC_BASE_URL`, and an approved payment followed later by `entregado` becoming `cobrado` exactly once.
- [ ] Make webhook validation reject absent secrets except explicit test/development mode. Refuse preference creation without an absolute public callback URL.
- [ ] After a Pedido transaction reaches `entregado`, query its approved Pago and atomically advance it to `cobrado`; keep webhook idempotent and never rely on later webhook delivery for reconciliation.
- [ ] Run payment/pedido tests; commit `fix(pagos): reconcile approved payments reliably`.

### Task 4: Isolate offline storage by full tenant
**Files:** `apps/operativa/src/db/schema.ts`, `apps/operativa/src/db/sync.ts`, `apps/operativa/src/db/useRxData.ts`, `apps/operativa/src/MozoView.tsx`, `apps/operativa/src/CocinaView.tsx`, new focused tests.
- [ ] Add failing tests proving a Branch B database name differs from Branch A and `flushOutbox` cannot consume Branch A entries with a Branch B tenant.
- [ ] Change database identity and every data/sync helper from `orgId` to `TenantContext` (`orgId`, `sucursalId`); filter live collections by branch and preserve legacy org-only databases untouched.
- [ ] Run operativa tests/lint/build; commit `fix(operativa): isolate offline state per branch`.

### Task 5: Close usability and performance review findings
**Files:** `apps/web/app/layout.tsx`, `apps/web/app/_components/NavLinks.tsx`, `apps/web/app/caja/page.tsx`, `apps/operativa/src/App.tsx`, `apps/operativa/vite.config.ts`, frontend tests.
- [ ] Add responsive DOM/browser checks for navigation and a Caja checkout handoff test that opens a blank window synchronously and later assigns `location` after preference resolution.
- [ ] Make console navigation wrap/collapse without hiding keyboard access. Open the checkout window synchronously, detect popup blocking, and surface an error.
- [ ] Lazy-load role views after authentication and verify the operativa build has no chunk over 500 kB without raising the warning limit.
- [ ] Run frontend tests, lint and builds; commit `fix(ui): harden console and operativa delivery`.

### Task 6: Documentation and final verification
**Files:** `AUTHENTICATION.md`, `ARCHITECTURE.md`, `SEED.md` if config references changed, CI only if a needed test script is missing.
- [ ] Update public-route, role, branch refresh, payment configuration and offline-isolation guidance.
- [ ] Run `pnpm turbo run lint build test --force`, `pnpm audit --prod --audit-level=high`, Prisma migration deploy against local Docker, and browser smoke scenarios for login/refresh, payment handoff and branch isolation.
- [ ] Inspect `git diff --check`; commit `docs: document production hardening`.

## Self-review
- Every acceptance criterion maps to Tasks 1-6.
- No placeholders, background worker, destructive cache deletion or unsupported role behavior is introduced.
- Shared interface changes are ordered: Task 2 changes refresh protocol before frontend verification; Task 4 changes tenant API before callers; Task 3 owns payment/Pedido coupling.