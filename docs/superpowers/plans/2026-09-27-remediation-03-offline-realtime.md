# Offline and realtime recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to coordinate delegated-direct implementation task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not enable receipt-driven reviews.

**Goal:** Preserve every offline order command and converge each branch's local data to committed server state after interruptions.

**Architecture:** Retain RxDB/IndexedDB and the existing shared HTTP/socket client. Make the outbox the durable source, use native browser locks to serialize delivery, and recover authoritative snapshots after reconnect rather than relying on perfect event delivery.

**Tech Stack:** RxDB 15, IndexedDB/Dexie, React 18, Jest 29/ts-jest, Socket.IO, Web Locks; actual browser IndexedDB tests in plan 04.

**Spec:** `../specs/2026-09-27-audit-remediation-design.md`.

## Global Constraints

- Complete plan 01 and plan 02's `Pedido.version`, idempotency fingerprint and explicit cash contract before this slice.
- Every local store, command, fetch result and socket event is scoped by both `orgId` and `sucursalId`.
- Never remove an offline command before authoritative response validation and successful local persistence.
- Preserve/quarantine ambiguous legacy data; never guess its branch or silently delete it.
- Keep failed commands visible and recoverable; no service-worker Background Sync dependency.
- Use pnpm `9.1.2`, existing Jest major `29`; add no production storage/queue dependency.
- English technical artifacts; extend existing Spanish UI with neutral Spanish. No push/deploy/external provider mutation.
- Receipt review mode remains disabled/unmanaged; root coordinates narrow delegated writers and integration.

## Review Focus

1. Browser crashes after durable command insert but before optimistic insert: startup rebuilds the pending order (task 1).
2. HTTP 503, 429 or local authoritative upsert failure never deletes a command (task 2).
3. A branch switch during an in-flight request must not write its response to the new branch store (task 2).
4. Legacy organization-only storage and old outbox records cannot be proven branch-local: quarantine/export rather than reassignment (task 1).
5. Delete/update events racing a snapshot, including an older order event, converge without overwriting pending commands (tasks 4–5).

---

### Task 1: Persist commands first and rebuild local optimistic state

**Files:** Modify `apps/operativa/src/db/schema.ts`, `apps/operativa/src/db/sync.ts`, `apps/operativa/src/App.tsx`, `apps/operativa/src/MozoView.tsx`, `apps/operativa/package.json`; create `apps/operativa/jest.config.cjs`, `apps/operativa/src/db/sync.spec.ts`, `apps/operativa/src/db/legacy-recovery.ts`, `apps/operativa/src/db/legacy-recovery.spec.ts`; modify `pnpm-lock.yaml` only through declared pnpm.

**Interfaces:** Export shared `TenantContext = {orgId:string;sucursalId:string}` (or import the same exported type from plan 01). `getDb(orgId:string,sucursalId:string)` keeps the merged branch-bound database name. `OutboxEntry` fields: `id:string`, `orgId:string`, `sucursalId:string`, `input:string`, `optimistic:string`, `status:"pending"|"failed"`, `createdAt:string`, `attempts:number`, `retryAt:number`, `errorCode:string|null`, `errorMessage:string|null`. Export `crearPedidoOffline(input:CreatePedidoInput,tenant:TenantContext,apiUrl:string):Promise<void>`, `restorePendingOrders(tenant:TenantContext):Promise<void>`, `getPendingCommandCount(tenant:TenantContext):Promise<number>`. Count includes failed commands and quarantined legacy records relevant to recovery; PWA updates use it in plan 04.

- [ ] **Step 1: Add crash/recovery and tenant migration tests.** Jest mocks `./schema` with a stateful collection double; test real IndexedDB independently in plan 04. Add `jest`, `ts-jest`, `@types/jest` using versions already declared in shared, `test` script, config `preset:"ts-jest"`, `testEnvironment:"node"`, CommonJS transform for pure tests. Do not compile Vite `import.meta.env` in Jest: mock the schema module and place legacy recovery logic in its pure module, with browser storage enumeration passed explicitly.

```ts
it("restores an optimistic order after a partial local write", async () => {
  pedidos.upsert.mockRejectedValueOnce(new Error("disk write failed"));
  await expect(crearPedidoOffline(input, tenant, apiUrl)).rejects.toThrow();
  expect(outboxRows).toHaveLength(1);
  await restorePendingOrders(tenant);
  expect(pedidos.upsert).toHaveBeenLastCalledWith(
    expect.objectContaining({ clientRequestId: outboxRows[0].id }),
  );
});
```

