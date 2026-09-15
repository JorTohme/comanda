# Tasks: Iter 2 — Salón

No toolchain bootstrap needed — Jest, Prisma, `PrismaService`, `@nestjs/config`, and the global `ValidationPipe` all already exist from Iter 1. Work starts directly at RED-first tests on `MesasService`. Strict TDD Mode is enabled; every domain task follows RED before GREEN.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~540–580 |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (backend domain) → PR 2 (shared contracts + admin UI + config) |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: Medium

Rough breakdown: schema+migration ~55, `mesas.service.spec.ts` + `mesas.service.ts` ~175, DTOs+controller+module+`app.module.ts` diff ~75, `packages/shared` additions ~55, `apps/web/app/salon/page.tsx` ~190, `openspec/config.yaml` context refresh ~12.

**Chain strategy recommendation**: `feature-branch-chain` — the strategy Iter 1 used successfully (PR #1 as draft tracker, PR #2 targets PR #1's branch, only the tracker merges to main). Not locked in; orchestrator confirms with the user since the forecast is above budget for a single PR.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Mesa persistence + HTTP contract complete and tested | PR 1 | `pnpm --filter api test` | `docker compose up -d && pnpm --filter api dev` + curl `POST/GET/PATCH/DELETE /mesas` | Revert `Mesa`/`EstadoMesa` in `schema.prisma`, the migration folder, and `apps/api/src/salon/` — `Categoria`/`Plato` untouched |
| 2 | `packages/shared` Mesa contracts + `/salon` admin screen live end-to-end | PR 2 (targets PR 1's branch) | `pnpm --filter shared test` | `pnpm dev` (web) — load `/salon`, click-cycle a card, CRUD round-trip | Revert `Mesa` exports in `packages/shared/src/index.ts`, `apps/web/app/salon/page.tsx`, and the `openspec/config.yaml` context refresh — API layer (Unit 1) stays intact |

## 1. Prisma Schema & Migration

- [x] 1.1 Add `enum EstadoMesa { libre ocupada pedido_en_curso }` and `model Mesa` to `apps/api/prisma/schema.prisma` exactly per design.md (`nombre String`, `capacidad Int`, `estado EstadoMesa @default(libre)`, nullable `orgId`/`sucursalId`, `createdAt`/`updatedAt`)
- [x] 1.2 Run `docker compose up -d` then `prisma migrate dev` to generate the additive migration under `apps/api/prisma/migrations/` — confirm `Categoria`/`Plato` are untouched
- [x] 1.3 Run `pnpm --filter api test` — confirm still green (no domain code yet)

_Satisfies: salon spec "Three-state occupancy enum"; design.md Interfaces/Contracts; proposal.md Success Criteria "migrate dev creates Mesa + EstadoMesa without altering Categoria/Plato"._

## 2. Mesas Service (test-first)

- [x] 2.1 Write `apps/api/src/salon/mesas/mesas.service.spec.ts` — failing tests against a mocked `PrismaService` for: create defaults `estado=libre` when omitted, create honors an explicit `estado`, `findAll()` calls `findMany({})`, `update` persists each of the three `estado` values, `update`/`remove` map Prisma P2025 → `NotFoundException`, `remove` returns the deleted row
- [x] 2.2 Confirm the new spec fails for the right reason (module doesn't exist yet) — `pnpm --filter api test`
- [x] 2.3 Create `apps/api/src/salon/mesas/mesas.service.ts` implementing create/findAll/update/remove against `PrismaService` — no FK pre-check, `Mesa` references nothing — make 2.1 pass
- [x] 2.4 Run `pnpm --filter api test` — confirm all Mesa service tests pass

_Satisfies: salon spec "Create Mesa", "List Mesas", "Update Mesa", "Delete Mesa", "Three-state occupancy enum", "pedido_en_curso is operator-asserted"._

## 3. Mesas HTTP Layer

- [x] 3.1 Create `apps/api/src/salon/mesas/dto/create-mesa.dto.ts` (`nombre: @IsString @IsNotEmpty`, `capacidad: @IsInt @Min(1)`, `estado?: @IsOptional @IsEnum(EstadoMesa)`)
- [x] 3.2 Create `apps/api/src/salon/mesas/dto/update-mesa.dto.ts` — same fields, all `@IsOptional()`, hand-written (no `@nestjs/mapped-types`)
- [x] 3.3 Create `apps/api/src/salon/mesas/mesas.controller.ts` — `POST /mesas`, `GET /mesas`, `PATCH /mesas/:id`, `DELETE /mesas/:id`, mirroring `apps/api/src/catalogo/platos/platos.controller.ts`'s shape
- [x] 3.4 Create `apps/api/src/salon/mesas/mesas.module.ts`
- [x] 3.5 Wire `MesasModule` into `apps/api/src/app.module.ts` imports
- [x] 3.6 Verify the existing global `ValidationPipe` rejects `capacidad: 0`, a non-enum `estado`, and unknown fields on `/mesas` with 400 (curl or a supertest case)
- [x] 3.7 Run `pnpm --filter api test` — confirm still green

_Satisfies: salon spec "Invalid payload rejected", "Invalid update rejected", "Unknown estado rejected"; design.md Threat Matrix (HTTP body trust boundary, covered by the existing global ValidationPipe)._

## 4. `packages/shared` Contracts

- [x] 4.1 Add `EstadoMesa` type and `Mesa` interface to `packages/shared/src/index.ts` exactly per design.md (including nullable `orgId`/`sucursalId`)
- [x] 4.2 Add `CreateMesaInput`/`UpdateMesaInput` types
- [x] 4.3 Add the 4 fetch wrappers (`listMesas`, `createMesa`, `updateMesa`, `deleteMesa`) — `baseUrl` first param, reusing `parseJsonOrThrow`/`throwIfNotOk`, same style as the `Plato` wrappers
- [x] 4.4 Run `pnpm --filter shared test` (or `pnpm --filter api test` if shared has no own script) — confirm green

_Satisfies: salon-admin spec's dependency on shared contracts; design.md Interfaces/Contracts._

## 5. Admin UI (`apps/web/app/salon/page.tsx`)

- [x] 5.1 Create `apps/web/app/salon/page.tsx` — `"use client"`, state shape per design.md (`mesas`, `form`, `editandoMesaId`, `error`, `cargando`)
- [x] 5.2 Implement mount-time `listMesas` load with error surfacing
- [x] 5.3 Implement the grilla: `<ul>` CSS-grid of `<li>` holding a card `<button>` (nombre, capacidad, estado label + `COLOR_ESTADO` background) plus sibling `Editar`/`Eliminar` buttons — never nest interactive elements
- [x] 5.4 Implement `handleCiclarEstado` using the fixed `SIGUIENTE_ESTADO` map, calling `updateMesa` and updating local state only from the resolved response (no optimistic apply)
- [x] 5.5 Implement the CRUD `<form>` (nombre + capacidad, `type="number"` `min={1}`) for create/edit/cancel, mirroring `apps/web/app/catalogo/page.tsx`
- [x] 5.6 Implement delete, removing the card from local state on success
- [x] 5.7 Ensure every create/update/delete/cycle failure path sets `error` and leaves the grid unchanged

_Satisfies: salon-admin spec — all 6 requirements (Grid display, Create, Edit, Delete, Cycle occupancy by click, Surface API errors)._

## 6. Config Refresh & Manual Verification

- [x] 6.1 Refresh the stale `context:` block in `openspec/config.yaml` (predates Iter 1) to reflect the current stack, testing setup, and the Mesa/Salon addition
- [x] 6.2 `prisma migrate dev` — confirm `Mesa` + `EstadoMesa` exist with nullable `org_id`/`sucursal_id` columns (verified in PR 1; re-confirmed via `GET /mesas` returning `orgId`/`sucursalId: null` in PR 2's smoke test)
- [x] 6.3 `pnpm --filter api test` — full suite green (25/25, regression check for PR 2)
- [x] 6.4 `pnpm --filter api dev` + curl smoke tests: `POST /mesas` (valid + invalid `capacidad`/`estado` → 400 — covered in PR 1), `GET /mesas`, `PATCH /mesas/:id` (each of the 3 estado values + nonexistent id → 404), `DELETE /mesas/:id` (existing + nonexistent → 404) — re-run in PR 2 as part of curl-based e2e simulation
- [x] 6.5 `pnpm dev` (web) — load `/salon` (curl-based simulation: browser unavailable in this environment; confirmed HTTP 200 + "Salón" heading rendered), full create/cycle-through-all-3-states/edit/delete round-trip simulated via curl directly against the running api (identical requests to what the page's fetch wrappers issue)
- [x] 6.6 `pnpm build` — confirm strict mode passes across the monorepo (4/4 packages green, `/salon` route compiled statically)

_Satisfies: proposal.md Success Criteria (all five checkboxes)._
