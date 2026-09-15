# Exploration: iter2-salon (Mesas CRUD + estado de ocupación, grilla simple — plano 2D fuera de alcance)

## Current State

- `apps/api/src/` has `health/`, `prisma/` (`PrismaService`/`PrismaModule` as a `@Global()` module), and `catalogo/{categorias,platos}` — each a `{modulo}.{module,controller,service}.ts` + `dto/` folder, class-validator DTOs, Jest already wired (`apps/api/jest.config.js`, `pnpm --filter api test` green from Iter 1). No `salon` module and no `Mesa` model exist anywhere.
- `apps/api/prisma/schema.prisma` has only `Categoria` and `Plato`. No `Mesa`, no occupancy enum, no spatial columns.
- `packages/shared/src/index.ts` holds `Categoria`/`Plato` interfaces + typed `fetch` wrappers (`baseUrl` first, `throw new Error` on `!res.ok`, shared `parseJsonOrThrow`/`throwIfNotOk` helpers), zero runtime deps — the established contract convention Salón must extend, not replace.
- `apps/web/app/catalogo/page.tsx` is the only admin screen: single `"use client"` component, native `<form>`/`<table>`, no UI library, local-array state updates after each mutation (no refetch). This is the only UI precedent to mirror or deliberately diverge from for a "grilla simple".
- `openspec/specs/catalogo/spec.md` and `catalogo-admin/spec.md` are the only existing capabilities. No `Pedido` capability exists — confirms Iter 3 (Pedidos) comes after Salón, so `Mesa` has no FK to `Pedido` this iteration, and any occupancy state that depends on an active order has no real driver yet.
- `ARCHITECTURE.md` §4 (line 87) explicitly scopes Iter 2 to "Mesas CRUD + estado de ocupación, grilla simple" and defers the 2D layout editor to Fase 2 (doc §7.8, §8). `sistema-gestion-gastronomico.md` §4.2/§4.3 places `salon` module ownership over "mesas, posiciones de barra, estado de ocupación, plano 2D del local", and the `MESA` entity in the ER model carries `pos_x`/`pos_y`/`rotacion`/`forma`/`ancho`/`alto` — all six spatial fields are the part explicitly deferred; nothing else in the `MESA` entity is deferred.
- `sistema-gestion-gastronomico.md` §7.8 names three occupancy states for the eventual colored-grid vision — `libre` / `ocupada` / `pedido en curso` — as part of the Fase 2 2D-editor description. The color-by-state idea is separable from the deferred positioning; the third state (`pedido en curso`) has no real trigger until `Pedido` exists in Iter 3.
- `openspec/config.yaml`'s `context:` block is stale — still describes the repo as scaffold-only with no test runner/DB wiring, which predates Iter 1. Not a blocker for Salón, flagged as a pre-existing doc-hygiene gap.

## Affected Areas

- `apps/api/prisma/schema.prisma` — add `Mesa` model (new)
- `apps/api/src/salon/mesas/{mesas.module,mesas.controller,mesas.service}.ts` — new module, mirrors `catalogo/platos/` exactly
- `apps/api/src/salon/mesas/dto/{create,update}-mesa.dto.ts` — class-validator DTOs, mirrors `catalogo/platos/dto/`
- `apps/api/src/app.module.ts` — register `MesasModule` alongside `CategoriasModule`/`PlatosModule`
- `packages/shared/src/index.ts` — add `Mesa` interface, `Create/UpdateMesaInput`, and `listMesas`/`createMesa`/`updateMesa`/`deleteMesa` fetch wrappers using the existing `parseJsonOrThrow`/`throwIfNotOk` helpers
- `apps/web/app/salon/page.tsx` (new route) — grid/admin screen
- `openspec/specs/salon/spec.md` (and possibly `salon-admin/spec.md`, matching the `catalogo`/`catalogo-admin` split) — new capability specs, next phase's job
- No changes needed to `pedidos`, `caja`, or any WS/Redis code — none of that exists yet and none of it is a dependency for Mesa CRUD + a manually-toggled occupancy flag

## Approaches Considered

1. **Two-state occupancy now (`libre`/`ocupada`), extend to three states once `Pedido` exists (Iter 3)** — `Mesa.estado` enum with two values, toggled manually since nothing can drive a `pedido_en_curso` state automatically yet.
   - Pros: no dead enum value nobody can set; smaller, additive migration to extend later.
   - Cons: diverges from doc §7.8's three named states until Iter 3.
   - Effort: Low.

