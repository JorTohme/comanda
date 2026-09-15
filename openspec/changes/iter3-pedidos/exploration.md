# Exploration: iter3-pedidos (Agregado Pedido + máquina de estados, carga desde mozo, online-only)

## Current State

Repo confirmed directly (Prisma schema, service/controller/DTO files, `packages/shared`, `apps/operativa`, archived Iter 1/2 design docs):

- `apps/api/prisma/schema.prisma` currently has only `Categoria`, `Plato` (FK → `Categoria`), `EstadoMesa` enum, and `Mesa`. No `Pedido`/`ItemPedido` model exists. `Mesa` has zero relations — nothing references it yet, not even a `pedido_en_curso`-adjacent FK. `orgId`/`sucursalId` exist as nullable, unused columns on every table (tenancy deferred, established in Iter 1).
- `openspec/specs/salon/spec.md` explicitly documents that `Mesa.estado = pedido_en_curso` is operator-asserted only in Iter 2, with no `Pedido` FK and no automatic trigger, and states in plain text that Iter 3 wires the real transition without a schema change. This is a direct signal: Iter 3 is expected to make `Pedido` lifecycle events *drive* `Mesa.estado`, not just add a sibling table.
- `apps/operativa` exists as a directory, but it is exactly the Iter 0 scaffold: `App.tsx` is a 25-line component that calls `pingApi()` and renders "checking.../ok/unreachable". No routing, no forms, no mozo-facing feature of any kind. Confirmed by reading the file. **Nothing about "carga desde mozo" has been built anywhere yet.**
- `apps/web` has two precedent admin screens (`/catalogo`, `/salon`): plain Next.js client components, no UI library, inline styles, local-array state updates from resolved responses (no optimistic apply, no refetch-on-mutate), calling `packages/shared` fetch wrappers.
- NestJS module shape (`catalogo/platos`, `salon/mesas`) is identical every time: `{modulo}.module.ts` + `.controller.ts` + `.service.ts` + `dto/{create,update}-{entity}.dto.ts`, explicit `@Inject(PrismaService)`, class-validator DTOs behind a global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`), a shared `isNotFoundError` P2025 → `NotFoundException` helper duplicated per service. `PlatosService.assertCategoriaExists` is the existing FK-validation pattern (`BadRequestException` when the referenced id doesn't exist) — the direct precedent for `Pedido` validating `mesaId`/`platoId`.
- `packages/shared/src/index.ts` is plain TS: interfaces, input types, and thin `fetch` wrapper functions per entity, zero runtime dependencies. It already has `centavosToPesos`/`pesosToCentavos` (integer-cents money handling) — directly reusable for `ItemPedido` line totals.
- Testing: `openspec/config.yaml` confirms `apply.tdd: true`, `test_command: "pnpm --filter api test"`, colocated `*.service.spec.ts`, RED-first against a mocked `PrismaService`.
- Iter 4/6 boundary confirmed empty: `config.yaml`'s own context block states Redis is still unused and no Socket.io gateway or `caja`/`pagos` module exists anywhere in `apps/api/src`. Confirms this iteration must not add WS/Redis or a real payment-driven `cobrado` transition.

## Affected Areas

- `apps/api/prisma/schema.prisma` — new `Pedido`, `ItemPedido` models, `EstadoPedido` enum (and possibly `TipoServicio` enum), FKs to `Mesa` (optional) and `Plato`.
- `apps/api/prisma/migrations/**` — one additive migration.
- `apps/api/src/pedidos/` (new module) — `pedidos.{module,controller,service}.ts`, `dto/`, `*.service.spec.ts`.
- `apps/api/src/salon/mesas/mesas.service.ts` — potentially touched if `PedidosService` needs to flip `Mesa.estado` on open/close (cross-module call) — open question below.
- `apps/api/src/app.module.ts` — register `PedidosModule`.
- `packages/shared/src/index.ts` — `Pedido`, `ItemPedido`, `EstadoPedido`, `TipoServicio` types + input types + fetch wrappers.
- `apps/web/app/pedidos/` or `apps/operativa/src/` — undetermined until the UI scope question below is resolved; possibly no UI file at all this iteration.
- `openspec/specs/pedidos/spec.md` (new, next phase) and `openspec/specs/salon/spec.md` (possible MODIFIED delta if `Mesa.estado` gains a real driver).

## Approaches Considered

1. **`Pedido` + `ItemPedido` as separate Prisma tables (1:N)** — mirrors `Categoria`/`Plato` exactly.
   - Pros: matches doc §4.3 ER diagram literally; queryable/reportable per-item later (Iter 6 caja, Fase 2 reportes need this); zero new pattern vs. Iter 1/2.
   - Cons: one more table, one more service surface.
   - Effort: Low.

2. **`Pedido` with items embedded as a JSON column** (no `ItemPedido` table).
   - Pros: fewer files, one write per order mutation.
   - Cons: breaks the doc's own ER model; no relational FK to `Plato` per item; diverges from the zero-exceptions precedent of every prior iteration. Rejected — added complexity dressed as simplicity.
   - Effort: Low now, High later (retrofit cost when Iter 6/reportes need per-item joins).

3. **State machine enforcement: DB enum (`EstadoPedido`) + service-level guard clauses**, matching Iter 1/2's zero-dependency precedent.
   - Pros: no new dependency; `class-validator`'s `@IsEnum` already validates the shape; a small `ALLOWED_TRANSITIONS: Record<EstadoPedido, EstadoPedido[]>` map + one guard function in `PedidosService` is the entire "engine"; trivially testable with the existing mocked-Prisma RED-first pattern.
   - Cons: manual map must be kept in sync with doc §4.3 if the lifecycle ever grows branches (currently strictly linear, so non-issue today).
   - Effort: Low.

4. **State machine enforcement via a library** (e.g. `xstate`, `typescript-fsm`).
   - Pros: formalized transition graph, guards, side-effect hooks built in.
   - Cons: new dependency for a linear 7-state chain with no branching, no parallel states, no history. Contradicts the "no new dependency" line every prior design.md opens with. Rejected under the ponytail/YAGNI lens.
   - Effort: Medium (new dep, new mental model, no doc payoff).

5. **`tipo_servicio` + optional `Mesa` FK**: `mesaId String?` on `Pedido`, required only when `tipo_servicio = "mesa"`; `null` for `"barra"`.
   - Pros: matches doc §4.3 ("un solo agregado Pedido con tipo_servicio" abstracts all four modalities over one table); no `Barra` entity needs inventing; cross-checks directly against the `Mesa.pedido_en_curso` precedent — same "enum value exists, real driver comes later" pattern.
   - Cons: needs a service-level guard (`tipo_servicio === "mesa"` requires `mesaId`; `"barra"` requires it absent) — small, same shape as `assertCategoriaExists`.
   - Effort: Low.

## Recommendation

Approach 1 (separate `Pedido`/`ItemPedido` tables) + Approach 3 (plain Prisma enum + service guard clauses for the state machine) + Approach 5 (`tipo_servicio` with optional `mesaId`). This is a literal continuation of the Iter 1 → Iter 2 pattern: one additive migration, one new `pedidos/` module structurally identical to `catalogo/platos/` and `salon/mesas/`, zero new dependencies, RED-first Jest tests against mocked `PrismaService`. The state-machine-library option is explicitly rejected under the ponytail/YAGNI lens — a 7-state linear chain with no branches doesn't clear the bar for a new dependency when a `Record<EstadoPedido, EstadoPedido[]>` map does the same job in ~10 lines.

The UI-scope question (Open Question 1) and the Mesa-coupling question (Open Question 2) should go to propose as explicit decisions, not be resolved silently — they are real forks with different blast radii.

## Open Questions

1. **Does "carga desde mozo" need any UI this iteration, or is this a backend-only slice?** Load-bearing product question. Three options:
   - (a) Backend-only — `pedidos` module + spec, tested via `pnpm --filter api test` + manual curl/Postman.
   - (b) Minimal admin screen in `apps/web` (`/pedidos`), mirroring the `/catalogo`/`/salon` precedent exactly.
   - (c) Minimal form added to `apps/operativa` (still online-only, plain `fetch`, no Service Worker/RxDB) — literally matches the roadmap's "carga desde mozo" wording, but is the first real feature in `apps/operativa` and risks scope bleed into Iter 5's offline territory if not tightly bounded.
   - Leans (b): reuses a fully proven pattern, defers mozo-specific device/offline concerns to Iter 5, still gives a demoable UI. Explicit product-scope call for propose.

2. **Does opening/closing a `Pedido` drive `Mesa.estado` automatically this iteration?** `salon/spec.md` says Iter 3 "wires the real transition without a schema change." If yes: `PedidosService.create` (tipo_servicio=mesa) sets `Mesa.estado = pedido_en_curso`; a terminal state (likely `cerrado`) sets it back to `libre`. First cross-module coupling in this codebase (`pedidos` → `salon`). Needs an explicit decision: direct service injection vs. deferring the wiring to Iter 4 (when domain events like `MesaCerrada` exist per doc §7.3).

3. **Does `ItemPedido.precioUnitario` snapshot the price at order time, or always read live `Plato.precio`?** Load-bearing for correctness: `Plato.precio` can change after an order is placed, and Iter 6's arqueo needs a stable historical amount per the doc's append-only caja design (§7.5). Recommend snapshotting `precioUnitario` (and `nombre`) onto `ItemPedido` at creation, same integer-centavos convention as `Plato.precio`.

4. **Do `takeaway`/`delivery` belong in the `tipo_servicio` enum this iteration even though they're Fase 2, or does the enum ship with only `mesa`/`barra`?** Doc §4.3 defines all four; doc §8 defers two to Fase 2. Genuinely open — nothing in `pedidos`' consumer code would ever construct the other two this iteration, unlike Mesa's `pedido_en_curso` which needs to appear as a manual assertion target now.

## Risks

- Cross-module coupling precedent: if Open Question 2 resolves to "yes, wire now," this is the first time one domain service calls into another. No existing pattern in the repo; propose/design should pick DI vs. deferral explicitly rather than improvising during apply.
- `apps/operativa` scope bleed: if Open Question 1 resolves to option (c), risk of reintroducing offline-first concerns the task explicitly excludes. Any operativa work must be scoped tightly to a plain `fetch` form, stated explicitly in the proposal's out-of-scope list.
- Enum lifecycle completeness vs. YAGNI (Open Question 4): shipping unused `takeaway`/`delivery` enum values is exactly the kind of speculative scaffolding ponytail flags, though the Mesa precedent shows the project has accepted this tradeoff once already.
- Price integrity (Open Question 3) is easy to silently skip since nothing in the roadmap line names it — if `ItemPedido` reads live `Plato.precio` instead of snapshotting, `cobrado`/`cerrado` amounts become nondeterministic across price changes, a much harder retrofit once Iter 6 needs historical arqueo totals.

## Ready for Proposal

Yes. The codebase precedent (module shape, DTO/validation conventions, TDD approach, FK-guard pattern) is unambiguous and directly reusable. The four open questions above (mozo UI scope, Mesa-state auto-driving, price snapshotting, takeaway/delivery enum inclusion) are product/scope decisions that propose should confirm explicitly with the user rather than default silently.
