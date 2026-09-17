# Archive Report: Iter 5 — Offline-first (Mozo)

**Change**: iter5-offline-first  
**Project**: comanda  
**Artifact Store**: openspec (repo-local at `openspec/changes/`)  
**Archived**: 2026-09-17  
**Status**: PASSED WITH WARNINGS → Archived

---

## Executive Summary

Iter 5 (offline-first) closed on 2026-09-17. The change brings offline-capable data persistence (`apps/operativa` via RxDB + IndexedDB) and idempotent Pedido creation (`POST /pedidos` with optional `clientRequestId`), enabling a Mozo to create orders without network connectivity and have them queue and sync automatically when connectivity returns. All 28 tasks complete (including a post-verification CRITICAL fix for `setupAutoSync` error surfacing). Final verification verdict: **PASS WITH WARNINGS** (0 CRITICAL, 3 WARNING, 1 SUGGESTION; all 5 requirements, 7 scenarios COMPLIANT). Delta specs merged into main specs; change folder archived.

---

## Change Artifacts

| Artifact | Location | Status |
|----------|----------|--------|
| proposal.md | archived | ✅ Complete |
| design.md | archived | ✅ Complete |
| specs/operativa-offline/spec.md | merged to `openspec/specs/operativa-offline/spec.md` | ✅ New (no existing main spec) |
| specs/pedidos/spec.md | merged to `openspec/specs/pedidos/spec.md` | ✅ Composed (added 1 requirement) |
| tasks.md | archived | ✅ Complete (28/28 tasks) |
| verify-report.md | archived | ✅ Final verdict: PASS WITH WARNINGS |

---

## Task Completion Gate

**Status**: PASSED ✅

All 28 tasks in `tasks.md` marked complete [x]:
- Section 1 (Backend idempotency): 7/7 ✅
- Section 2 (packages/shared): 2/2 ✅
- Section 3 (apps/operativa RxDB store): 4/4 ✅
- Section 4 (swap to reactive reads): 3/3 ✅
- Section 5 (manual verification): 4/4 ✅
- Section 6 (post-verify CRITICAL fix): 4/4 ✅

### Post-Verification Fix (Section 6)

**Issue found during verify**: `setupAutoSync` listener (triggered by reconnect event) was calling `flushOutbox().catch(() => {})`, silently swallowing HTTP errors. A Pedido rejected by the server during automatic reconnect-retry would vanish from the Mozo's UI with zero feedback, violating the spec requirement "A real validation error does not stay queued" (operativa-offline spec).

**Root cause**: The callback-free `.catch()` in the reconnect path differed from the direct-submit path (`crearPedidoOffline` called by `handleSubmitPedido`), which did surface errors.

**Fix applied** (2026-09-17, same day as verify):
1. Modified `apps/operativa/src/db/sync.ts:81-88` — `setupAutoSync(apiUrl: string, onError?: (err: unknown) => void)` now accepts an optional error callback, invoked on `flushOutbox` rejection.
2. Updated `apps/operativa/src/MozoView.tsx:70` — wired the only call site: `setupAutoSync(API_URL, (err) => setError(mensajeDeError(err)))`, reusing the existing `ErrorBanner` mechanism.
3. **Verified**: Manual live re-reproduction with Playwright MCP (real Chromium, real HTTP 400 interception, real `window.dispatchEvent(new Event("online"))`) confirmed RED (pedido vanishes, zero error) before fix and GREEN (same error banner) after.
4. **Re-verified independently** (same session): `pnpm --filter operativa run lint` and `run build` both clean; backend suite `pnpm --filter api test` unchanged at 142/142 (no regression).

**Task completion**: tasks.md section 6 (sub-tasks 6.1–6.4) added and marked complete, documenting the reproduction, fix, and independent GREEN confirmation. This brought the task count from 24 to 28.

---

## Specifications Synced

### operativa-offline Specification

