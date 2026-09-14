# Tasks: Iter 1 — Catálogo

Hierarchical, phase-grouped checklist. **Phase 1 is a hard gate**: no task in phases 3–4 (or any Categoria/Plato test) may start before phase 1 is fully checked off. Strict TDD Mode is enabled but fails closed with no runner — phase 1 makes it fail open.

## 1. Test Runner Bootstrap (Jest) — HARD GATE, do first

- [x] 1.1 Add `jest`, `ts-jest`, `@types/jest`, `@nestjs/testing` to `apps/api/package.json` devDependencies; run `pnpm install`
- [x] 1.2 Create `apps/api/jest.config.js` (`preset: "ts-jest"`, `rootDir: "src"`, `testRegex: ".*\\.spec\\.ts$"`)
- [x] 1.3 Add `"test": "jest"` script to `apps/api/package.json`
- [x] 1.4 Add `"test": { "dependsOn": ["^build"] }` to `turbo.json`
- [x] 1.5 Create `apps/api/src/app.smoke.spec.ts` — one trivial passing assertion (e.g. `expect(true).toBe(true)`), no app bootstrap required
- [x] 1.6 Run `pnpm --filter api test` and confirm it passes — GATE: do not proceed to phase 3/4 until this is green
- [x] 1.7 Flip `openspec/config.yaml`: `apply.tdd: true`, `apply.test_command` and `verify.test_command` to `"pnpm --filter api test"`

_Satisfies: design.md "Sequencing is a hard constraint"; proposal.md Risk "TDD starts before Jest is wired"._

## 2. Prisma + Config Bootstrap

- [x] 2.1 Add `@prisma/client`, `@nestjs/config`, `class-validator`, `class-transformer` (deps) and `prisma` (devDep) to `apps/api/package.json`; run `pnpm install`
- [x] 2.2 Run `prisma init` (or hand-author) `apps/api/prisma/schema.prisma` with `Categoria` and `Plato` models exactly as specified in design.md (`precio Int`, `disponible Boolean @default(true)`, nullable `orgId`/`sucursalId` on both, `categoriaId` FK on `Plato`)
- [x] 2.3 Create `apps/api/.env.example` with `DATABASE_URL="postgresql://comanda:comanda@localhost:5432/comanda?schema=public"`; confirm `.env` stays gitignored
- [x] 2.4 Create `apps/api/src/prisma/prisma.service.ts` (`PrismaService extends PrismaClient`, `onModuleInit` → `$connect`, `onModuleDestroy` → `$disconnect`)
- [x] 2.5 Create `apps/api/src/prisma/prisma.module.ts` (`@Global() @Module({ providers: [PrismaService], exports: [PrismaService] })`)
- [x] 2.6 Wire `ConfigModule.forRoot({ isGlobal: true })` and `PrismaModule` into `apps/api/src/app.module.ts`
- [x] 2.7 Run `docker compose up -d` (Postgres 16) then `prisma migrate dev` to generate the additive migration under `apps/api/prisma/migrations/`
- [x] 2.8 Run `pnpm --filter api test` — confirm still green (no domain code yet, gate must still hold)

_Satisfies: catalogo spec persistence prerequisites; design.md Architecture Decisions (Prisma wiring, Config, Tenancy); proposal.md Risk "Prisma migration fails against Postgres"._

## 3. Categorias (test-first)

