```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:b14f240ba677598e318bd5d2d52b2901af7ba436e3c8b1fd17b6b5d26ef2d663
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 5/5
scenarios: 7/7
test_command: pnpm --filter api test
test_exit_code: 0
test_output_hash: sha256:bf1c39b9133ab5b96e1a94f600ab1bcae56f6230473a9c906460208a4be4735d
build_command: pnpm --filter operativa run build
build_exit_code: 0
build_output_hash: sha256:f64dfca147b5a3a208d31dd1b3737effbf174246684688be7b3848135cc8638a
```

## Verification Report

**Change**: iter5-offline-first
**Version**: N/A
**Mode**: Strict TDD (backend idempotency logic) + manual/documented verification (frontend RxDB wiring, per tasks.md header and design.md Testing Strategy -- no unit test runner configured for apps/operativa)

**Re-verification note**: this is a re-run of sdd-verify after a post-verify remediation. The prior report (2026-09-17, same day, superseded by this one) found verdict: fail with 1 CRITICAL: setupAutoSync reconnect-triggered flushOutbox call swallowed every error via .catch(() => {}), so an HTTP error rejected on automatic reconnect-retry silently vanished a Pedido from the Mozo view with zero feedback. That CRITICAL is fixed in this revision (tasks.md section 6, sub-tasks 6.1-6.4) and independently re-inspected and re-confirmed below.

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 28 |
| Tasks complete | 28 |
| Tasks incomplete | 0 |

All 28 tasks in tasks.md are checked [x], including the new section 6 ("Fix post-verify -- CRITICAL de sdd-verify", 4 sub-tasks) added on top of the previously-complete 24.

### Build & Tests Execution

**Tests**: PASSED -- 142 passed / 0 failed / 0 skipped (apps/api, Jest; re-run independently this session)
```text
pnpm --filter api test
PASS src/app.smoke.spec.ts
PASS src/pedidos/estado-pedido.spec.ts
PASS src/catalogo/categorias/categorias.service.spec.ts
PASS src/auth/jwt.service.spec.ts
PASS src/catalogo/platos/platos.service.spec.ts
PASS src/auth/roles.guard.spec.ts
PASS src/realtime/realtime.gateway.spec.ts
PASS src/caja/caja.service.spec.ts
PASS src/salon/mesas/mesas.service.spec.ts
PASS src/pedidos/pedidos.service.spec.ts
PASS src/catalogo/platos/platos.controller.spec.ts

Test Suites: 11 passed, 11 total
Tests:       142 passed, 142 total
```
Unaffected by this fix (backend logic untouched) -- re-run purely as a regression spot-check, as instructed. No idempotency test failed or changed.

**Also re-run independently this session**: pnpm --filter operativa run lint (tsc -p tsconfig.json --noEmit) -- clean, zero errors, exit 0. pnpm --filter operativa run build (Vite) -- clean, exit 0, dist/assets/index-B25NrcGf.js 536.41 kB (gzip 167.05 kB), consistent with the prior reports post-iter6 baseline (no size regression attributable to this 2-line fix).

**Build**: PASSED (pnpm --filter operativa run build, scoped to the app touched by the fix)

**Coverage**: Not available -- coverage_threshold is 0 in openspec/config.yaml, no coverage tool run (unchanged from prior report).