Define fake collection `upsert/find/findOne` methods that retain records and simulate failures; use existing valid input/dish UUID fixtures. Migration cases: full tenant valid, other branch blocked, missing branch quarantined, corrupt JSON exportable rather than deleted, schema unknown fields retained in raw export.
- [ ] **Step 2: Run red.** `corepack pnpm --filter operativa test -- --runInBand sync legacy-recovery`. Expected persistence ordering and missing recovery failures.
- [ ] **Step 3: Persist source command before its projection.**

```ts
const id = crypto.randomUUID();
const optimistic = pedidoOptimista(id, input, platos, tenant);
await db.collections.outbox.upsert({ id, ...tenant,
  input: JSON.stringify({ ...input, clientRequestId: id }),
  optimistic: JSON.stringify(optimistic), status: "pending",
  createdAt: optimistic.createdAt, attempts: 0, retryAt: 0,
  errorCode: null, errorMessage: null });
await db.collections.pedidos.upsert(optimistic);
```

Optimistic `Pedido` uses plan 02 `version:0`, `cobro:null`, no public `pagos` field (attempt history stays backend-only), snapshot prices and original tenant. UI local pending marker is derived from outbox membership, not server state fields. Startup reads valid outbox commands and repairs missing optimistic rows before fetching server state. Never overwrite an acknowledged server row with an optimistic projection sharing its client request ID.

Increment RxDB schemas/migration strategies for new order version/receipt and outbox fields. For old records inside a proven branch-bound DB, only migrate automatically when that DB identity AND associated optimistic row both match complete tenant; preserve raw data and use `status:"failed"`, `errorCode:"legacy_recovery_required"` otherwise. Organization-only DBs remain untouched and are enumerated for export via `indexedDB.databases()` where available; fallback probes only the exact previous database name from merged `schema.ts`, not arbitrary databases. Expose raw JSON download and explicit retry after the user selects/verifies a branch and the server validates dish/table references. Recovery creates a fresh command ID, preserves the old record until confirmed, and never silently reuses it in another tenant. Do not delete old database as a migration shortcut.
- [ ] **Step 4: Run green.** Step 2 plus `corepack pnpm --filter operativa lint`. Update `openspec/specs/operativa-offline/spec.md` describing crash recovery and legacy quarantine honestly; browser migration remains pending plan 04.
- [ ] **Step 5: Stage exact files and commit.** `git commit -m "fix: persist offline commands before optimistic orders"`.

### Task 2: Deliver durable commands with bounded retry and tenant cancellation

**Files:** Modify `apps/operativa/src/db/sync.ts`, `apps/operativa/src/db/sync.spec.ts`, `apps/operativa/src/App.tsx`; consume `packages/shared/src/session.ts` and `ApiError` from plan 01, do not duplicate session refresh.

**Interfaces:** Export `flushOutbox(apiUrl:string,tenant:TenantContext,options?:{signal?:AbortSignal}):Promise<void>` and `setupAutoSync(apiUrl:string,tenant:TenantContext,onError?:(err:unknown)=>void):()=>void`. `setupAutoSync` owns timer/listeners/abort cleanup. `createPedido` accepts `ApiOptions.signal`. Same command ID/payload always used on transport retry.

- [ ] **Step 1: Pin retry, write failure and branch-change behavior.**

```ts
it.each([408, 429, 500, 503])("retains a command on HTTP %s", async (status) => {
  createPedido.mockRejectedValueOnce(new ApiError(status, "retry"));
  await flushOutbox(apiUrl, tenant);
  expect(entry.remove).not.toHaveBeenCalled();
  expect(entry.incrementalPatch).toHaveBeenCalledWith(expect.objectContaining({
    status: "pending", attempts: 1,
  }));
});
it("keeps command until real order persistence succeeds", async () => {
  createPedido.mockResolvedValueOnce(serverPedido);
  pedidos.upsert.mockRejectedValueOnce(new Error("quota"));
  await expect(flushOutbox(apiUrl, tenant)).rejects.toThrow("quota");
  expect(entry.remove).not.toHaveBeenCalled();
});
```

