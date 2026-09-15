# Proposal: Iter 2 — Salón

## Intent

Iter 1 landed the catalog; nothing yet models *where* food is served. `ARCHITECTURE.md` §4 (line 87) scopes Iter 2 to "Mesas CRUD + estado de ocupación, grilla simple". Iter 3 (Pedidos) cannot assign an order to a table until `Mesa` exists, so Salón is the next blocking link.

## Scope

### In Scope

- `Mesa` model in `apps/api/prisma/schema.prisma`: `nombre: String`, `capacidad: Int`, `estado: EstadoMesa` enum (`libre` | `ocupada` | `pedido_en_curso`), plus the same nullable `org_id` / `sucursal_id` columns Iter 1 established.
- `salon/mesas/` NestJS module (`{module,controller,service}.ts` + `dto/`) mirroring `catalogo/platos/`, registered in `app.module.ts`.
- `Mesa` interface + `listMesas`/`createMesa`/`updateMesa`/`deleteMesa` wrappers in `packages/shared/src/index.ts`, reusing `parseJsonOrThrow`/`throwIfNotOk`.
- `apps/web/app/salon/page.tsx`: CSS-grid of clickable mesa cards colored by `estado`, click cycles occupancy; plain `<form>` CRUD alongside. No canvas, no coordinates, no UI library.

### Out of Scope

- **Plano 2D** (`pos_x`/`pos_y`/`rotacion`/`forma`/`ancho`/`alto`) — Fase 2 per doc §7.8/§8.
- Automatic `pedido_en_curso` transitions (needs `Pedido`, Iter 3); FK from `Mesa` to `Pedido`.
- Redis per-table locking (doc §7.2), mozo-facing toggle in `apps/operativa`, auth/tenancy enforcement.

## Capabilities

### New Capabilities

- `salon`: `Mesa` persistence + HTTP contract — CRUD, `capacidad`, three-state occupancy, validation.
- `salon-admin`: grid screen behavior against that API.

Split mirrors `catalogo`/`catalogo-admin`: API contract and UI behavior change for different reasons and are consumed by different clients (`apps/operativa` will read `salon` in Iter 3 without touching `salon-admin`).

### Modified Capabilities

- None.

## Approach

1. RED tests on `MesasService` first — the Jest runner already exists (`pnpm --filter api test`), no toolchain step this time.
2. Additive Prisma migration: new enum + table only; `Categoria`/`Plato` untouched.
3. `salon/mesas/` copied structurally from `catalogo/platos/`, class-validator DTOs behind the existing global `ValidationPipe`.
4. Shared contracts, then one page. `estado` drives a background color; the click handler PATCHes the next state.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/prisma/schema.prisma` | Modified | `EstadoMesa` enum + `Mesa` model, one additive migration |
| `apps/api/src/salon/mesas/` | New | module, controller, service, DTOs |
| `apps/api/src/app.module.ts` | Modified | register `MesasModule` |
| `packages/shared/src/index.ts` | Modified | `Mesa` types + fetch wrappers |
| `apps/web/app/salon/page.tsx` | New | grid + CRUD screen |
| `openspec/config.yaml` | Modified | `context:` block is stale (predates Iter 1) — refresh |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `pedido_en_curso` has **no automatic driver** this iteration — a table can claim an order that does not exist | High (accepted) | Confirmed product decision for doc-§7.8 vocabulary parity. Ships as a manual enum value only; spec MUST state it is operator-asserted, and Iter 3 wires the real transition without a schema change |
| `capacidad` ships unused until Iter 3 | Med (accepted) | Deliberate: avoids a second migration when Pedidos needs table sizing |
| Concurrent occupancy edits race (no Redis lock) | Low | Single-writer admin screen only; no real-time path until Iter 3/4 |
| Grid reimplements Iter 1's UI patterns inconsistently | Low | Same `"use client"` + local-array-update precedent as `/catalogo` |

## Rollback Plan

- **Schema**: migration only adds an enum and a table; no existing table altered and no prior Mesa data exists, so `prisma migrate reset` (or a down-migration dropping `Mesa` + `EstadoMesa`) is lossless.
- **Code**: `git revert` removes `salon/`, the shared exports and `apps/web/app/salon/`; `catalogo` and `health` are untouched.
- **Partial**: the API + shared contract can stay while only the web route reverts.

## Dependencies

- Postgres 16 and Prisma wiring from Iter 1 (already in place).
- Jest runner from Iter 1 (`pnpm --filter api test`).
- None external; `Pedido` is a *consumer* of this work, not a prerequisite.

## Success Criteria

- [ ] `pnpm --filter api test` passes with `MesasService` tests written RED-first.
- [ ] `migrate dev` creates `Mesa` + `EstadoMesa` without altering `Categoria`/`Plato`.
- [ ] CRUD works, rejects invalid payloads with 400, persists `nombre`, `capacidad` and all three `estado` values.
- [ ] `/salon` lists mesas as a color-coded grid, creates/edits/deletes and changes `estado` through `packages/shared`.
- [ ] `pnpm build` passes in strict mode; no spatial columns, no `Pedido` coupling, no Redis code introduced.