### Spec Compliance Matrix
| Requirement | Scenario | Test / Evidence | Result |
|-------------|----------|------|--------|
| pedidos: Create Pedido is idempotent via clientRequestId | First request with a clientRequestId creates normally | pedidos.service.spec.ts > "creates normally when clientRequestId is new" | COMPLIANT |
| pedidos: Create Pedido is idempotent via clientRequestId | Replaying the same clientRequestId does not duplicate | pedidos.service.spec.ts > "returns the existing pedido when clientRequestId already exists, without creating a duplicate" | COMPLIANT |
| pedidos: Create Pedido is idempotent via clientRequestId | No clientRequestId behaves exactly as before | Pre-existing regression suite calls create with no clientRequestId, still exercises full create+marcarEstado+emit path | COMPLIANT |
| operativa-offline: Reads survive a dropped connection | Network drops mid-session | Source: useRxData.ts subscribes to RxDB reactive queries, independent of network. Manual: Playwright MCP session, context.setOffline(true), app kept rendering local data | COMPLIANT (manual + source) |
| operativa-offline: Creating a Pedido works offline | Mozo creates a Pedido with no network | Source: crearPedidoOffline (sync.ts:41-55) upserts the optimistic doc before any network call. Manual: task 5.1, pedido appeared instantly, no visible error | COMPLIANT (manual + source) |
| operativa-offline: Queued Pedidos sync automatically on reconnect | Connectivity returns | Source: setupAutoSync (sync.ts:81-88) registers a window online listener plus an immediate call on mount; on success flushOutbox reconciles the optimistic doc. Manual: task 5.2, automatic retry with no reload, Cocina saw it via WebSocket | COMPLIANT (manual + source) |
| operativa-offline: A real validation error does not stay queued | Server rejects the payload | Re-verified this session. Source: flushOutbox (sync.ts:57-79) still correctly distinguishes TypeError (re-queue) from any other error (clean up + throw err) on both trigger paths -- unchanged, was already correct. setupAutoSync (sync.ts:81-88) now takes onError?: (err: unknown) => void and calls flushOutbox(apiUrl).catch((err) => onError?.(err)) instead of .catch(() => {}). MozoView.tsx:70 wires setupAutoSync(API_URL, (err) => setError(mensajeDeError(err))) -- confirmed by direct source read, only call site in the codebase (grep setupAutoSync -- 1 definition, 1 call site, both consistent). Manual: task 6.1-6.3, RED (pedido vanishes, zero banner) reproduced with window.dispatchEvent(new Event("online")) against a real intercepted 400, then GREEN confirmed with the identical repro after the fix -- same error banner (Request failed: POST .../pedidos (400)) the immediate-submit path already showed | COMPLIANT (manual + source) |

**Compliance summary**: 7/7 scenarios compliant.

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| Pedido.clientRequestId String? @unique migration | Implemented | Unchanged from prior report. |
| PedidosService.create idempotent short-circuit | Implemented | Unchanged from prior report. |
| CreatePedidoDto.clientRequestId optional | Implemented | Unchanged from prior report. |
| packages/shared Pedido/CreatePedidoInput gain clientRequestId | Implemented | Unchanged from prior report. |
| RxDB store: mesas/platos/pedidos/outbox collections | Implemented | Unchanged from prior report. |
| useRxData reactive hook | Implemented | Unchanged from prior report. |
| crearPedidoOffline / flushOutbox | Implemented | Unchanged, correct (verified again this session). |
| setupAutoSync error surfacing | Fixed this session | sync.ts:81-88 -- onError callback added and invoked on every flushOutbox rejection reaching the online-event path; no longer silently swallowed. |
| MozoView wiring of setupAutoSync | Fixed this session | MozoView.tsx:70 -- setupAutoSync(API_URL, (err) => setError(mensajeDeError(err))), reuses the same ErrorBanner/setError mechanism the direct-submit path already used. Verified: this is the only call site of setupAutoSync in the repo. |
| MozoView/CocinaView migrated to RxDB reads | Implemented | Unchanged from prior report. |
| MozoView.handleSubmitPedido uses crearPedidoOffline | Implemented | Unchanged from prior report. |

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| RxDB + getRxStorageDexie() | Yes | Unchanged. |
| Only pedidos (creation) syncs offline in writes | Yes | Unchanged. |
| Optimistic doc identity: clientRequestId as RxDB id, remove+upsert on confirm | Yes | Unchanged. |
| Server-side idempotency by (clientRequestId, tenant) | Yes | Unchanged. |
| Only a fetch-level TypeError re-queues; any HTTP response is terminal | Yes (mechanism) | Unchanged; now correctly propagated on both trigger paths. |
| On HTTP failure, design.md says "marca error en el doc local" (flushOutbox contract) | No (deviation, WARNING) | Still deviates: the implementation deletes the local doc and now surfaces the error via a callback to setError, rather than marking a pendingSync/error flag on the doc itself as design.md sketched. The spec actual MUST clause ("surfaced to the Mozo immediately") is now satisfied by this alternate mechanism on both trigger paths -- this is no longer a spec violation, only a residual design-doc deviation. |
| Sync trigger: window online + flush on mount | Yes | Unchanged. |
| Optimistic price snapshot from local platos collection | Yes | Unchanged. |

