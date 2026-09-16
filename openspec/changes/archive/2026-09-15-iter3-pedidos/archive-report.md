# Archive Report: Iter 3 — Pedidos

**Date**: 2026-09-15
**Change**: iter3-pedidos
**Status**: ARCHIVED, PASS
**Archived to**: `openspec/changes/archive/2026-09-15-iter3-pedidos/`

## Final State Summary

The Iter 3 — Pedidos change was fully implemented and merged to `main` prior to this close-out (commits `701cafc` and `09f370e`), but its SDD bookkeeping was never finished: `state.yaml` still showed `verify: pending` and `archive: pending`, and its specs had never been merged into `openspec/specs/`. This archive pass is a bookkeeping close-out, not a fresh implementation or verification cycle — no application source code was touched.

The change introduces the `Pedido`/`ItemPedido` aggregate, a linear `EstadoPedido` state machine, `tipoServicio` (`mesa`/`barra`) validation, price/name snapshotting from `Plato`, the repo's first cross-module service coupling (`PedidosService` → `MesasService`), and an admin screen at `/pedidos`.

### Verification Verdict

**PASS** (Verified 2026-09-15, see `verify-report.md`)

A fresh `pnpm --filter api test` run passed 107/107 (all suites, no regressions) and a fresh `pnpm --filter web build` succeeded with `/pedidos` compiling statically. Source inspection of `apps/api/src/pedidos/pedidos.service.ts` against `design.md`'s Architecture Decisions found no drift in the pedidos-specific logic (transition guard, cross-module coupling, transaction boundary, FK guards, snapshot). One WARNING is carried: this pass did not independently re-run the live curl/browser checks from `tasks.md` 7.4/7.5 (already documented as performed during apply); it relied on the automated suite, build, and source inspection, per the close-out task's explicitly lighter scope than iter2's independent re-verification.

## Specs Merged to Main

| Spec | Location | Requirements | Scenarios | Status |
|------|----------|--------------|-----------|--------|
| Pedidos | `openspec/specs/pedidos/spec.md` | 6 | 15 scenarios | Created |
| Pedidos-Admin | `openspec/specs/pedidos-admin/spec.md` | 4 | 6 scenarios | Created |
| Salon (MODIFIED) | `openspec/specs/salon/spec.md` | 1 requirement replaced | 4 scenarios (was 1) | Merged |

### Pedidos Spec (new capability)

Defines the HTTP contract and persistence behavior for `Pedido`/`ItemPedido`: creation with price/name snapshot from `Plato`, `tipoServicio`-driven `mesaId` requirement, `platoId` FK validation, the strictly linear `EstadoPedido` transition sequence, atomic Mesa coupling on create/close, and list/get.

### Pedidos-Admin Spec (new capability)

Defines `/pedidos` admin screen behavior: the create form (conditional Mesa selector, repeatable item rows), the Pedido list, the single forward-only "Avanzar" action, and error surfacing on failed create/advance.

### Salon Spec (MODIFIED delta merged)

The requirement **"pedido_en_curso is operator-asserted"** was replaced with **"pedido_en_curso has a manual path and an automatic driver"**: the manual `PATCH /mesas/:id` path is preserved unchanged, and three new scenarios were added covering the automatic set-to-`pedido_en_curso` on mesa-Pedido creation, the automatic set-to-`libre` on reaching `cerrado`, and confirmation the manual path still works once `Pedido` exists. The spec's Purpose line was updated to note the automatic driver now exists (cross-referencing the `pedidos` capability) while clarifying `Mesa` still holds no FK column to `Pedido` (only a back-relation). No other part of the existing `salon` spec was changed.

## Implementation Summary

### What Was Built (already on `main` before this close-out)

- **Schema** (commit `701cafc`): `TipoServicio`/`EstadoPedido` enums, `Pedido`/`ItemPedido` models with `Restrict` FKs on `Pedido.mesaId` and `ItemPedido.platoId`, back-relation fields on `Mesa`/`Plato`; one additive migration.
- **Required existing-file fix** (commit `701cafc`): `PlatosService.remove` and `MesasService.remove` now map Prisma P2003 (FK violation) to `ConflictException` (409), since the new `Restrict` FKs made this reachable for the first time. `MesasService` gained `assertMesaExists` and `marcarEstado(tx, mesaId, estado)`; `MesasModule` now exports `MesasService`.
- **PedidosService** (commit `701cafc`): `create` (FK/tipoServicio guards, snapshot, transactional Mesa coupling), `findAll`, `findOne`, `updateEstado` (transition guard via `estado-pedido.ts`, transactional `cerrado → libre` coupling).
- **HTTP layer, shared contracts, admin UI** (commit `09f370e`): `PedidosController`, hand-written DTOs, `PedidosModule` wired into `AppModule`; `packages/shared` gained the `Pedido`/`ItemPedido` types, `CreatePedidoInput`, `SIGUIENTE_ESTADO_PEDIDO`, and 3 fetch wrappers; `apps/web/app/pedidos/page.tsx` admin screen; `openspec/config.yaml` context block refreshed.