Add delayed response after `saveSession(otherBranchSession)`; verify old context response is discarded and command retained. Add two concurrent flush calls, Retry-After minimum, offline/network, 401 suspend, deterministic 400/403/404/409/422 failed state, invalid 2xx payload retained for manual recovery. Assert request timeout/cancellation cannot erase a command.
- [ ] **Step 2: Run red.** `corepack pnpm --filter operativa test -- --runInBand sync`.
- [ ] **Step 3: Serialize and classify delivery instead of deleting on exceptions.**

```ts
const retryable = (error: unknown) => error instanceof TypeError ||
  (error instanceof ApiError &&
    ([408, 429].includes(error.status) || error.status >= 500));
const delay = (attempts: number) => Math.min(60_000, 2_000 * 2 ** Math.min(attempts, 5));
// Successful authoritative local persistence precedes command removal.
await db.collections.pedidos.upsert(pedidoReal);
await db.collections.pedidos.findOne(clientRequestId).remove();
await entrada.remove();
```

Execute the quoted success sequence only if server ID differs from optimistic ID, response tenant matches, current session identity and generation still match captured context, and response contains matching `clientRequestId`. Recovery handles crash between these writes by detecting the authoritative row's same client ID; it must not recreate duplicates. Catch local storage errors separately from HTTP permanent errors and retain original command. A malformed 2xx response is not an acknowledgement; mark explicit recoverable failure rather than erase it.

Hold `navigator.locks.request("comanda.outbox:"+orgId+":"+sucursalId, callback)`; reread pending entries inside lock and recheck session before each request. In-tab promise map uses same key; fallback no native locks preserves idempotency/durability but does not claim exactly one cross-tab send. On 401 after shared refresh failure suspend attempts until session notification/foreground reauthentication; on 403 mark failed, not logout. Transient errors patch attempts/retryAt with bounded delay and Retry-After; permanent errors patch status/error, preserving input+optimistic. Abort on session/branch change and unmount; abort is a retained command, not permanent failure. Each request has finite timeout, e.g. 15 seconds, composed with owner cancellation; clear timeout in `finally`.

`setupAutoSync` triggers at startup, online, focus, socket reconnect and a 5-second foreground timer; skip hidden documents, resume on visibility. It tests due commands, does not trust `navigator.onLine` as a successful API check. Cleanup removes each listener, clears interval, aborts outstanding request. No service-worker data transport.
- [ ] **Step 4: Run green.** Step 2, all operativa/shared tests/typechecks. Update offline spec with status classification and foreground retry ceiling.
- [ ] **Step 5: Stage exact files and commit.** `git commit -m "fix: retain and retry offline commands safely"`.

### Task 3: Make pending and failed orders actionable without fake server IDs

**Files:** Modify `apps/operativa/src/MozoView.tsx`, `apps/operativa/src/CocinaView.tsx`, `apps/operativa/src/db/sync.ts`, `apps/operativa/src/db/useRxData.ts`, `apps/operativa/src/db/sync.spec.ts`; create `apps/operativa/src/_components/CommandRecovery.tsx` only if shared recovery rendering avoids duplicated UI.

**Interfaces:** Export `retryCommand(id:string,tenant:TenantContext):Promise<void>` and `discardCommand(id:string,tenant:TenantContext):Promise<void>`. Retry preserves immutable submitted payload and client key; edits create a new command/key after explicit user action. Discard requires confirmation and removes only that local pending command/projection, never a server order. Legacy raw export is separate and never deleted implicitly.

- [ ] **Step 1: Add pending-action and recovery tests.**

```ts
it("retries without changing the idempotency identity", async () => {
  await retryCommand(entry.id, tenant);
  expect(entry.incrementalPatch).toHaveBeenCalledWith({
    status: "pending", retryAt: 0, errorCode: null, errorMessage: null,
  });
  expect(entry.incrementalPatch).not.toHaveBeenCalledWith(
    expect.objectContaining({ id: expect.anything(), input: expect.anything() }),
  );
});
```

Browser tests in plan 04 assert no PATCH is sent for an optimistic order ID and user can recover a rejected dish/table command. API remains authoritative when retrying; no client-side substitution of unavailable items.
- [ ] **Step 2: Run red.** `corepack pnpm --filter operativa test -- --runInBand sync`.
- [ ] **Step 3: Bind UI affordances to durable command membership.**