### CRITICAL-1 (prior report) -- RESOLVED

**Original finding**: setupAutoSync reconnect-triggered flushOutbox call swallowed all errors via .catch(() => {}), so an HTTP error rejected on automatic reconnect-retry silently vanished a Pedido from the Mozo view with zero feedback -- violating operativa-offline "A real validation error does not stay queued".

**Fix verified this session**:
- apps/operativa/src/db/sync.ts:81-88 -- setupAutoSync(apiUrl: string, onError?: (err: unknown) => void): () => void now accepts an optional error callback; the online-event handler runs flushOutbox(apiUrl).catch((err: unknown) => onError?.(err)).
- apps/operativa/src/MozoView.tsx:70 -- the only call site wires it: setupAutoSync(API_URL, (err) => setError(mensajeDeError(err))), reusing the existing ErrorBanner state.
- flushOutbox itself (sync.ts:57-79) is unmodified: it still cleans up and re-throws on any non-TypeError, and re-queues (silently continues) only on a genuine network TypeError. That half of the requirement ("no duplicate", "no infinite retry") was already correct and remains so.
- Cross-checked with grep -rn "setupAutoSync" across apps/operativa/src: exactly 1 definition and 1 call site, both consistent -- no other caller left unwired, no regression risk from a second, forgotten call site.
- Manual live re-repro logged in tasks.md 6.1-6.3 (Playwright MCP, real Chromium, real intercepted HTTP 400, real online event dispatch on the exact listener code path) confirms RED before the fix and GREEN after, with the same error banner text the direct-submit path already produced.
- No new test file exists for this fix (consistent with the project documented convention of no unit test runner for apps/operativa); this remains a WARNING-level gap (see WARNING 3 below), not a blocker, since it mirrors the same accepted convention the prior PASS-eligible scenarios already relied on.

**Verdict on this finding**: RESOLVED. No CRITICAL remains open for this change.

### Issues Found

**CRITICAL**: None.

**WARNING**:
1. Design deviation (residual, downgraded from the prior report pairing with CRITICAL-1): design.md flushOutbox contract describes marking an error flag on the local doc ("marca error en el doc local"); the shipped code still deletes the doc outright and surfaces the error via callback instead. The spec MUST clause is now satisfied by this alternate mechanism, so this is a documentation/design-fidelity gap, not a spec violation.
2. tasks.md step 1.7 recorded test count ("141 tests") is stale by one against a fresh run today (142) -- not a regression, unrelated later commit already landed on main. Unchanged from prior report, noted again for completeness.
3. No automated regression test (unit/integration/E2E) exists in-repo for any of the operativa-offline scenarios, including the newly-fixed reconnect-error-surfacing path; all are covered only by manual Playwright MCP sessions that are not re-run by CI. This is the same documented, accepted project convention noted in the prior report -- it is exactly the kind of gap that let CRITICAL-1 ship undetected in the first place, and it remains open risk for a future regression in sync.ts.

