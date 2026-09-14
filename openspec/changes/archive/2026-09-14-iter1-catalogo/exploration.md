# Exploration: iter1-catalogo (Platos, categorías, disponibilidad — backend + CRUD admin)

## Current State

- `apps/api/src/` has only `app.module.ts` (imports `HealthModule`) + `health/` (trivial `GET /health`). No domain modules exist.
- `apps/api/package.json`: only `@nestjs/common|core|platform-express@^10.4.4`, `reflect-metadata`, `rxjs`; devDeps `tsx`/`typescript`/`@types/*`. No `@nestjs/config`, no ORM, no test runner anywhere in the repo. `openspec/config.yaml` itself already says "flip tdd to true once Jest lands (Iter 1)" — installing Jest is an already-committed Iter1 prerequisite, and CLAUDE.md's Strict TDD Mode is declared enabled but fails closed until a runner exists.
- Zero DB/ORM/`.env` anywhere. `docker-compose.yml` provisions Postgres 16 (`comanda`/`comanda`/`comanda`, `:5432`) and Redis 7 (`:6379`, unused). Nothing loads `DATABASE_URL` into `apps/api` — no `@nestjs/config`, no dotenv.
- `packages/shared/src/index.ts`: only `HealthStatus` interface + `pingApi()` fetch-wrapper, zero runtime deps. This is the entire established shared-contract convention from Iter 0.
- `apps/web`: only `layout.tsx` + trivial health-check `page.tsx`. No `components/`, no CSS framework, no UI lib, no form/table anywhere. `apps/operativa/src/App.tsx` mirrors it exactly. Per the role table in `sistema-gestion-gastronomico.md` §5, Admin (web) owns catálogo CRUD; operativa is out of scope for Iter1 admin CRUD.
- `ARCHITECTURE.md` §1 table already **decides** ORM = Prisma ("mejor ergonomía que TypeORM para scoping multi-tenant por query") — closed at project level, not open for Iter1.
- **Correction to initial framing**: multi-tenancy is *not* an open/undecided question project-wide. `sistema-gestion-gastronomico.md` §3, §4.2, §7.6 explicitly decide "Multi-tenant en el modelo, single-tenant en el deploy" and "PostgreSQL con `org_id`/`sucursal_id` en cada tabla" — every table gets these columns from day one; only the *deploy* is single-tenant. The doc even markets this against Fudo as a differentiator. What's genuinely open for **Iter1 specifically**: no `auth`/`tenancy` module exists yet to populate those columns at runtime, so the real decision is *how* (or whether) to add them now with no auth wired, not *whether the model wants them eventually*.
- `sistema-gestion-gastronomico.md` §5/§6 originally envisioned "schemas Zod por agregado" living in `packages/shared`. The actual Iter0-established convention is plain interfaces + fetch-wrappers, zero runtime deps. Iter1 is the first iteration needing real input validation, so this doc-vs-actual gap surfaces concretely here.

## Affected Areas

- `apps/api/src/app.module.ts` — import new `CatalogoModule` (+ a Prisma/DB module)
- `apps/api/src/health/*` — existing module/controller/service shape to mirror
- `apps/api/package.json` — needs `@prisma/client`+`prisma`, `class-validator`+`class-transformer`, and the entire missing test toolchain (`jest`, `ts-jest`, `@types/jest`, `@nestjs/testing`)
- `packages/shared/src/index.ts` — add `Plato`/`Categoria` interfaces + fetch-wrapper functions matching `pingApi`'s shape
- `apps/web/app/` — new `catalogo/` route/page; first real form/table in the repo, no reusable UI pattern exists yet
- `docker-compose.yml` / new `.env` — Postgres is provisioned but nothing loads `DATABASE_URL`
- `openspec/config.yaml` — `apply.tdd` flip to `true` is pre-planned exactly for this iteration once Jest lands

## Approaches Considered

1. **Prisma + NestJS class-validator DTOs, shared stays flat (interfaces + fetch-wrappers only)** — Categoria+Plato Prisma models, precio as Int cents, `PrismaService` as `@Global` module, CRUD controller/service mirroring `health/`'s shape, Jest+ts-jest+`@nestjs/testing` bootstrap, plain-HTML admin page.
   - Pros: matches ARCHITECTURE.md's already-decided ORM; matches Iter0's shared-package convention; class-validator has a built-in `ValidationPipe`, zero extra plumbing; smallest diff; satisfies the already-committed Jest requirement.
   - Cons: diverges from the doc's original "Zod por agregado" vision — validation stays api-only, not reusable for client-side form validation later.
   - Effort: Low-Medium.

2. **Prisma + Zod schemas in `packages/shared`, reused by both a NestJS Zod pipe and web's forms** — realizes the original documented vision literally.
   - Pros: matches the doc's single-contract vision; one schema powers server and client validation.
   - Cons: introduces the first runtime dependency into `packages/shared` (precedent-setting, dependency-free since Iter0); Nest has no built-in Zod pipe, extra plumbing; Iter1's admin CRUD is plain full-page HTML forms per the existing sketch, so there's no described client-side inline-validation need yet (YAGNI).
   - Effort: Medium.

3. **TypeORM instead of Prisma** — evaluated, not recommended: ARCHITECTURE.md already closed this with a still-valid, explicit rationale (multi-tenant query-scoping ergonomics). TypeORM's advantage (entities colocated with Nest decorators, no schema DSL/codegen) doesn't outweigh reopening a documented decision for zero new information.
   - Effort if pursued: Medium, plus the cost of reverting the documented decision.

## Recommendation

Approach 1 (Prisma + class-validator, shared stays flat), plus schema-ready-but-unenforced nullable `org_id`/`sucursal_id` columns on Categoria/Plato (cheap now per the doc's own "meter tenancy después es carísimo; ahora es casi gratis" rationale — zero enforcement cost since no auth touches them yet). Wire Jest+ts-jest+`@nestjs/testing` as an explicit **prerequisite task** before any RED-GREEN-REFACTOR work, since it's already mandated by `openspec/config.yaml` and Strict TDD Mode. Defer Zod-in-shared until a real client-side validation UX appears (YAGNI) — it layers cleanly on top of the same shapes later.

## Risks

- No test runner exists anywhere; Strict TDD Mode fails closed until Jest is wired — sequence this first, don't assume it.
- No `.env`/`@nestjs/config` exists; the `DATABASE_URL` loading mechanism must be decided before `PrismaService` can connect.
- Adding `org_id`/`sucursal_id` with no auth to populate them correctly means either nullable-and-unenforced (weak) or a hardcoded single-org/sucursal seed row (couples Iter1 to a tenancy placeholder) — needs explicit product confirmation, not an assumption.
- `apps/web` has zero UI/form/table patterns; this admin CRUD page sets a precedent future admin screens (salón, caja) will likely copy.

## Ready for Proposal

Yes — scope is well-bounded, current state fully verified against real files, and the two genuine open decisions (tenancy columns now-vs-later; Jest sequencing) are flagged for `sdd-propose` to resolve explicitly.