```tsx
const pending = commands.find((command) => command.id === pedido.clientRequestId);
return pending ? <section aria-live="polite">
  <span>{pending.status === "failed" ? "Requiere atención" : "Pendiente de sincronización"}</span>
  {pending.status === "failed" && <button onClick={() => retryCommand(pending.id, tenant)}>
    Reintentar
  </button>}
</section> : <button onClick={() => avanzarEstadoPedido(
  apiUrl, pedido.id, siguiente, pedido.version,
)}>Avanzar</button>;
```

Show failed reason, retry/discard and legacy export, accessible button names and confirmation. Never call `avanzarEstadoPedido` until authoritative ID is persisted. Cocina receives only acknowledged kitchen orders; mozo retains pending visible. PWA `hasUnsavedInput` tracks form contents separately from durable command count.
- [ ] **Step 4: Run green.** Unit tests/typechecks; plan 04 owns DOM/browser assertions. Document retry/discard distinction in offline spec.
- [ ] **Step 5: Stage exact files and commit.** `git commit -m "feat: expose offline command recovery actions"`.

### Task 4: Publish committed CRUD events and validate realtime payloads

**Files:** Modify `apps/api/src/catalogo/categorias/categorias.service.ts`, `apps/api/src/catalogo/platos/platos.service.ts`, `apps/api/src/salon/mesas/mesas.service.ts`, `apps/api/src/pedidos/pedidos.service.ts`, `apps/api/src/caja/caja.service.ts`, `apps/api/src/pagos/pagos.service.ts`, `apps/api/src/realtime/realtime.gateway.ts`, `packages/shared/src/index.ts`; extend corresponding service and shared specs.

**Interfaces:** Publish `categoria.creada|actualizada|eliminada`, `plato.creado|actualizado|eliminado`, `mesa.creada|actualizada|eliminada`, `pedido.creado|actualizado`, `caja.actualizada`. Entity create/update payloads use shared schemas. Delete payload `{id:string;orgId:string;sucursalId:string}` validates UUIDs. Caja event `{orgId:string;sucursalId:string;turnoId:string|null}` is an invalidation, never a trusted balance. `emitToSucursal` remains a gateway method; events are best-effort signals, snapshots are authoritative.

- [ ] **Step 1: Test publish ordering and failure isolation.**

```ts
it("does not fail a committed write when publication fails", async () => {
  prisma.plato.update.mockResolvedValue(updatedPlato);
  gateway.server.to.mockImplementation(() => { throw new Error("redis down"); });
  await expect(service.update(platoId, updateInput, tenant)).resolves.toEqual(updatedPlato);
  expect(prisma.plato.update).toHaveBeenCalledTimes(1);
});
```

Adjust invocation argument order to current service signature before writing test; assert mock transaction commits before publication, and failed transaction emits nothing. Shared schema tests reject malformed UUID/date/cross-tenant payloads. Delete emits an explicit ID envelope, not a nonconforming partial entity.
- [ ] **Step 2: Run red.** `corepack pnpm --filter api test -- --runInBand categorias.service platos.service mesas.service pedidos.service caja.service pagos.service`; shared realtime schema tests.
- [ ] **Step 3: Publish only after commit and contain infrastructure failures.**

```ts
emitToSucursal(sucursalId: string, evento: string, payload: unknown): void {
  try { this.server.to(`sucursal:${sucursalId}`).emit(evento, payload); }
  catch (error) { this.logger.error("Realtime publication failed", error); }
}
```

Ensure service calls occur after `$transaction` resolves; no external event inside a transaction. Log event/branch/error, not tokens or payment secrets. Use the real gateway with its transport mocked to throw in the service regression; the shared publisher contract is nonthrowing, so do not mock the whole method to violate that contract or add catch blocks everywhere. For async adapter failures attach error logging at adapter/client boundary. Cash/digital receipt emits pedido+cash invalidation even if fulfillment is unchanged; branch money totals refresh from API.
- [ ] **Step 4: Run green.** Step 2, shared tests/API typecheck; update `openspec/specs/realtime/spec.md` and catalog/salon specs for actual event coverage, including deletion.
- [ ] **Step 5: Stage exact files and commit.** `git commit -m "fix: publish validated realtime events after committed writes"`.

### Task 5: Recover snapshots without clobbering concurrent or pending data

**Files:** Create `apps/operativa/src/db/reconcile.ts`, `apps/operativa/src/db/reconcile.spec.ts`; modify `apps/operativa/src/App.tsx`, `apps/operativa/src/MozoView.tsx`, `apps/operativa/src/CocinaView.tsx`, `apps/operativa/src/db/schema.ts`, `apps/web/app/pedidos/page.tsx`, `apps/web/app/caja/page.tsx`, `packages/shared/src/index.ts` as needed for shared validation.

