# Tasks: Iter 3 — Pedidos

No toolchain bootstrap needed — Jest, Prisma, `PrismaService`, `@nestjs/config`, and the global `ValidationPipe` all already exist from Iter 1/2. Work starts directly at RED-first tests. Strict TDD Mode is enabled; every domain task follows RED before GREEN.

This iteration is larger than Iter 1/2: a new two-table aggregate, the repo's first cross-module service coupling, and a required correctness fix on two *existing* Iter 1/2 files (`platos.service.ts`, `mesas.service.ts`) that the new `Restrict` FKs expose. Section 2 below is scoped to that existing-file patch and is not optional polish — see design.md's Architecture Decisions on the `ItemPedido.platoId` and `Pedido.mesaId` FKs.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~780–860 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (schema + P2003 fix + PedidosService domain) → PR 2 (HTTP layer + cross-module wiring + shared contracts) → PR 3 (admin UI + config refresh) |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

Rough breakdown:
- Schema + migration (`schema.prisma`, migration folder): ~65
- `platos.service.spec.ts` + `platos.service.ts` P2003 patch: ~25
- `mesas.service.spec.ts` + `mesas.service.ts` P2003 patch + `assertMesaExists`/`marcarEstado`: ~90
- `mesas.module.ts` export line: ~2
- `estado-pedido.ts` (transition map + guard): ~20
- `pedidos.service.spec.ts` + `pedidos.service.ts` (create, findAll, updateEstado, transaction, snapshot, guards): ~260
- DTOs + `pedidos.controller.ts` + `pedidos.module.ts` + `app.module.ts` diff: ~110
- `packages/shared/src/index.ts` additions (types, `SIGUIENTE_ESTADO_PEDIDO`, 3 wrappers): ~75
- `apps/web/app/pedidos/page.tsx`: ~220
- `openspec/config.yaml` context refresh: ~15

Total sits well above the ~400-line single-PR budget even before counting test scaffolding, so a 3-way chain is proposed rather than Iter 2's 2-way split:

