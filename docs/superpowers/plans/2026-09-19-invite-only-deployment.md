# Invitation-only deployment implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship invitation-only access, endpoint authorization verification, and a protected Vercel/Railway deployment path.

**Architecture:** `Invitation` records bind an opaque hashed token to an email, role, organization, and branch. An operational CLI creates the first admin invitation; admins create employee invitations through a protected API. Provider-native Git deploys run only after protected `main` merges.

**Tech Stack:** NestJS, Prisma/PostgreSQL, React/Next/Vite, pnpm/Turborepo, GitHub Actions, Railway, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-19-invite-only-deployment-design.md`

## Global Constraints

- Delete public `/auth/register`; do not add a bootstrap HTTP endpoint.
- Persist only SHA-256 invitation token hashes; default expiry is 72 hours.
- Invite acceptance fixes email, role, org, and branch from the database record.
- Only `admin` can issue employee invitations; employee roles exclude `admin`.
- Public routes are the exact allowlist in the spec.
- Never put production secrets in GitHub, source, logs, or Vercel client variables.

## Review Focus

- A raced acceptance must create one user and one used invitation only.
- An expired/used/unknown token must expose the same generic error.
- An admin cannot invite into another organization or elevate an employee to admin.
- Anonymous callers must receive 401/404 for every non-public controller action.
- Railway migration failure must prevent serving the incompatible API.

---

### Task 1: Invitation persistence and token primitives

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_add_invitations/migration.sql`
- Modify: `apps/api/src/auth/jwt.service.ts`
- Create: `apps/api/src/auth/invitation-token.spec.ts`

**Interfaces:**
- Produces `Invitation` with `tokenHash`, `email`, `rol`, `organizacionId`, `sucursalId`, `expiresAt`, `usedAt`, `createdById`.
- Produces `generateInvitationToken()` and `hashInvitationToken(token)`.

- [ ] Write tests proving generated tokens are high-entropy, hashes are deterministic, and distinct tokens do not collide.
- [ ] Run `corepack pnpm --filter api test -- --runInBand invitation-token.spec.ts`; expect failure because helpers do not exist.
- [ ] Add the Prisma model, indexes for active lookup, foreign keys, and a migration. Implement helpers with `randomBytes(32).toString("base64url")` and SHA-256.
- [ ] Regenerate Prisma and rerun the focused test.
- [ ] Commit: `feat: add invitation persistence`.

### Task 2: Invitation service, DTOs, and protected API

**Files:**
- Create: `apps/api/src/auth/dto/create-invitation.dto.ts`
- Create: `apps/api/src/auth/dto/accept-invitation.dto.ts`
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/auth/auth.service.spec.ts`
- Modify: `apps/api/src/auth/auth.controller.spec.ts`

**Interfaces:**
- Produces `createInvitation(caller, { email, sucursalId, rol })` returning `{ activationUrl, expiresAt }`.
- Produces `acceptInvitation({ token, nombre, password })` returning `AuthSession`.

- [ ] Add failing tests for admin-only creation, same-org branch validation, employee-only roles, generic invalid acceptance, and atomic single acceptance.
- [ ] Run focused auth tests; expect missing methods/routes.
- [ ] Remove `RegisterDto`, `AuthService.register`, and `POST /auth/register`. Add protected `POST /auth/invitations`, public `POST /auth/invitations/accept`, DTO validation, and atomic conditional invitation consumption.
- [ ] Ensure invite acceptance calls the existing session creation path after creating a user from invitation fields only.
- [ ] Run `corepack pnpm --filter api test -- --runInBand auth.service.spec.ts auth.controller.spec.ts`.
- [ ] Commit: `feat: require invitations for user access`.

### Task 3: Owner invitation CLI and activation UI

**Files:**
- Create: `apps/api/scripts/invite-admin.mjs`
- Modify: `apps/api/package.json`
- Modify: `apps/web/app/page.tsx`
- Create: `apps/web/app/invitacion/page.tsx`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/index.spec.ts`