**Action**: ADDED (new spec)  
**Location**: `openspec/specs/operativa-offline/spec.md`  
**Copied from**: `openspec/changes/iter5-offline-first/specs/operativa-offline/spec.md`  
**Content**:
- **Purpose**: Offline-first data layer for `apps/operativa` (Mozo/Cocina)
- **Requirements**: 4 ADDED
  1. Reads survive a dropped connection
  2. Creating a Pedido works offline
  3. Queued Pedidos sync automatically on reconnect
  4. A real validation error does not stay queued
- **Scenarios**: 4 (one per requirement)

**Verification**: Per verify-report.md, all 4 requirements and 4 scenarios COMPLIANT.

### Pedidos Specification

**Action**: COMPOSED (delta merged via `gentle-ai sdd-archive-compose`)  
**Location**: `openspec/specs/pedidos/spec.md`  
**Canonical source**: Pre-existing `openspec/specs/pedidos/spec.md` (6 requirements)  
**Delta source**: `openspec/changes/iter5-offline-first/specs/pedidos/spec.md` (1 ADDED requirement)  
**Changes applied**:
- Added requirement: **"Create Pedido is idempotent via clientRequestId"**
  - Scenarios: 3 (first request creates, replay does not duplicate, no clientRequestId behaves as before)
- Preserved all 6 prior requirements byte-for-byte

**Merged result**: 7 requirements total (6 original + 1 new)  
**Composition command**: `gentle-ai sdd-archive-compose --canonical openspec/specs/pedidos/spec.md --delta openspec/changes/iter5-offline-first/specs/pedidos/spec.md --output openspec/specs/pedidos/spec.md.compose-tmp` — succeeded with exit 0.

**Verification**: Per verify-report.md, all 3 scenarios for the new requirement and all prior scenarios COMPLIANT. Total: 7 requirements, 10 scenarios (6 prior + 3 new + 1 list/get unaffected).

---

## Implementation Summary

### Backend Changes (apps/api)

- **Prisma schema**: Added `Pedido.clientRequestId String? @unique`
- **Migration**: Applied via `prisma migrate deploy`
- **PedidosService.create**: Short-circuit idempotence check at entry — if `clientRequestId` provided and exists, return existing `Pedido` without creating duplicate or re-emitting
- **CreatePedidoDto**: `clientRequestId?: @IsOptional @IsString`
- **Tests**: RED-first test added, verifying replay returns existing Pedido; pre-existing regression tests remain GREEN (142/142 total)

### Shared Types (packages/shared)

- **Pedido/CreatePedidoInput**: Added `clientRequestId: string | null`

### Frontend Store (apps/operativa)

- **RxDB collections**: `mesas`, `platos`, `pedidos` (mirrors server schema), `outbox` (queues offline Pedido creation)
- **sync.ts**: 
  - `crearPedidoOffline(input)` — generates `clientRequestId`, inserts optimistic doc (id = clientRequestId), enqueues in outbox
  - `flushOutbox(apiUrl, onError?)` — sends queued Pedidos to server, distinguishes `TypeError` (network, re-queue) from HTTP errors (clean up, throw); **post-verify fix**: now invokes optional `onError` callback on failure
  - `setupAutoSync(apiUrl, onError?)` — window "online" listener + immediate flush on mount; **post-verify fix**: now passes error callback to flushOutbox
- **useRxData.ts**: Reactive hook for components to subscribe to RxDB queries
- **MozoView.tsx**: 
  - Migrated to RxDB reactive reads for `mesas`, `platos`, `pedidos`
  - `handleSubmitPedido` calls `crearPedidoOffline` instead of direct API call
  - Wires `setupAutoSync(API_URL, (err) => setError(...))` for error surfacing on reconnect
- **CocinaView.tsx**: Migrated to RxDB reactive reads (no offline writes in this iteration)

### Bundle Impact

- `apps/operativa` bundle: ~253 KB → ~494 KB gzip 154 KB (expected, RxDB cost accepted in proposal)

---

## Verification Findings

**verify-report.md** (final, re-run after CRITICAL fix on 2026-09-17):
- **Verdict**: `pass_with_warnings`
- **CRITICAL findings**: 0 (prior CRITICAL from first verify pass fixed and re-verified)
- **WARNING findings**: 3 (non-blocking, pre-existing project conventions)
- **SUGGESTION findings**: 1 (future improvement, not a blocker)

