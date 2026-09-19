# Invitation-only access and deployment design

Comanda will become invitation-only before its first public deployment. No public endpoint may create an organization or administrator. The owner provisions the first administrator through an operational CLI; organization administrators provision employees through one-time, expiring links. The same change introduces guarded CI/CD for Vercel and Railway.

## Quick path

1. Owner runs a local/Railway-aware CLI to issue the first administrator invitation.
2. Recipient opens the link, sets their name and password, and receives a normal authenticated session.
3. Organization admins create employee invitations from an authenticated admin endpoint.
4. Pull requests must pass CI before merge; a protected `main` branch triggers provider deployments.

## Decisions

| Area | Decision |
|---|---|
| Public registration | Remove `/auth/register`; it must return no route. |
| First administrator | CLI only; no public bootstrap endpoint or static owner secret. |
| Employee onboarding | Authenticated organization admins issue manual invitation links. |
| Invite token | Random opaque token, only its SHA-256 hash persists; single-use and 72-hour expiry. |
| Tenant binding | Invitation stores organization, sucursal, role and recipient email; acceptance cannot override them. |
| Deployment | Vercel projects for `apps/web` and `apps/operativa`; Railway for API, managed PostgreSQL and managed Redis. |
| CD gate | Protected `main` requires the existing CI workflow; Git provider deploys only merged main commits. |

## Authentication flow

### Owner → first administrator

The `invite-admin` CLI accepts organization name, branch name, recipient email and an optional expiry. It creates the organization, branch, and a pending admin invitation inside one database transaction. It writes only the invitation URL to stdout; no password or raw token is stored.

The owner shares the URL manually. The CLI requires `DATABASE_URL` and is intended to run through Railway's controlled environment or a local operator shell with production credentials.

### Administrator → employee

`POST /auth/invitations` requires a valid JWT with `admin` role. The server derives the organization from the JWT, accepts only an existing branch in that organization, and permits only `caja`, `mozo`, or `cocina` roles. It returns an activation URL for manual sharing.

### Recipient acceptance

`POST /auth/invitations/accept` is public and accepts the raw invitation token, name, and password. It atomically marks the invitation used only when its hash matches, it is unused, and it has not expired. It then creates the user with the invitation's fixed email, role, organization, and branch, and returns the standard session pair.

A consumed, expired, unknown, or malformed invitation returns the same generic invalid-invitation response. The endpoint never reveals whether a recipient email was invited.

## Endpoint policy

The global JWT guard remains deny-by-default. The only public routes after this work are:

- `GET /health`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/invitations/accept`
- `POST /pagos/webhook`

`/pagos/webhook` remains public solely to receive Mercado Pago, and validates its provider signature before processing. Every other controller action requires a JWT. Every mutation must carry explicit role metadata; reads must be reviewed for the least-privilege role set and tenant scope.

## Deployment architecture

### Railway

Railway hosts one API service from the monorepo root, plus managed PostgreSQL and Redis. The API build command is workspace-aware, runs Prisma generation and build, and uses a pre-deploy migration command (`prisma migrate deploy`). Railway variables include provider references for `DATABASE_URL` and `REDIS_URL`, plus production-only values:

- `NODE_ENV=production`
- `JWT_SECRET`
- `CORS_ORIGINS` containing the two Vercel origins
- `PUBLIC_BASE_URL` set to Railway's generated API URL
- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_WEBHOOK_SECRET`

The API health check targets `GET /health`. The generated Railway domain is registered in Mercado Pago as the webhook base URL.

### Vercel

Vercel hosts two monorepo projects: Next.js `apps/web` and Vite `apps/operativa`. Both receive their own generated Vercel domain and a build-time API origin variable. Those origins are the only frontend values allowed in the API's `CORS_ORIGINS`.

### CI/CD

The existing GitHub Actions CI remains the required check for pull requests and `main`. GitHub branch protection prevents a merge until it succeeds. Vercel and Railway connect to the repository and deploy only updates on merged `main`; they do not receive application secrets through GitHub Actions.

## Error handling and operations

- Never log invitation tokens, passwords, JWTs, or provider credentials.
- Rate-limit login, refresh, invite creation, and invitation acceptance.
- The owner CLI prints a warning before emitting a raw invitation link, because it is a bearer credential until accepted or expired.
- A failed migration blocks the API deployment rather than starting code against an incompatible schema.
- Deployment docs distinguish public configuration from secrets and list every required provider setting.

## Verification checklist

- [ ] Registration route is absent; anonymous registration returns 404.
- [ ] CLI can create exactly one initial admin invitation and cannot create a duplicate active invitation for the same email/branch.
- [ ] Only admins can create employee invitations; cross-organization and cross-branch attempts fail.
- [ ] Acceptance rejects expired, consumed, and raced invitations without creating multiple users.
- [ ] Accepted users inherit invitation email, role, organization, and branch exactly.
- [ ] Controller tests prove anonymous requests are denied except for the explicit public allowlist.
- [ ] CI runs against a clean install; `main` branch protection requires it.
- [ ] Railway migration and `/health` pass before API exposure; both Vercel apps call the configured API origin.

## Out of scope

- Automatic email delivery and email-provider accounts.
- Password reset, SSO, MFA, or user deactivation workflows.
- Custom domains, staging environments, preview databases, and production data migration beyond Prisma schema migration.