**SUGGESTION**:
1. Unchanged from prior report: consider adding apps/operativa/src/db/sync.ts to a lightweight test runner (e.g. Vitest, already Vite-native) scoped to pure logic (pedidoOptimista, the TypeError-vs-HTTP branch in flushOutbox, and now the onError callback wiring in setupAutoSync) -- all three are pure/mockable enough to unit test without a full RxDB/Dexie instance, and together would have caught both the original CRITICAL-1 and any future regression of it directly, without depending on a manual Playwright session.

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | Yes (informal) | No separate apply-progress artifact/table exists (documented: this project skips sdd-apply ceremony). tasks.md section 6 embeds the RED/GREEN sequence inline for this fix: 6.1 "Reproducido en vivo... confirmado RED", 6.2 fix, 6.3 "GREEN confirmado". |
| All tasks have tests | N/A for the frontend fix | Backend (section 1) has automated tests, unaffected. The section-6 fix is explicitly scoped to manual verification per the same project convention already accepted for sections 3-5. |
| RED confirmed (tests exist) | Manual, not an in-repo test file | tasks.md 6.1 documents a live RED reproduction (pedido vanishes, zero error banner) via a real dispatched online event against a real intercepted 400, immediately prior to the fix, in this exact session. No committed automated test asserts this. |
| GREEN confirmed (behavior verified) | Yes (manual) + source-verified | tasks.md 6.3 documents the identical repro passing after the fix. Independently confirmed this session by direct source read: the callback wiring is unambiguous and the only call site is correctly connected. |
| Triangulation adequate | Single | Only one manual repro case for this fix (the reconnect-path HTTP-400 case); this mirrors the single-scenario shape of the spec requirement itself (one MUST clause, one scenario), so a single case is proportionate. |
| Safety Net for modified files | Yes | pnpm --filter operativa run lint and run build both re-run clean after the fix, confirming no regression in the modified files or their callers. |

**TDD Compliance**: 5/5 applicable checks passed (backend scope unaffected; frontend fix scope follows the same documented manual-verification convention as the rest of this change).

---

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 2 (idempotency) + 3 (regression, no-clientRequestId) | 1 (pedidos.service.spec.ts) | Jest |
| Integration | 0 | 0 | not installed for apps/operativa |
| E2E | 0 (repo) / 5 scenarios (one-off manual sessions, incl. the new reconnect-error repro) | 0 | Playwright MCP (not persisted as a repo test) |
| Total (automated, repo-persisted) | 5 (backend only) | 1 | |

### Changed File Coverage
Coverage analysis skipped -- no coverage tool detected/configured (coverage_threshold: 0 in openspec/config.yaml). Unchanged from prior report.

### Assertion Quality
No new automated test files were added or modified by this fix (the fix touches only production code: sync.ts, MozoView.tsx). The existing pedidos.service.spec.ts assertions were re-inspected this session and remain unchanged from the prior report audit: all call real production code, assert on actual mock call arguments and return values, no tautologies, no ghost loops, no orphan empty-array checks, mock/assertion ratio well under the 2x threshold.

**Assertion quality**: All assertions verify real behavior (unchanged; no new test files in this fix).

### Quality Metrics
**Linter**: Not available (no standalone linter configured; tsc --noEmit serves as the operativa "lint" script) -- re-run independently this session, clean, exit 0.
**Type Checker**: No errors -- pnpm --filter operativa run lint (tsc -p tsconfig.json --noEmit) re-run independently this session, clean, exit 0.

### Verdict
**PASS WITH WARNINGS** -- 0 CRITICAL, 3 WARNING, 1 SUGGESTION. All 28 tasks are complete (24 original + 4 new post-verify fix tasks). The CRITICAL finding from the prior sdd-verify run (setupAutoSync reconnect-triggered flush silently swallowing HTTP errors) is confirmed fixed by direct re-inspection of the live source: setupAutoSync now accepts and invokes an onError callback, and its sole call site in MozoView.tsx wires it to the same ErrorBanner mechanism already used by the direct-submit path. All 5 requirements / 7 scenarios in this change specs are now COMPLIANT. Both re-run pnpm --filter operativa run lint and pnpm --filter operativa run build are clean, and the unaffected backend suite (pnpm --filter api test) still passes 142/142. Remaining WARNINGs are pre-existing, documented, non-blocking project conventions (no automated frontend test runner, one residual design-doc-vs-implementation deviation that no longer breaks the spec) -- none of them re-open the fixed CRITICAL. Recommend: proceed to sdd-archive.