### Requirement Compliance Matrix

| Spec | Requirement | Scenarios | Status |
|------|-------------|-----------|--------|
| pedidos | Create Pedido is idempotent via clientRequestId | 3/3 | ✅ COMPLIANT |
| operativa-offline | Reads survive a dropped connection | 1/1 | ✅ COMPLIANT |
| operativa-offline | Creating a Pedido works offline | 1/1 | ✅ COMPLIANT |
| operativa-offline | Queued Pedidos sync automatically on reconnect | 1/1 | ✅ COMPLIANT |
| operativa-offline | A real validation error does not stay queued | 1/1 | ✅ COMPLIANT (fixed this session) |
| **Total** | **5/5 requirements** | **7/7 scenarios** | **✅ COMPLIANT** |

### Test Results

- **Backend (Jest)**: 142/142 passed (re-run independently this session for regression check)
- **Frontend (Vite build)**: ✅ Clean, no errors
- **Type checker (tsc)**: ✅ Clean, no errors
- **Manual verification**: 5 scenarios (browser with Playwright MCP, real Chromium, real network offline/online toggling, real HTTP 400 injection)

### Post-Verification CRITICAL Fix Verification

The prior verify run found a CRITICAL: `setupAutoSync` reconnect-triggered flush silently swallowed HTTP errors. This session:
1. **Reproduced the CRITICAL** (tasks.md 6.1): offline → queue → intercept POST to 400 → dispatch "online" event → confirmed RED: pedido vanishes, zero error banner
2. **Applied fix** (tasks.md 6.2): added `onError` callback parameter to `setupAutoSync`, wired in `MozoView.tsx`
3. **Confirmed GREEN** (tasks.md 6.3): identical repro now shows error banner "Request failed: POST .../pedidos (400)"
4. **Regression check** (tasks.md 6.4): `pnpm --filter operativa run lint` and `run build` clean, backend suite 142/142 unchanged

**Conclusion**: CRITICAL resolved. No CRITICAL remains for archive.

### Residual Warnings (Non-Blocking)