### Test Evidence (this close-out pass, fresh run)

- `pnpm --filter api test`: 107/107 passing (7 suites, includes `pedidos.service.spec.ts`'s 7x7 table-driven `EstadoPedido` sweep and `estado-pedido.spec.ts`)
- `pnpm --filter web build`: succeeds, `/pedidos` route compiles statically (3.63 kB)

Full detail in `verify-report.md`.

### Deviations from the Original Plan

1. **Delivery split**: `tasks.md`'s Review Workload Forecast proposed a 3-way chained-PR split (PR1 backend, PR2 HTTP+shared, PR3 admin UI). Actual delivery used 2 commits: `701cafc` covered PR1's scope (sections 1-3), and `09f370e` covered PR2 **and** PR3's scope together (sections 4-7) in one commit rather than two chained PRs.
2. **Tracker PR gap**: per `state.yaml`'s apply-phase note, the `iter3-pedidos` tracker branch could never get a draft PR opened — its SDD docs commit landed directly on `main` (unlike Iter 1/2, where that commit lived on the tracker branch first), leaving the branch byte-identical to `main` with no diff to open a PR against. This is carried forward from the apply phase's own documentation, not re-litigated here. No functional impact: all code is merged and verified on `main`.
3. **Lighter verify pass**: unlike iter2's independent re-verification (which re-ran live curl checks against a running dev server), this close-out's verify relied on the automated suite, build, and source inspection only, per the explicit scope of this bookkeeping task.

## Change Folder Contents

`openspec/changes/iter3-pedidos/` moved to `openspec/changes/archive/2026-09-15-iter3-pedidos/` via `git mv`, containing:

- `proposal.md`, `exploration.md`, `design.md` — unchanged from the active change
- `specs/pedidos/spec.md`, `specs/pedidos-admin/spec.md` — now merged to `openspec/specs/`
- `specs/salon/spec.md` — the MODIFIED delta, now merged into the existing `openspec/specs/salon/spec.md`
- `tasks.md` — 7 sections, all tasks checked complete
- `state.yaml` — apply (2 documented phases), verify (pass), archive (done)
- `verify-report.md` — this close-out's verification report

## Archive Completeness Checklist

- [x] Main specs updated correctly (`pedidos`, `pedidos-admin` created; `salon` MODIFIED delta merged into the existing file)
- [x] Change folder moved to archive (`git mv` to `openspec/changes/archive/2026-09-15-iter3-pedidos/`)
- [x] Archive contains all artifacts (proposal, exploration, specs, design, tasks, verify-report, state.yaml)
- [x] All tasks.md sections (1-7) are checked
- [x] Active changes directory no longer has this change (`openspec/changes/iter3-pedidos/` gone)
- [x] `ARCHITECTURE.md` §4 "Iter 3 — Pedidos" checkbox ticked

## Source of Truth Updated

- `openspec/specs/pedidos/spec.md` — HTTP and persistence contract for Pedido/ItemPedido
- `openspec/specs/pedidos-admin/spec.md` — `/pedidos` admin screen behavior
- `openspec/specs/salon/spec.md` — updated `pedido_en_curso` requirement now describing both the manual path and the automatic driver

## SDD Cycle Complete

1. **Proposal** ✓ — Scope, approach, risks, rollback plan
2. **Spec** ✓ — pedidos, pedidos-admin, salon (MODIFIED) requirements/scenarios
3. **Design** ✓ — Architecture decisions, cross-module coupling, transaction boundary
4. **Tasks** ✓ — 7 sections, all checked
5. **Apply** ✓ — 2 commits (deviating from the forecast 3-way PR chain; see Deviations above)
6. **Verify** ✓ — Bookkeeping close-out pass: automated suite + build green, design coherence confirmed, one WARNING carried (no live re-run of curl/browser checks)
7. **Archive** ✓ — Specs merged to main, change folder moved to archive, `ARCHITECTURE.md` checkbox ticked

Ready for Iter 4 (Tiempo real).