- **PR 1 — Backend domain (schema + existing-file fix + `PedidosService`)**: the two riskiest, most review-worthy pieces — the additive migration and the P2003→409 correctness fix on code that predates this change — land together with the new service's RED-first unit suite, before any HTTP surface exists to depend on it. Isolates the cross-module coupling's core logic (`assertMesaExists`, `marcarEstado`) for focused review.
- **PR 2 — HTTP layer + cross-module wiring + shared contracts (targets PR 1's branch)**: `pedidos.controller.ts`, DTOs, `app.module.ts`, `MesasModule` export, and `packages/shared` land together since the HTTP contract and the shared client types describe the same interface — reviewing them apart would mean cross-referencing two PRs to check one contract.
- **PR 3 — Admin UI + config refresh (targets PR 2's branch)**: `/pedidos` page is the largest single file (~220 lines) and has no new domain logic of its own — pure consumption of PR 2's shared contracts — so it reviews cleanly on its own, same shape as Iter 2's UI PR.

Only the tracker PR merges to `main`; PR 2 targets PR 1's branch, PR 3 targets PR 2's branch (feature-branch-chain, per Iter 1/2 convention). Orchestrator confirms the 3-way split with the user before `sdd-apply`, since it deviates from Iter 2's 2-way pattern.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Schema + P2003 fix on `PlatosService`/`MesasService` + `PedidosService` domain logic complete and tested | PR 1 | `pnpm --filter api test` | `docker compose up -d && pnpm --filter api dev` | Revert `Pedido`/`ItemPedido`/enums in `schema.prisma`, the migration folder, `apps/api/src/pedidos/*.service.ts` + its spec, and the P2003 mapping in `platos.service.ts`/`mesas.service.ts` — `Categoria`/`Plato`/`Mesa` rows untouched |
| 2 | `/pedidos` HTTP contract live, `MesasService` exported and injected, `packages/shared` contracts complete | PR 2 (targets PR 1's branch) | `pnpm --filter api test` + curl `POST/GET/PATCH /pedidos` | `pnpm --filter api dev` + curl | Revert `pedidos.controller.ts`, DTOs, `pedidos.module.ts`, the `app.module.ts` registration, `mesas.module.ts` export, and the `Pedido`/`ItemPedido` exports in `packages/shared/src/index.ts` — Unit 1's service logic stays intact but unreachable |
| 3 | `/pedidos` admin screen live end-to-end | PR 3 (targets PR 2's branch) | `pnpm --filter shared test` | `pnpm dev` (web) — create a mesa pedido, watch `/salon` turn amber, advance through every state | Revert `apps/web/app/pedidos/page.tsx` and the `openspec/config.yaml` context refresh — API + shared layers (Units 1–2) stay intact |

## 1. Prisma Schema & Migration

- [x] 1.1 Add `enum TipoServicio { mesa barra }`, `enum EstadoPedido { abierto enviado_a_cocina en_preparacion listo entregado cobrado cerrado }`, `model Pedido`, and `model ItemPedido` to `apps/api/prisma/schema.prisma` exactly per design.md Interfaces/Contracts (`Pedido.mesaId` and `ItemPedido.platoId` both `onDelete: Restrict`; `ItemPedido.pedidoId` `onDelete: Cascade`; nullable `orgId`/`sucursalId` on `Pedido`)
- [x] 1.2 Add back-relation fields only (no new column): `Mesa.pedidos Pedido[]`, `Plato.itemsPedido ItemPedido[]`
- [x] 1.3 Run `docker compose up -d` then `prisma migrate dev` to generate the additive migration under `apps/api/prisma/migrations/` — confirm `Categoria`/`Plato`/`Mesa` columns are untouched
- [x] 1.4 Run `pnpm --filter api test` — confirm still green (no domain code yet)

_Satisfies: pedidos spec "Create Pedido with items", "tipoServicio determines mesaId requirement", "Linear EstadoPedido transitions"; design.md Interfaces/Contracts; proposal.md Success Criteria "migrate dev creates Pedido/ItemPedido + both enums without altering Categoria/Plato/Mesa"._

## 2. Existing-File Patch: P2003 Handling + Cross-Module Methods (Iter 1/2 files)

This section modifies code that shipped in Iter 1/2, not new Pedidos code. The new `Restrict` FKs on `ItemPedido.platoId` and `Pedido.mesaId` mean `DELETE /platos/:id` or `DELETE /mesas/:id` against a row referenced by an existing `Pedido` now raises Prisma error P2003 — and the existing `isNotFoundError` helpers in both services only catch P2025, so P2003 falls through to an unhandled 500. RED-first, same shape as the existing P2025 tests.

- [x] 2.1 In `apps/api/src/catalogo/platos/platos.service.spec.ts`, add a failing test: `remove()` on a `Plato` referenced by an `ItemPedido` (mock `prisma.plato.delete` rejecting with `{ code: "P2003" }`) MUST throw `ConflictException`, not the unhandled Prisma error
- [x] 2.2 Run `pnpm --filter api test` — confirm 2.1 fails for the right reason (P2003 currently rethrown as-is, test expects `ConflictException`)
- [x] 2.3 In `apps/api/src/catalogo/platos/platos.service.ts`, add a P2003 check (alongside the existing P2025 `isNotFoundError` check) that throws `ConflictException` in `remove()` — make 2.1 pass
- [x] 2.4 In `apps/api/src/salon/mesas/mesas.service.spec.ts`, add the equivalent failing test: `remove()` on a `Mesa` referenced by an existing `Pedido` (mock `prisma.mesa.delete` rejecting with `{ code: "P2003" }`) MUST throw `ConflictException`
- [x] 2.5 Run `pnpm --filter api test` — confirm 2.4 fails for the right reason
- [x] 2.6 In `apps/api/src/salon/mesas/mesas.service.ts`, add the same P2003 → `ConflictException` mapping in `remove()` — make 2.4 pass
- [x] 2.7 In `mesas.service.spec.ts`, add failing tests for two new methods the cross-module coupling needs: `assertMesaExists(mesaId)` throws `BadRequestException` when no `Mesa` matches; `marcarEstado(tx, mesaId, estado)` calls `tx.mesa.update({ where: { id: mesaId }, data: { estado } })` against the passed transaction client, not `this.prisma`
- [x] 2.8 Run `pnpm --filter api test` — confirm 2.7 fails (methods don't exist yet)
- [x] 2.9 Implement `assertMesaExists` and `marcarEstado(tx: Prisma.TransactionClient, mesaId: string, estado: EstadoMesa)` in `mesas.service.ts` — make 2.7 pass
- [x] 2.10 Add `exports: [MesasService]` to `apps/api/src/salon/mesas/mesas.module.ts`
- [x] 2.11 Run `pnpm --filter api test` — confirm the full suite is green with no regression on existing `Plato`/`Mesa` tests

_Satisfies: design.md Architecture Decisions "`ItemPedido.platoId` FK" and "`Pedido.mesaId` FK" (P2003 → 409 mapping, explicitly required, not optional); "Cross-module coupling" (`assertMesaExists`, `marcarEstado`, `MesasModule` export)._

## 3. Pedidos Service (test-first)

- [x] 3.1 Create `apps/api/src/pedidos/estado-pedido.ts` — the `SIGUIENTE: Record<EstadoPedido, EstadoPedido | null>` linear-chain map exactly per design.md, plus an `assertTransicionValida(actual, destino)` guard throwing `BadRequestException` on mismatch
- [x] 3.2 Write `apps/api/src/pedidos/pedidos.service.spec.ts` — failing tests against a mocked `PrismaService` (with `$transaction: jest.fn(async (cb) => cb(prisma))`) and a mocked `MesasService` (`{ assertMesaExists: jest.fn(), marcarEstado: jest.fn() }`), covering:
  - `create`: snapshots `nombre`/`precioUnitario` from `Plato` at creation (not a live read)
  - `create`: rejects an unknown `platoId` with `BadRequestException`, persists nothing
  - `create`: `tipoServicio=mesa` without `mesaId` → `BadRequestException`
  - `create`: `tipoServicio=barra` **with** `mesaId` → `BadRequestException`
  - `create`: `tipoServicio=mesa` with unknown `mesaId` → `BadRequestException` (via `assertMesaExists` rejecting)
  - `create`: on success with `tipoServicio=mesa`, calls `marcarEstado(tx, mesaId, "pedido_en_curso")` **inside** the `$transaction` callback
  - `create`: on success with `tipoServicio=barra`, never calls `marcarEstado`
  - `updateEstado`: table-driven over **every** `(actual, destino)` pair in `EstadoPedido` — the 6 legal linear transitions pass, all others (skips, reversals, no-ops) throw `BadRequestException`, including the terminal `cerrado → anything`
  - `updateEstado`: reaching `cerrado` on a `mesa` pedido calls `marcarEstado(tx, mesaId, "libre")`; on a `barra` pedido it does not
  - `updateEstado`/`findOne` on a nonexistent id maps P2025 → `NotFoundException`
- [x] 3.3 Run `pnpm --filter api test` — confirm 3.2 fails for the right reason (module doesn't exist yet)
- [x] 3.4 Create `apps/api/src/pedidos/pedidos.service.ts` implementing `create`, `findAll`, `findOne`, `updateEstado` against `PrismaService` + injected `MesasService`, using the interactive `$transaction` form and `estado-pedido.ts`'s guard — make 3.2 pass
- [x] 3.5 Run `pnpm --filter api test` — confirm all `PedidosService` tests pass and no regression elsewhere

_Satisfies: pedidos spec "Create Pedido with items", "tipoServicio determines mesaId requirement", "platoId FK validation", "Linear EstadoPedido transitions", "Mesa coupling on Pedido lifecycle"; salon spec (MODIFIED) "pedido_en_curso has a manual path and an automatic driver"; design.md Architecture Decisions "Transition map", "Cross-module coupling", "Transaction boundary"._

## 4. Pedidos HTTP Layer & Cross-Module Wiring

- [x] 4.1 Create `apps/api/src/pedidos/dto/create-item-pedido.dto.ts` (`platoId: @IsUUID`, `cantidad: @IsInt @Min(1)`)
- [x] 4.2 Create `apps/api/src/pedidos/dto/create-pedido.dto.ts` (`tipoServicio: @IsEnum(TipoServicio)`, `mesaId?: @IsOptional @IsUUID`, `items: @IsArray @ArrayNotEmpty @ValidateNested({each:true}) @Type(() => CreateItemPedidoDto)`)
- [x] 4.3 Create `apps/api/src/pedidos/dto/update-estado-pedido.dto.ts` (`estado: @IsEnum(EstadoPedido)`), hand-written, no `@nestjs/mapped-types`
- [x] 4.4 Create `apps/api/src/pedidos/pedidos.controller.ts` — `POST /pedidos`, `GET /pedidos`, `GET /pedidos/:id`, `PATCH /pedidos/:id/estado`, mirroring `mesas.controller.ts`'s shape
- [x] 4.5 Create `apps/api/src/pedidos/pedidos.module.ts` — imports `MesasModule` (for `MesasService` injection per §2), registers `PedidosController`/`PedidosService`
- [x] 4.6 Wire `PedidosModule` into `apps/api/src/app.module.ts` imports
- [x] 4.7 Verify the existing global `ValidationPipe` rejects `items: []`, `cantidad: 0`, an unknown `tipoServicio`/`estado` enum value, and unknown fields on `/pedidos` with 400 (curl or a supertest case)
- [x] 4.8 Run `pnpm --filter api test` — confirm still green

_Satisfies: pedidos spec "Invalid payload rejected" (via Create Pedido scenario), "List and get Pedido"; design.md Interfaces/Contracts (HTTP method table); design.md Threat Matrix (HTTP body trust boundary via the existing global `ValidationPipe`)._

## 5. `packages/shared` Contracts

- [x] 5.1 Add `TipoServicio`, `EstadoPedido` types and `ItemPedido`, `Pedido` interfaces to `packages/shared/src/index.ts` exactly per design.md (including nullable `orgId`/`sucursalId` on `Pedido`)
- [x] 5.2 Add `CreatePedidoInput` type and `SIGUIENTE_ESTADO_PEDIDO: Record<EstadoPedido, EstadoPedido | null>` mirroring `apps/api/src/pedidos/estado-pedido.ts` (accepted duplication, same pattern as `EstadoMesa` in Iter 2 — `apps/api` does not depend on `@comanda/shared`)
- [x] 5.3 Add the 3 fetch wrappers (`listPedidos`, `createPedido`, `avanzarEstadoPedido`) — `baseUrl` first param, reusing `parseJsonOrThrow`/`throwIfNotOk`, same style as the `Mesa`/`Plato` wrappers. No `deletePedido` wrapper — there is no `DELETE /pedidos/:id` this iteration
- [x] 5.4 Run `pnpm --filter shared test` (or `pnpm --filter api test` if shared has no own script) — confirm green

_Satisfies: pedidos-admin spec's dependency on shared contracts; design.md Interfaces/Contracts._

## 6. Admin UI (`apps/web/app/pedidos/page.tsx`)

- [x] 6.1 Create `apps/web/app/pedidos/page.tsx` — `"use client"`, state shape per design.md (`pedidos`, `mesas`, `platos`, `form: { tipoServicio, mesaId, items }`, `error`, `cargando`)
- [x] 6.2 Implement mount-time `useEffect` firing `listPedidos`, `listMesas`, `listPlatos` together, with error surfacing
- [x] 6.3 Implement the alta form: `tipoServicio` `<select>`; the `mesaId` `<select>` renders **only** when `tipoServicio === "mesa"`, listing `estado === "libre"` mesas; a repeatable row adds `platoId` + `cantidad` lines from the `Plato` list; running total via `centavosToPesos`, display-only
- [x] 6.4 Implement the pedido list: one card per pedido showing `estado`, `tipoServicio`, its items (`nombre` × `cantidad` at `centavosToPesos(precioUnitario)` — the snapshot, never a live `Plato` lookup) and the line total
- [x] 6.5 Implement the single `Avanzar a {SIGUIENTE_ESTADO_PEDIDO[estado]}` button per card; when the value is `null` (`cerrado`) the button is **not rendered** — forward-only, no jumps, no wrap-around
- [x] 6.6 On advance success, `setPedidos` from the resolved response only (no optimistic apply); on failure set `error` and leave the card's estado unchanged
- [x] 6.7 Ensure every create/advance failure path sets `error` and leaves the list unchanged

_Satisfies: pedidos-admin spec — all 4 requirements (Create Pedido with items, List Pedidos, Advance Pedido state respecting linear order, Surface API errors)._

## 7. Config Refresh & Manual Verification

- [x] 7.1 Refresh the `context:` block in `openspec/config.yaml` to include the `pedidos` module
- [x] 7.2 `prisma migrate dev` — confirm `Pedido`/`ItemPedido` + both enums exist with nullable `org_id`/`sucursal_id` columns, `Categoria`/`Plato`/`Mesa` untouched
- [x] 7.3 `pnpm --filter api test` — full suite green, regression check across `catalogo`, `salon`, `pedidos`
- [x] 7.4 `pnpm --filter api dev` + curl smoke tests: `POST /pedidos` (mesa + barra, valid + invalid → 400), `GET /pedidos`, `PATCH /pedidos/:id/estado` (legal transitions through to `cerrado`, illegal skip/reverse → 400, nonexistent id → 404); confirm `DELETE /platos/:id` and `DELETE /mesas/:id` on a referenced row now return 409 instead of 500
- [x] 7.5 `pnpm dev` (web) — load `/pedidos`: create a mesa pedido, confirm `/salon` shows that Mesa amber (`pedido_en_curso`) without a direct `PATCH /mesas/:id` call; advance the pedido through every state to `cerrado`, confirm the Mesa returns to `libre`; confirm the manual `PATCH /mesas/:id` card-click cycle from Iter 2 still works
- [x] 7.6 `pnpm build` — confirm strict mode passes across the monorepo, `/pedidos` route compiles

_Satisfies: proposal.md Success Criteria (all checkboxes); salon spec (MODIFIED) scenarios "Creating a mesa Pedido automatically sets pedido_en_curso", "Closing the linked Pedido automatically frees the Mesa", "Manual path still works after Pedido exists"._