- [x] 3.1 Write `apps/api/src/catalogo/categorias/categorias.service.spec.ts` — failing tests against a mocked `PrismaService` for: create (persists + returns), list (returns all), update existing (200-path), update nonexistent (throws/404-mappable), delete existing, delete nonexistent
- [x] 3.2 Confirm the new spec fails for the right reason (module doesn't exist yet) — `pnpm --filter api test`
- [x] 3.3 Create `apps/api/src/catalogo/categorias/categorias.service.ts` implementing create/findAll/update/delete against `PrismaService`, throwing `NotFoundException` on missing id — make 3.1 pass
- [x] 3.4 Create `apps/api/src/catalogo/categorias/dto/create-categoria.dto.ts` (`@IsString @IsNotEmpty nombre`) and `dto/update-categoria.dto.ts` (same field, `@IsOptional()`)
- [x] 3.5 Create `apps/api/src/catalogo/categorias/categorias.controller.ts` — `POST /categorias`, `GET /categorias`, `PATCH /categorias/:id`, `DELETE /categorias/:id`, mirroring `health/`'s controller shape
- [x] 3.6 Create `apps/api/src/catalogo/categorias/categorias.module.ts`
- [x] 3.7 Wire `CategoriasModule` into `apps/api/src/app.module.ts`
- [x] 3.8 Run `pnpm --filter api test` — confirm all Categoria tests pass

_Satisfies: catalogo spec Requirements "Create/List/Update/Delete Categoria"._

## 4. Platos (test-first)

- [x] 4.1 Write `apps/api/src/catalogo/platos/platos.service.spec.ts` — failing tests against a mocked `PrismaService` for: create with default `disponible=true`, create rejects when `categoriaId` doesn't exist (service surfaces a 400/404-mappable error, per catalogo spec "Invalid payload rejected"), list all, list filtered by `categoriaId`, update toggling `disponible`, update nonexistent, update with invalid `precio`/`categoriaId` rejected, delete existing, delete nonexistent
- [x] 4.2 Confirm the new spec fails for the right reason — `pnpm --filter api test`
- [x] 4.3 Create `apps/api/src/catalogo/platos/platos.service.ts` implementing create (validates `categoriaId` exists via Prisma before insert)/findAll (optional `categoriaId` filter)/update/delete — make 4.1 pass
- [x] 4.4 Create `apps/api/src/catalogo/platos/dto/create-plato.dto.ts` (`nombre: @IsString @IsNotEmpty`, `precio: @IsInt @Min(0)`, `categoriaId: @IsUUID`, `disponible?: @IsOptional @IsBoolean`) and `dto/update-plato.dto.ts` (same fields, all `@IsOptional()`)
- [x] 4.5 Create `apps/api/src/catalogo/platos/platos.controller.ts` — `POST /platos`, `GET /platos` (+ `?categoriaId=` query), `PATCH /platos/:id`, `DELETE /platos/:id`
- [x] 4.6 Create `apps/api/src/catalogo/platos/platos.module.ts`
- [x] 4.7 Wire `PlatosModule` into `apps/api/src/app.module.ts`
- [x] 4.8 Run `pnpm --filter api test` — confirm all Plato tests pass

_Satisfies: catalogo spec Requirements "Create/List/Update/Delete Plato", "Precio as integer centavos"._

## 5. Global Validation Wiring

- [x] 5.1 Add `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))` to `apps/api/src/main.ts`
- [x] 5.2 Confirm all four DTOs from phases 3–4 are correctly decorated (re-check against design.md's DTO spec — no missing `@IsOptional()` on update DTOs)
- [x] 5.3 Run `pnpm --filter api test` — confirm still green

_Satisfies: catalogo spec "Missing nombre rejected", "Invalid payload rejected", "Non-integer precio rejected"; design.md Threat Matrix (HTTP body trust boundary)._

## 6. `packages/shared` Contracts

- [ ] 6.1 Add `Categoria` and `Plato` interfaces to `packages/shared/src/index.ts` exactly as specified in design.md (including nullable `orgId`/`sucursalId`)
- [ ] 6.2 Add `CreateCategoriaInput`/`UpdateCategoriaInput`/`CreatePlatoInput`/`UpdatePlatoInput` types
- [ ] 6.3 Add `centavosToPesos`/`pesosToCentavos` conversion helpers
- [ ] 6.4 Add a colocated spec for the conversion helpers (round-trip, decimals, zero) — per design.md Testing Strategy "cents read as pesos" risk
- [ ] 6.5 Add the 8 CRUD fetch wrappers (`listCategorias`, `createCategoria`, `updateCategoria`, `deleteCategoria`, `listPlatos`, `createPlato`, `updatePlato`, `deletePlato`) — `baseUrl` first param, `fetch` + `Content-Type: application/json`, `throw new Error` on `!res.ok` (documented deviation from `pingApi`'s sentinel style, per design.md Architecture Decisions)
- [ ] 6.6 Run `pnpm --filter api test` (or the shared package's own test script if one exists) — confirm green

_Satisfies: catalogo-admin spec's dependency on shared contracts; design.md Architecture Decisions ("Shared errors")._

## 7. Admin UI (`apps/web`)

- [ ] 7.1 Create `apps/web/app/catalogo/page.tsx` — `"use client"`, state shape per design.md (`categorias`, `platos`, `form`, `editandoPlatoId`, `nuevaCategoria`, `error`, `cargando`)
- [ ] 7.2 Implement mount-time `Promise.all([listCategorias, listPlatos])` load with error surfacing
- [ ] 7.3 Implement Categoria create form + table row rendering
- [ ] 7.4 Implement Plato create/edit form (`pesosToCentavos` on submit, `categoriaId` select) + table rendering (`centavosToPesos` for display)
- [ ] 7.5 Implement inline `disponible` toggle calling `updatePlato(url, id, { disponible: !p.disponible })`
- [ ] 7.6 Implement delete actions for both Categoria and Plato, removing from local state on success
- [ ] 7.7 Ensure every create/update/delete failure path sets `error` and leaves the list unchanged (no optimistic apply before success)

_Satisfies: catalogo-admin spec — all 7 requirements (List, Create, Edit, Delete, Toggle inline, Surface API errors, Integer centavos in UI)._

## 8. Manual End-to-End Verification

- [ ] 8.1 `docker compose up -d` — confirm Postgres 16 is reachable
- [ ] 8.2 `prisma migrate dev` — confirm `Categoria`/`Plato` tables exist with nullable `org_id`/`sucursal_id` columns
- [ ] 8.3 `pnpm --filter api test` — full suite green
- [ ] 8.4 `pnpm --filter api dev` (or equivalent) + curl smoke tests: `POST /categorias`, `GET /categorias`, `POST /platos` (valid + invalid `categoriaId` → 400/404), `GET /platos?categoriaId=`, `PATCH /platos/:id` (toggle `disponible`), `DELETE` both
- [ ] 8.5 `pnpm dev` (web) — load `/catalogo` in a browser, verify list/create/edit/delete/toggle end-to-end and that an invalid submission surfaces a visible error
- [ ] 8.6 `pnpm build` — confirm strict mode passes across the monorepo

_Satisfies: proposal.md Success Criteria (all five checkboxes)._

---

## Review Workload Forecast

**Estimated changed/new lines**: ~800–900 lines across 3 apps/packages.

Rough breakdown:
- Phase 1 (Jest bootstrap): ~35 lines
- Phase 2 (Prisma/config): ~95–110 lines (schema, generated migration SQL, service/module, wiring)
- Phase 3 (Categorias, test-first): ~180 lines (spec + service + controller + module + 2 DTOs)
- Phase 4 (Platos, test-first): ~220 lines (spec is larger — more validation branches — + service + controller + module + 2 DTOs)
- Phase 5 (ValidationPipe wiring): ~5 lines
- Phase 6 (shared contracts): ~80–100 lines (interfaces, types, conversion helpers + spec, 8 fetch wrappers)
- Phase 7 (admin page): ~150–200 lines (single file, forms + two tables + state + effects)
- Misc config diffs (`package.json`, `turbo.json`, `openspec/config.yaml`): ~20 lines

**File count**: 17 new files per design.md's File Changes table, plus 2 additional new spec files implied by the Testing Strategy but not itemized there (`categorias.service.spec.ts`, `platos.service.spec.ts`) — so effectively ~19–20 new files, and 6 modified files.

**Chained-PR recommendation**: **Yes.** This spans three independently-buildable layers (test infra, Prisma persistence, HTTP+UI) that map cleanly onto phases 1–2 / 3–5 / 6–8, and each phase is independently testable and revertible per proposal.md's Rollback Plan ("the Prisma + Jest foundation can stay while only `catalogo` and the web route revert"). A natural 3-PR split:
1. Phase 1–2 (test runner + Prisma/config bootstrap)
2. Phase 3–5 (Categorias + Platos + validation wiring)
3. Phase 6–8 (shared contracts + admin UI + manual verification)

**400-line budget risk**: **High** for a single PR covering the whole change (~800–900 lines, well over 2x budget); **Low–Medium** per phase-split PR above (each lands at roughly 150–350 lines).

**Decision needed before apply**: **Yes.** Recommend the orchestrator confirm the 3-PR chained split above with the user before invoking `sdd-apply`, since a single-PR apply would exceed the 400-line review budget by a wide margin and mixes an infra-only PR (low review risk) with domain CRUD (medium risk, needs the categoriaId-existence-check path scrutinized) and UI (needs the error-surfacing and no-optimistic-apply behavior scrutinized).
