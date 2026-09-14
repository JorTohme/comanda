# Archive Report: Iter 1 — Catálogo

**Date**: 2026-09-14  
**Change**: iter1-catalogo  
**Status**: ARCHIVED, PASS WITH WARNINGS  
**Archived to**: `openspec/changes/archive/2026-09-14-iter1-catalogo/`

## Final State Summary

The Iter 1 — Catálogo change has been fully planned, implemented, verified, and archived. All 53 implementation tasks are complete. The change introduces the first data-persistent capability into the system: CRUD operations for `Categoria` and `Plato` entities, with a persistence layer (Prisma/Postgres), test infrastructure (Jest), validation (class-validator), and an admin UI for catalog management.

### Verification Verdict

**PASS WITH WARNINGS** (Re-verified 2026-09-14)

Per `verify-report.md`, the original verification found one CRITICAL issue (CRITICAL-1: dev server bypassing ValidationPipe), which was fixed in a post-verification commit by switching `apps/api` dev script from `tsx watch` to `nest start --watch`. The fix was independently re-verified by this verify pass with fresh test/build execution and live dev-server regression testing. Two accepted WARNINGs remain open:
- **WARNING-1**: catalogo-admin admin UI has no automated test coverage (documented design choice, per design.md Testing Strategy).
- **WARNING-2**: TDD evidence in state.yaml is narrative prose vs. a stricter table format (content verified accurate, format deviation only).

