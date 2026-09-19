# Production hardening guide

This guide records the safeguards introduced by the production-hardening branch. It is intended for maintainers and future coding agents.

## Required production configuration

`NODE_ENV=production` requires all of the following at API startup:

- `JWT_SECRET`
- `CORS_ORIGINS` — comma-separated allowed frontend origins
- `PUBLIC_BASE_URL` — public API origin used to register the Mercado Pago webhook URL
- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_WEBHOOK_SECRET`

Startup fails if any is missing. Swagger is exposed only outside production. Do not use permissive CORS in production.

## Authentication and branch scope

Refresh tokens now persist their `sucursalId`. `/auth/refresh` never accepts a branch from the client; it restores the branch encoded by the stored refresh token. A token is consumed with an atomic conditional update, so two concurrent refresh attempts cannot both mint a replacement session.

The only supported branch change is `POST /auth/switch-sucursal`, which remains an authenticated admin operation.

### Database migration

Deploy `apps/api/prisma/migrations/20260919183000_bind_refresh_tokens_to_sucursal/migration.sql` before rolling out the API. It backfills old tokens from each user's current branch, then enforces the branch foreign key.

## Mercado Pago

Production webhooks fail closed when their secret is absent. A payment preference also requires a valid `PUBLIC_BASE_URL`.

Webhook delivery may precede order delivery. The approved payment is persisted first; when the order advances to `entregado`, the API checks for the approved payment and atomically writes `cobrado` with the open cash shift. This prevents duplicate webhook delivery from leaving an order stranded at `entregado`.

The web Caja flow opens a blank checkout window synchronously before the network request, then navigates it to Mercado Pago. This avoids browser popup blocking and closes the window if preference creation fails.

## Offline operational app

RxDB is keyed by both organization and branch. Reads are filtered by the same pair and the outbox API also takes the complete tenant context. Do not revert these APIs to organization-only signatures: that would reintroduce cross-branch cached data and queued-order leakage on shared devices.

Prior data is not deleted when a session switches branch; it remains in its original IndexedDB database.

## Performance and responsive behavior

Mozo and Cocina views are dynamically imported. The initial operativa bundle is approximately 252 kB minified; RxDB and role views load in separate chunks. Operational headers and the web navigation wrap on narrow screens.

## Verification baseline

The hardening branch was verified with:

```powershell
corepack pnpm turbo run lint build test --force
corepack pnpm audit --prod --audit-level=high
```

The full lint/build/test suite passes (API: 19 suites, 213 tests; shared: 17 tests). The production audit has no high or critical findings; it currently reports five lower-severity transitive findings.
