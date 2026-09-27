# Production Hardening Design

## Goal
Make the current Comanda platform safe to expose, preserve tenant and branch boundaries during session renewal, make payment reconciliation durable, and close the review's highest-risk quality gaps without expanding product scope.

## Scope
- Upgrade production dependencies until the audit has no critical or high findings that are resolvable in the workspace.
- Fail closed for Mercado Pago webhook validation and required production payment configuration.
- Restrict API CORS and Swagger exposure through explicit environment configuration.
- Make refresh-token rotation single-use under concurrency and bind each refresh token to its selected sucursal.
- Guarantee that an approved payment is eventually reflected as a charged pedido when the pedido becomes deliverable.
- Scope offline RxDB storage and outbox records by organization and sucursal.
- Add focused automated tests for these contracts, a browser smoke flow for login/refresh/payment handoff, and responsive admin navigation.
- Reduce the operativa initial bundle through lazy role-view loading; do not hide the warning by increasing its threshold.
- Correct the authentication documentation.

## Non-goals
- No new product roles, user-provisioning workflow, payment provider, order states, or broad UI redesign.
- No separate retry worker or message broker. Reconciliation remains transactionally local to Pedido/Pago state changes.

## Decisions

### Environment boundary
`NODE_ENV=production` requires explicit `JWT_SECRET`, `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `PUBLIC_BASE_URL`, and a comma-separated `CORS_ORIGINS`. Startup validates these values. Swagger is enabled only outside production. Development keeps localhost defaults only where they do not turn an authentication or webhook boundary fail-open.

### Refresh token branch binding
Add `sucursalId` to `RefreshToken`. `session(user, sucursalId)` stores it after proving the branch belongs to the user organization. `refresh(rawToken)` no longer accepts a client branch hint: it atomically revokes a token only when `revokedAt IS NULL`, then issues a replacement bound to the stored branch. Only the admin-protected switch endpoint can mint a session for a different branch.

### Payment reconciliation
A successful webhook records the provider result idempotently. `PedidosService.updateEstado()` checks for an approved Pago after a pedido reaches `entregado`; if present, it advances that same pedido to `cobrado` in the same transaction path. This makes an early payment durable without depending on a duplicate webhook. Configuration errors fail before a checkout preference can be issued.

### Offline isolation
RxDB database names become organization-and-sucursal scoped. Sync, live subscriptions and outbox flushing take the full tenant context, so cached catalog, tables, optimistic orders and queued writes never cross branches. Existing organization-only browser databases are left untouched rather than destructively erased.

### UI and verification
The console header wraps into an accessible compact layout at small widths. Operativa loads role views lazily after authentication. Add tests for refresh authorization/concurrency, payment reconciliation/configuration, tenant-scoped outbox behavior, and a browser smoke harness for the critical authenticated flows.

## Acceptance criteria
1. `pnpm audit --prod --audit-level=high` reports no critical or high vulnerabilities, or each unavailable transitive remediation is explicitly documented with its upstream blocker.
2. A non-admin cannot change branch by refreshing, and parallel refresh requests yield exactly one usable replacement session.
3. Production startup rejects incomplete payment/security configuration; unsigned payment webhooks are rejected.
4. A payment approved before `entregado` becomes `cobrado` when the order reaches `entregado`, with no duplicate state transition.
5. Offline data and queued writes cannot be read or flushed under another branch.
6. Lint, builds and tests pass; the new browser smoke scenario succeeds; no operativa chunk exceeds the existing 500 kB warning threshold.
7. Documentation describes the actual public routes, role guard and refresh behavior.