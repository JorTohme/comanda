# Proposal: Iter 3 — Pedidos

## Intent

Catálogo (Iter 1) and Salón (Iter 2) exist, but nothing models what is actually ordered. `ARCHITECTURE.md` line 88 scopes Iter 3 to the `Pedido` aggregate plus its state machine (`abierto → enviado_a_cocina → en_preparacion → listo → entregado → cobrado → cerrado`, doc §4.3), loaded by a mozo, online-only. `salon/spec.md` also carries an open debt: `Mesa.estado = pedido_en_curso` is operator-asserted with no driver, and it names Iter 3 as the iteration that wires the real transition.

## Scope

### In Scope

- `Pedido` + `ItemPedido` models, `EstadoPedido` and `TipoServicio` (`mesa` | `barra`) enums; one additive migration, nullable `org_id`/`sucursal_id` as in Iter 1/2.
- `ItemPedido` snapshots `nombre` and `precioUnitario` (integer centavos) from `Plato` at creation; later `Plato.precio` edits MUST NOT alter existing items.
- `pedidos/` NestJS module mirroring `salon/mesas/`, registered in `app.module.ts`. State machine = Prisma enum + `Record<EstadoPedido, EstadoPedido[]>` map + service guard. No new dependency.
- FK guards in the `assertCategoriaExists` shape: `platoId` must exist; `tipoServicio=mesa` requires a valid `mesaId`, `barra` requires none.
- **Cross-module coupling**: `PedidosService` injects `MesasService`. Creating a `mesa` pedido sets `Mesa.estado=pedido_en_curso`; reaching `cerrado` sets it back to `libre`. First service-to-service call in this repo — design.md must record it as an explicit architecture decision.
- `Pedido`/`ItemPedido` types + fetch wrappers in `packages/shared/src/index.ts`, reusing `centavosToPesos`/`pesosToCentavos`.
- `apps/web/app/pedidos/page.tsx`: admin screen mirroring `/catalogo` and `/salon`.

### Out of Scope

- Anything in `apps/operativa` — untouched until Iter 5 (offline-first, Service Worker, RxDB, sync).
- Socket.io / Redis / real-time push (Iter 4); domain events (`MesaCerrada`).
- Real caja/pagos driving `cobrado` (Iter 6). `cobrado` ships as a manually-driven enum value, same accepted tradeoff as `pedido_en_curso` in Iter 2.
- `takeaway` / `delivery` in `TipoServicio` (Fase 2 — no consumer today).
- Auth, tenancy enforcement, per-table Redis locking.

## Capabilities

### New Capabilities

- `pedidos`: `Pedido`/`ItemPedido` persistence + HTTP contract — creation, price snapshot, state-machine transitions, FK and `tipoServicio` validation.
- `pedidos-admin`: `/pedidos` screen behavior against that API.

### Modified Capabilities

- `salon`: the requirement **"pedido_en_curso is operator-asserted"** changes. It gains an automatic driver — `Pedido` creation/closure now sets `Mesa.estado` — while the manual `PATCH /mesas/:id` path remains valid. Needs a MODIFIED delta restating that whole requirement, not a silent reinterpretation.

## Approach

1. RED tests on `PedidosService` first (`pnpm --filter api test`, mocked `PrismaService` + mocked `MesasService`).
2. Additive migration: two tables, two enums; `Categoria`/`Plato`/`Mesa` columns untouched.
3. `pedidos/` copied structurally from `salon/mesas/`; transition guard rejects illegal jumps with 400.
4. `MesasService` injected via `SalonModule` export; only `Pedido` writes trigger `Mesa.estado` changes.
5. Shared contracts, then the page.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/prisma/schema.prisma` | Modified | `Pedido`, `ItemPedido`, `EstadoPedido`, `TipoServicio`; optional `Mesa` FK |
| `apps/api/src/pedidos/` | New | module, controller, service, DTOs, specs |
| `apps/api/src/salon/salon.module.ts` | Modified | export `MesasService` for injection |
| `apps/api/src/app.module.ts` | Modified | register `PedidosModule` |
| `packages/shared/src/index.ts` | Modified | `Pedido`/`ItemPedido` types + fetch wrappers |
| `apps/web/app/pedidos/page.tsx` | New | admin screen |
| `openspec/config.yaml` | Modified | refresh `context:` with the `pedidos` module |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| First cross-module service coupling sets an unreviewed precedent | High (accepted) | Confirmed product decision; direct DI (no events until Iter 4), documented in design.md with the injection direction `pedidos → salon` fixed one-way |
| `Mesa.estado` drifts if a pedido write partially fails | Med | Wrap pedido creation + mesa update in one Prisma transaction |
| Deleting a `Plato` referenced by an `ItemPedido` | Med | Price/name are snapshotted, so items survive; restrict or nullify the FK rather than cascade |
| `cobrado` has no real driver until Iter 6 | Med (accepted) | Same pattern Iter 2 accepted; spec MUST state it is operator-asserted |
| Transition map drifts from doc §4.3 | Low | Linear chain today; one table-driven test asserts every legal and illegal pair |

## Rollback Plan

- **Schema**: migration only adds two enums and two tables and no prior `Pedido` data exists — a down-migration dropping them (or `prisma migrate reset`) is lossless. `Mesa` rows keep whatever `estado` they hold; no column is altered.
- **Code**: `git revert` removes `pedidos/`, the `SalonModule` export, shared exports, and `apps/web/app/pedidos/`. `catalogo`, `salon` and `health` keep working; `Mesa.estado` reverts to operator-asserted only.
- **Partial**: the API + shared contract can stay while only the web route reverts.

## Dependencies

- `Mesa` (Iter 2) and `Plato` (Iter 1) must exist — both do.
- Postgres 16 + Prisma wiring, Jest runner (`pnpm --filter api test`) already in place.
- None external; no new package.

## Success Criteria

- [ ] `pnpm --filter api test` passes with `PedidosService` tests written RED-first, including illegal-transition rejection.
- [ ] `migrate dev` creates `Pedido`/`ItemPedido` + both enums without altering `Categoria`/`Plato`/`Mesa`.
- [ ] Creating a `tipoServicio=mesa` pedido sets that `Mesa.estado=pedido_en_curso`; transitioning it to `cerrado` returns it to `libre`.
- [ ] Editing `Plato.precio` after an order leaves that order's `ItemPedido.precioUnitario` unchanged.
- [ ] Illegal transitions (e.g. `abierto → listo`) respond 400 and persist nothing.
- [ ] `/pedidos` creates a pedido with items and advances its state through `packages/shared`.
- [ ] `pnpm build` passes in strict mode; no `apps/operativa` change, no Socket.io/Redis code, no `takeaway`/`delivery` enum values.