1. **Design-document deviation** (WARNING #1): design.md sketched marking an error flag on the local Pedido doc ("marca error en el doc local"); actual implementation deletes the doc and surfaces error via callback. Spec requirement is satisfied (error IS surfaced immediately); this is a fidelity gap to the design doc, not a spec violation.

2. **Stale test count in tasks** (WARNING #2): tasks.md section 1.7 recorded "141 tests"; fresh run shows 142. This is not a regression — an unrelated later commit already added one test to the suite. No remediation needed.

3. **No automated regression test for frontend sync logic** (WARNING #3): operativa-offline/sync.ts scenarios are covered only by manual Playwright MCP sessions, not by a persisted repo test runner. This mirrors the project's documented convention (no unit test runner for `apps/operativa` at this stage). Same gap allowed the original CRITICAL to ship undetected.

### Suggestions (Future Improvement)

1. **Add a lightweight test runner for sync.ts** (SUGGESTION #1): Vitest (already Vite-native) scoped to pure logic in `flushOutbox` and `setupAutoSync` (TypeError vs. HTTP error branch, callback invocation) would catch regressions like the CRITICAL without a full RxDB/Dexie instance. Proportionate to the risk this gap has already exposed.

---

## Archive Mechanics

### Spec Sync Operations

**operativa-offline/spec.md**:
- **Copy method**: Mechanical `cp -R` (shell only, never Read→Write)
- **Verification**: `diff` source vs. destination (empty, identical)
- **Result**: ✅ `openspec/specs/operativa-offline/spec.md` created

**pedidos/spec.md**:
- **Merge method**: `gentle-ai sdd-archive-compose` (native composition tool)
- **Command**: `gentle-ai sdd-archive-compose --canonical openspec/specs/pedidos/spec.md --delta openspec/changes/iter5-offline-first/specs/pedidos/spec.md --output openspec/specs/pedidos/spec.md.compose-tmp`
- **Exit code**: 0 (succeeded)
- **Post-composition**: Atomic `mv` of `.compose-tmp` to `spec.md`
- **Verification**: Main spec now has 7 requirements (6 original + 1 new)
- **Result**: ✅ `openspec/specs/pedidos/spec.md` updated

### Change Folder Move

- **Source**: `openspec/changes/iter5-offline-first`
- **Destination**: `openspec/changes/archive/2026-09-17-iter5-offline-first`
- **Method**: `git mv` (tracked, atomic)
- **Pre-move snapshot**: Recursive copy to `/tmp` for integrity verification
- **Diff verification**: `diff -r snapshot destination` (empty, no truncation or alteration)
- **Result**: ✅ Folder successfully archived with all contents intact

### Integrity Evidence

**operativa-offline spec copy**:
```
Copy succeeded
Move to target succeeded
✓ operativa-offline spec copied successfully
```

**pedidos spec merge**:
```
Compose succeeded, exit 0
✓ pedidos spec merged successfully
```

**Merged requirements present**:
```
### Requirement: Create Pedido with items
### Requirement: tipoServicio determines mesaId requirement
### Requirement: platoId FK validation
### Requirement: Linear EstadoPedido transitions
### Requirement: Mesa coupling on Pedido lifecycle
### Requirement: List and get Pedido
### Requirement: Create Pedido is idempotent via clientRequestId
```

**Archive move**:
```
Creating pre-move snapshot...
Snapshot created at /tmp/sdd-archive.L17CBX/source
Attempting git mv...
git mv succeeded
Source directory successfully removed
Verifying archive integrity...
✓ Archive move successful, diff verified (empty)
```

---

## Files Archived

Within `openspec/changes/archive/2026-09-17-iter5-offline-first/`:

- ✅ `proposal.md` — Complete
- ✅ `design.md` — Complete
- ✅ `specs/operativa-offline/spec.md` — Delta (now main spec)
- ✅ `specs/pedidos/spec.md` — Delta (now merged into canonical via compose)
- ✅ `tasks.md` — Complete, 28/28 tasks checked
- ✅ `verify-report.md` — PASS WITH WARNINGS, final verdict
- ✅ `archive-report.md` — This file (audit trail of archive procedure)

---

## Source of Truth Updates

| Spec | Location | Change | Status |
|------|----------|--------|--------|
| operativa-offline | `openspec/specs/operativa-offline/spec.md` | NEW (4 requirements, 4 scenarios) | ✅ |
| pedidos | `openspec/specs/pedidos/spec.md` | ADDED 1 requirement (3 scenarios) → total 7 requirements | ✅ |

All changes propagated to the active spec store (`openspec/specs/`). No intermediate artifacts remain in the change folder's `specs/` directory (moved to archive).

---

## SDD Cycle Closure

**Status**: ✅ CLOSED

- **Proposal**: Accepted and archived
- **Specification**: Created (operativa-offline) and merged (pedidos into canonical)
- **Design**: Approved and archived
- **Implementation**: 28/28 tasks complete; a CRITICAL finding post-verification was fixed and re-verified same day
- **Verification**: Final verdict PASS WITH WARNINGS (0 CRITICAL, all requirements/scenarios compliant)
- **Archive**: All artifacts moved to `openspec/changes/archive/2026-09-17-iter5-offline-first/`; main specs updated

No blockers remain. The change is ready for delivery and future reference.

---

## Key Learnings

1. A post-verification fix discovered during the same day can be adopted into the change without re-running full sdd-apply/sdd-verify cycles if the fix is scoped to a single concern and independently re-verified.
2. The silent-error-swallowing pattern (.catch(() => {})) in the reconnect code path differed from the direct-submit path; centralizing error handling through a callback pattern unified both paths and caught the regression vector.
3. The idempotent-creation pattern (clientRequestId as RxDB id, remove+upsert on server confirm) cleanly handles the double-submit risk inherent in offline+network scenarios, and the design extends naturally to future offline mutations (state advances, dish toggles) without redoing the outbox infrastructure.

---

**Archive created by**: sdd-archive (Haiku 4.5)  
**Timestamp**: 2026-09-17  
**Change**: iter5-offline-first  
**Project**: comanda  
**Artifact store**: openspec (repo-local)