**Interfaces:**
- Produces `pnpm --filter api invite-admin -- --org "..." --branch "..." --email "..."`.
- Produces `acceptInvitation(baseUrl, { token, nombre, password })`.

- [ ] Add shared-client test that posts only token/name/password to `/auth/invitations/accept`.
- [ ] Run it red, then add client schema/function and an activation page reading `token` from the URL without rendering it into logs.
- [ ] Implement CLI argument validation; use one Prisma transaction to create organization, branch, and pending admin invite, rejecting an active duplicate email/branch pair. Print activation URL only after success.
- [ ] Run API/shared builds and manually test CLI `--help`; do not run it against production during automated verification.
- [ ] Commit: `feat: add owner invitation workflow`.

### Task 4: Endpoint policy audit and rate limits

**Files:**
- Modify: every `apps/api/src/**/*controller.ts` with a mutation lacking `@Roles`
- Modify: `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/src/auth/public-routes.spec.ts`
- Create: `apps/api/src/auth/rate-limit.spec.ts`

**Interfaces:**
- Public allowlist is `/health`, login, refresh, logout, invitation acceptance, and signed webhook only.
- All mutations expose explicit `@Roles` metadata.

- [ ] Write table-driven controller/guard tests for anonymous denial outside the allowlist and 403 for insufficient roles.
- [ ] Add focused rate-limit tests for login, refresh, invite creation, and acceptance.
- [ ] Implement Nest throttling using Redis-compatible storage/configuration and route-specific limits; preserve webhook signature behavior.
- [ ] Run all API tests and inspect every controller’s role metadata with `rg -n "@(Public|Roles)|@(Post|Patch|Delete)" apps/api/src`.
- [ ] Commit: `fix: enforce endpoint access policy`.

### Task 5: Deployable Railway/Vercel configuration and CI gate

**Files:**
- Create: `apps/api/Dockerfile`
- Create: `railway.toml`
- Create: `apps/web/.env.example`
- Create: `apps/operativa/.env.example`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/production-hardening.md`
- Create: `docs/deployment.md`

**Interfaces:**
- Railway build runs from repository root, executes Prisma migration pre-deploy, builds API, and starts `node apps/api/dist/main.js`.
- Vercel apps consume `NEXT_PUBLIC_API_URL` and `VITE_API_URL` respectively.

- [ ] Add a CI smoke job that uses PostgreSQL/Redis services, runs migrations, and executes the API test suite with production-equivalent required variables.
- [ ] Build the API container locally; assert `/health` responds after dependencies are supplied.
- [ ] Add Railway healthcheck/pre-deploy config and provider-neutral variable checklist. Add Vercel environment examples without secrets.
- [ ] Document GitHub branch-protection setup, Vercel project roots, Railway service/database setup, generated-domain CORS values, Mercado Pago webhook registration, rollback, and required secrets.
- [ ] Commit: `ci: add protected deployment configuration`.

### Task 6: End-to-end verification and rollout receipts

**Files:**
- Modify: `docs/deployment.md`
- Modify: `docs/production-hardening.md`

- [ ] Run `corepack pnpm install --frozen-lockfile`.
- [ ] Run `corepack pnpm --filter api exec prisma generate`.
- [ ] Run `corepack pnpm turbo run lint build test --force`.
- [ ] Run `corepack pnpm audit --prod --audit-level=high`; expected: no high/critical alert.
- [ ] Test a local invitation acceptance race with two concurrent requests and record the single-user result.
- [ ] Record provider dashboard steps still requiring the owner: create Railway/Vercel projects, enter secrets, configure `main` branch protection, and register Mercado Pago URL.
- [ ] Commit: `docs: record invitation deployment verification`.

## Self-review

Coverage: Tasks 1-3 implement all invitation entities, CLI, protected creation, public acceptance, and UI. Task 4 owns endpoint and rate-limit policy. Task 5 owns provider configuration and CI/CD. Task 6 verifies every spec acceptance condition. No custom email, password reset, custom domains, or staging infrastructure is introduced.