All three chained PRs (#2, #3, #4) plus the tracker PR (#1) merged to main. Two PRs required accepted `size:exception` over the 400-line review budget (PR #3: 496 lines, PR #4: 573 lines) — cohesive units, user-approved both times.

## Specs Merged to Main

Two new domain spec files were created by mechanically copying the delta specs from the change folder:

| Spec | Location | Requirements | Scenarios | Status |
|------|----------|--------------|-----------|--------|
| Catalogo | `openspec/specs/catalogo/spec.md` | 9 ADDED | 16 scenarios | Created |
| Catalogo-Admin | `openspec/specs/catalogo-admin/spec.md` | 7 ADDED | 9 scenarios | Created |

### Catalogo Spec (151 lines)

Defines the HTTP contract and persistence behavior for `Categoria` and `Plato` CRUD, including:
- Create, List, Update, Delete for both entities
- Validation (missing nombre rejected, invalid payload rejected)
- Precio as integer centavos (non-integer rejected)
- Availability toggle (`disponible` field, default true)
- FK constraint on `categoriaId` (referenced Categoria must exist)
- All 9 requirements and 16 scenarios verified compliant by implementation and test suite

### Catalogo-Admin Spec (89 lines)

Defines the admin screen behavior at `/catalogo` for managing the catalog, including:
- Initial load (list all Categorias and Platos)
- Create Categoria and Plato (forms, state management)
- Edit Categoria and Plato (inline forms, state update)
- Delete Categoria and Plato (confirmation, state removal)
- Toggle disponible inline (without separate edit form)
- Surface API errors (on failed create/update/delete, display error, no state mutation)
- Integer centavos in the UI (form stores pesos, conversion at submit/display boundary)
- All 7 requirements and 9 scenarios verified compliant by source inspection and live API testing

## Implementation Summary

### What Was Built

**Test Infrastructure** (Phase 1):
- Jest + ts-jest test runner configured in `apps/api/jest.config.js`
- `pnpm --filter api test` script and turbo task dependency
- Smoke test gate (app.smoke.spec.ts) before domain code

**Persistence Layer** (Phase 2):
- Prisma schema with `Categoria` and `Plato` models (nullable `org_id`/`sucursal_id` columns added for future tenancy, unused)
- `PrismaService` global module for single connection lifecycle
- `ConfigModule.forRoot({ isGlobal: true })` for environment config
- Initial migration creating both tables

**Catalogo API** (Phases 3–5):
- Categorias module: CRUD controllers + service + DTOs with validation
- Platos module: CRUD controllers + service + DTOs with validation, including `categoriaId` existence check
- Global `ValidationPipe` with whitelist and forbidNonWhitelisted
- All validation errors return 400 with field-level messages

**Shared Contracts** (Phase 6):
- `Categoria` and `Plato` TypeScript interfaces in `packages/shared/src/index.ts`
- Create/Update input types for both entities
- `centavosToPesos`/`pesosToCentavos` conversion helpers (unit-tested, 8 tests passing)
- 8 CRUD fetch wrappers (listCategorias, createCategoria, updateCategoria, deleteCategoria, listPlatos, createPlato, updatePlato, deletePlato)
- Documented deviation: fetch wrappers throw on not-ok, not the `pingApi` sentinel style (rational: a sentinel Categoria is not representable)

**Admin UI** (Phase 7):
- `apps/web/app/catalogo/page.tsx` single-file React component
- State shape: categorias, platos, form, editandoPlatoId, nuevaCategoria, error, cargando
- Mount-time Promise.all load of both lists with error handling
- Categoria create form + table rendering
- Plato create/edit form (pesosToCentavos on submit, centavosToPesos for display) + table rendering
- Inline disponible toggle calling updatePlato
- Delete actions for both entities, removing from local state on success
- No optimistic apply — state only mutates after API success
- No automated tests (documented design choice; manual testing via live dev server)

### Test Evidence

**Automated test suite: 24/24 passing**
- `pnpm --filter api test`: 16/16 tests (app.smoke, categorias.service, platos.service)
- `pnpm --filter shared test`: 8/8 tests (centavosToPesos/pesosToCentavos round-trip)

**Build**: pnpm turbo run build --force — 4/4 tasks successful
- Web app includes `/catalogo` route (2.82 kB / 90.1 kB First Load JS)

**Lint/typecheck**: pnpm turbo run lint --force — 5/5 tasks successful

**Live API verification**: All 4 CRUD endpoints tested with curl against both dev (after CRITICAL-1 fix) and production builds:
- POST /categorias (valid + invalid payloads) → 201/400
- GET /categorias → 200 with all records
- PATCH /categorias/:id → 200 or 404
- DELETE /categorias/:id → 200 or 404
- POST /platos (valid + invalid, including float precio, unknown field, bad categoriaId) → 201/400
- GET /platos (with and without categoriaId filter) → 200
- PATCH /platos/:id (toggle disponible) → 200 or 404
- DELETE /platos/:id → 200 or 404

**Manual end-to-end verification** (Tasks 8.1–8.6):
- docker compose up -d: Postgres 16 reachable
- prisma migrate dev: schema up to date with 1 migration
- pnpm build: strict mode passes across monorepo
- pnpm dev: routes wired correctly, component renders

### Risk Mitigation

All proposal-identified risks were addressed:
- **TDD starts before Jest is wired**: Mitigated by Phase 1 hard gate (smoke test passes before domain code)
- **Prisma migration fails against Postgres**: Mitigated by Phase 2 verification before Phase 3 domain code
- **Nullable tenancy columns treated as enforced**: Mitigated by explicit out-of-scope statement and columns left unused
- **Int-cents misread as pesos by UI**: Mitigated by conversion isolated in shared wrappers, unit-tested

### Violations of Out-of-Scope

None. Code explicitly excludes:
- Authentication/authorization
- Tenancy filtering by org_id/sucursal_id
- Real-time/sockets
- Takeaway & delivery
- Payments
- Floor plan (operativa)
- Images, modifiers, stock, soft-delete

## Change Folder Contents

The active change folder `openspec/changes/iter1-catalogo/` has been moved to archive at `openspec/changes/archive/2026-09-14-iter1-catalogo/` with the following artifacts:

- `proposal.md` — change intent, scope, approach, risks, rollback plan
- `design.md` — technical approach, architecture decisions, file changes, interfaces, data flow sequence diagrams
- `specs/catalogo/spec.md` — requirements and scenarios (now merged to `openspec/specs/catalogo/spec.md`)
- `specs/catalogo-admin/spec.md` — requirements and scenarios (now merged to `openspec/specs/catalogo-admin/spec.md`)
- `tasks.md` — 8 phase groups, 53 total tasks, all checked complete, including post-verify CRITICAL-1 fix
- `verify-report.md` — verification report with original FAIL verdict (CRITICAL-1), re-verification showing PASS WITH WARNINGS after fix, full spec compliance matrix, test evidence
- `exploration.md` — (present in archive, used for initial scoping)
- `state.yaml` — (present in archive, records apply-phase state and notes)

All artifacts are byte-identical to their live versions at merge time, verified by `diff -r` after `git mv`.

## Archive Completeness Checklist

- [x] Main specs updated correctly (catalogo and catalogo-admin specs created in openspec/specs/)
- [x] Change folder moved to archive (git mv to openspec/changes/archive/2026-09-14-iter1-catalogo/)
- [x] Archive contains all artifacts (proposal, specs, design, tasks, verify-report, exploration, state.yaml)
- [x] All 53 tasks are checked (implementation complete, no stale unchecked tasks)
- [x] Active changes directory no longer has this change (openspec/changes/iter1-catalogo/ gone)
- [x] Verbatim diff -r readback output included in result and empty (no differences between snapshot and archived folder)

## Source of Truth Updated

The following specs now reflect the new catalog capabilities and are the authoritative source for future iterations:
- `openspec/specs/catalogo/spec.md` — HTTP and persistence contract for Categoria/Plato CRUD
- `openspec/specs/catalogo-admin/spec.md` — Admin screen behavior against that API

These specs replace the delta specs that lived in the active change folder and are now part of the audit trail in the archive.

## SDD Cycle Complete

The Iter 1 — Catálogo change has completed the full SDD cycle:
1. **Proposal** ✓ — Scope, approach, risks, rollback plan documented and accepted
2. **Spec** ✓ — Catalogo and catalogo-admin requirements/scenarios defined
3. **Design** ✓ — Technical approach, architecture decisions, file changes planned
4. **Tasks** ✓ — 8 phase groups, 53 tasks, phase-gated sequencing (TDD gate hard constraint)
5. **Apply** ✓ — All tasks completed, 4 PRs merged to main (#1 tracker, #2–#4 chained)
6. **Verify** ✓ — Spec compliance confirmed, CRITICAL-1 (dev-server ValidationPipe) fixed and re-verified closed, 2 accepted warnings remain open
7. **Archive** ✓ — Specs merged to main, change folder moved to archive, audit trail preserved

Ready for the next change.
