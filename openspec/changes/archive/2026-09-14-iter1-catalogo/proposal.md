# Proposal: Iter 1 — Catálogo

## Intent

The repo is scaffold-only: `apps/api` has just `health/`, no ORM, no persistence, no test runner. Nothing can be ordered until a catalog exists, so every later iteration is blocked on it. Iter 1 of `ARCHITECTURE.md` delivers Categoria + Plato CRUD and lands the persistence and testing foundations the roadmap already assumes.

## Scope

### In Scope

- Test toolchain first: `jest`, `ts-jest`, `@types/jest`, `@nestjs/testing`; flip `apply.tdd` to `true`.
- Prisma bootstrap: schema, initial migration, global `PrismaService`, `DATABASE_URL` via `@nestjs/config` against the docker-compose Postgres.
- `Categoria`; `Plato` (`nombre`, `precio` as Int centavos, `disponible`, FK to Categoria).
- Nullable, unenforced `org_id` / `sucursal_id` columns on both models.
- `CatalogoModule` mirroring `health/`; CRUD endpoints with class-validator DTOs behind Nest's native `ValidationPipe`.
- Interfaces + fetch wrappers in `packages/shared` (`pingApi` pattern, still zero runtime deps).
- Admin screen `apps/web/app/catalogo/page.tsx`: plain HTML table + forms, no UI library.

### Out of Scope

- Auth, tenancy enforcement, any query filtering by `org_id` / `sucursal_id`.
- Real-time/sockets, Redis, takeaway & delivery, payments, plano 2D, `apps/operativa`.
- Zod in `packages/shared`; images, modifiers, stock, soft-delete.

## Capabilities

### New Capabilities

- `catalogo`: persistence + HTTP contract for Categoria/Plato — CRUD, availability, price-in-cents, validation.
- `catalogo-admin`: admin screen behavior against that API.

### Modified Capabilities

- None (`openspec/specs/` is empty).

## Approach

1. Test toolchain first — Strict TDD fails closed without a runner.
2. `prisma/schema.prisma`, global `ConfigModule`, `PrismaService extends PrismaClient` in a `@Global()` `PrismaModule`, one additive migration.
3. `catalogo/` copying `health/`'s layout, registered in `app.module.ts`. Money as Int centavos — exact, no Decimal ceremony.
4. Interfaces + fetch wrappers in `packages/shared/src/index.ts`.
5. One page, native `<form>` + `<table>`; deliberately plain because it sets a precedent.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api` | New/Modified | deps, `prisma/schema.prisma`, `src/prisma/`, `src/catalogo/`, `app.module.ts`, `main.ts` ValidationPipe |
| `packages/shared/src/index.ts` | Modified | Categoria/Plato interfaces + fetch wrappers |
| `apps/web/app/catalogo/page.tsx` | New | Admin CRUD screen |
| `.env` / `.env.example` | New | `DATABASE_URL` |
| `openspec/config.yaml` | Modified | `apply.tdd: true`, `test_command` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| TDD starts before Jest is wired | Med | Toolchain is task group 1; no domain task before `test` passes |
| Prisma migration fails against Postgres | Med | Verify `docker compose up -d` + `migrate dev` before domain code |
| Nullable tenancy columns treated as enforced | Low | No filters, no seed org rows; explicitly out of scope |
| Int-cents misread as pesos by the UI | Med | Conversion isolated in shared wrappers, covered by a unit test |

## Rollback Plan

- **Schema**: migration only creates new tables; no existing table altered, no prior Plato/Categoria data, so `prisma migrate reset` is lossless. No data migration.
- **Code**: `git revert` removes `catalogo/`, `prisma/`, the web route and shared exports; `health` keeps working untouched.
- **Deps**: revert `package.json` + lockfile, re-run `pnpm install`.
- **Partial**: the Prisma + Jest foundation can stay while only `catalogo` and the web route revert; flip `apply.tdd` back only if the toolchain itself is rolled back.

## Dependencies

- Postgres 16 from the existing `docker-compose.yml` (provisioned, previously unused).
- Prisma decided in `ARCHITECTURE.md` §1 — not reopened here.

## Success Criteria

- [ ] `pnpm --filter api test` passes; `apply.tdd: true` with a real `test_command`.
- [ ] `migrate dev` creates `Categoria` + `Plato` including nullable `org_id` / `sucursal_id`.
- [ ] CRUD works, rejects invalid payloads with 400, persists `precio` as Int centavos.
- [ ] `/catalogo` lists, creates, edits, deletes and toggles `disponible` through `packages/shared`.
- [ ] `pnpm build` passes in strict mode; no auth/tenancy/socket/payment code introduced.