**Interfaces:** `syncAuthoritativeSnapshot(apiUrl:string,tenant:TenantContext,options?:{signal?:AbortSignal}):Promise<void>` fetches `listMesas`, `listPlatos`, `listPedidos` with schema validation; include categories when that view consumes them. `applyPedidoEvent(pedido:Pedido,tenant:TenantContext):Promise<void>` compares server `version`; pending projections protected. The snapshot owner holds a per-tenant in-flight promise and a dirty flag; event callbacks mark dirty during fetch and request a follow-up snapshot, not concurrent destructive replacement. Web console invalidations refetch its current branch data.

- [ ] **Step 1: Test authoritative deletion and event races.**

```ts
it("removes deleted server rows while preserving pending commands", async () => {
  localPedidos = [staleServerOrder, optimisticOrder];
  listPedidos.mockResolvedValue([freshServerOrder]);
  await syncAuthoritativeSnapshot(apiUrl, tenant);
  expect(removedIds).toContain(staleServerOrder.id);
  expect(removedIds).not.toContain(optimisticOrder.id);
});
it("ignores an older event version", async () => {
  currentOrder = { ...serverPedido, version: 4 };
  await applyPedidoEvent({ ...serverPedido, version: 3 }, tenant);
  expect(pedidos.upsert).not.toHaveBeenCalled();
});
```

Add delete while snapshot fetch pending (dirty second fetch), branch switch during snapshot, wrong-tenant event, dish availability change visible to mozo, and event after snapshot with equal version. Snapshot removes only rows in its verified tenant that are absent from complete response and not represented in outbox. Do not infer deletion from paginated/incomplete response.
- [ ] **Step 2: Run red.** `corepack pnpm --filter operativa test -- --runInBand reconcile`.
- [ ] **Step 3: Reconcile complete snapshots and serialize recovery.**

```ts
const [mesas, platos, pedidos] = await Promise.all([
  listMesas(apiUrl, { signal }), listPlatos(apiUrl, undefined, { signal }),
  listPedidos(apiUrl, { signal }),
]);
if (getSessionGeneration() !== generation) throw new SessionChangedError();
for (const row of [...mesas, ...platos, ...pedidos]) {
  if (row.orgId !== tenant.orgId || row.sucursalId !== tenant.sucursalId)
    throw new Error("Snapshot tenant mismatch");
}
```

After all validation succeeds, merge each collection, then remove missing server IDs while protecting pending client IDs. Handle acknowledged client ID crash recovery before deleting its optimistic row. Compare `Pedido.version`, catalog/table `updatedAt`; equal timestamp is an invalidation and follow-up snapshot, not evidence of reliable total ordering. Realtime arriving during snapshot sets dirty: re-fetch once immediately; further churn schedules bounded foreground recovery rather than an infinite fetch loop. A partial local write sets dirty and is repairable by the next snapshot; never delete outbox because a snapshot failed.

On socket connect/reconnect, startup, visibility/focus and every 15 seconds foreground, recover snapshot using cancellation/generation checks. Mozo subscribes dish/table/order CRUD; cocina to dish availability and orders. Web caja/pedidos listen invalidations and refetch from API; cleanup every listener/timer/socket on tenant change/unmount. Refetch authoritative balance for receipt-only changes. Polling is recovery for lost publication, not assurance of zero-latency consistency. Current server lists are complete; if pagination is introduced, deletion reconciliation must consume a complete bounded synchronization contract before enabling it.
- [ ] **Step 4: Run green.** Reconcile/sync tests, `corepack pnpm -r lint`; plan 04 browser suite verifies real IndexedDB/socket and reconnection convergence. Update offline/realtime specs with actual guarantees and foreground limitations.
- [ ] **Step 5: Stage exact files and commit.** `git commit -m "fix: reconcile branch snapshots after realtime interruptions"`.

## Acceptance and handoff

- [ ] Unit evidence exists for each focus failure; no command-loss catch block remains.
- [ ] Commands survive retry and partial local writes; failed/legacy recovery is visible.
- [ ] No optimistic ID reaches the state endpoint; branch-changing responses cannot mutate current data.
- [ ] Plan 04 will prove installed offline cold reload, actual two-tab locks and migration/reconnect in a browser; these are not claimed complete from mocks.