2. **Three-state occupancy now (`libre`/`ocupada`/`pedido_en_curso`), manually settable** — full doc-vocabulary enum from day one; `pedido_en_curso` is just another manual toggle option until Iter 3 wires it to a real `Pedido`.
   - Pros: matches doc's domain language immediately; Iter 3 only wires automatic transition, no schema enum-value addition.
   - Cons: ships a state with no real trigger this iteration — the system can claim a table has an order in progress when none exists.
   - Effort: Low.

3. **Grid view: plain `<table>`, literal Iter-1 pattern** — same list/edit/delete shape as `/catalogo`, occupancy shown as a column (badge or checkbox).
   - Pros: zero new UI pattern, maximum consistency, fastest to build/review.
   - Cons: doesn't read as a "grilla" — loses the at-a-glance salón-occupancy value the roadmap and doc §7.8 describe.
   - Effort: Low.

4. **Grid view: CSS grid of clickable mesa cards, colored by `estado`** — `display: grid` of buttons/divs, no coordinates/canvas, background color driven by `estado`, click toggles occupancy inline; CRUD form stays plain HTML above/beside the grid.
   - Pros: literally satisfies "grilla simple"; delivers the color-coded at-a-glance value from §7.8 without any deferred positioning/canvas work; still zero libraries.
   - Cons: marginally more code than a table — still trivial.
   - Effort: Low.

## Recommendation

Pair approach 1 (two-state `libre`/`ocupada` enum, no `pedido_en_curso` until `Pedido` exists to drive it) with approach 4 (CSS-grid of colored, clickable mesa cards under `apps/web/app/salon/page.tsx`). This is the smallest schema that means something today, and the grid view is barely more code than a table while actually matching "grilla simple, plano 2D queda afuera" — a flat, unpositioned, color-coded overview. Mirror Iter 1's module shape exactly (`salon/mesas/` = `{module,controller,service}.ts` + `dto/`), the same DTO validation style, the same `packages/shared` fetch-wrapper convention, and the same TDD sequencing Iter 1 proved out — the runner already exists this time, so work starts directly with RED tests on `MesasService`, no toolchain step needed.

Whether the grid page gets its own `salon-admin` capability (mirroring `catalogo`/`catalogo-admin`) or folds into one `salon` spec is an `sdd-propose`-level call, flagged below.

## Risks

- `openspec/config.yaml`'s `context:` narrative is stale (predates Iter 1) — not a Salón blocker, but will keep confusing future readers; worth a one-line fix whenever a phase next touches that file.
- If approach 2 is chosen instead of the recommendation, `pedido_en_curso` ships with no real driver this iteration until `Pedido` exists — needs explicit documentation if kept.
- No Redis table-locking for concurrent Mesa edits (doc §7.2, "lock por mesa en Redis") — acceptable only because Redis isn't wired into `apps/api` yet and no multi-writer real-time path exists until Iter 3/4.

## Open Questions

- Two-state vs three-state occupancy enum (approach 1 vs 2) — recommend two-state; `sdd-propose` must pick explicitly and record rationale.
- Does `Mesa` need a `capacidad` (seat count) field this iteration? Not required by the roadmap line or by occupancy/grid mechanics — pure YAGNI unless propose wants it for future `Pedido` sizing logic.
- Table identity: `numero: Int` vs `nombre: String`? Doc's "posiciones de barra" lives in the same `salon` bounded context — recommend a single `nombre: String` field, no `tipo` discriminant (that distinction already lives on `Pedido.tipo_servicio`, Iter 3).
- One capability spec (`salon`) or two (`salon` + `salon-admin`, matching Iter 1's split)? No strong reason either way at explore depth.
- Should the occupancy toggle live only in `apps/web` (admin/caja) for this iteration, or is a mozo-facing toggle in scope? Recommend admin/caja-web-only — `apps/operativa`'s "toma de pedidos" role is gated on `Pedido` existing (Iter 3).

## Ready for Proposal

Yes — current-state facts (no `Mesa` model, no `salon` module, no `Pedido` capability yet) are confirmed from the live repo, not assumed from docs. Iter 1 gives a concrete, already-proven pattern to slice into tasks. The open questions above should be resolved explicitly in the proposal rather than left implicit.
