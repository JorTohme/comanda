# Orders and Monetary Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans as coordinator with delegated-direct narrow implementation according to repository routing. Steps use checkbox (`- [ ]`) syntax for tracking. Receipt-driven reviews remain disabled; do not launch review actors.

**Goal:** Commit orders and full-payment receipts exactly once, preserve physical drawer accounting, and make provider reconciliation recoverable.

**Architecture:** Reuse slice 01's hardened baseline. Serialize critical mutations with a tenant-validated PostgreSQL branch row lock, then persist explicit receipts and versioned fulfillment changes in one transaction. Provider HTTP calls stay outside transactions; `Pago` is a small payment-attempt history, not a second receipt ledger.

**Tech Stack:** NestJS 10, Prisma 5/PostgreSQL 16, existing Mercado Pago SDK, Zod/shared TypeScript, Jest; corepack pnpm 9.1.2.

**Spec:** `C:/Users/JorLo/Desktop/comanda/docs/superpowers/specs/2026-09-27-audit-remediation-design.md` (user approved; do not edit its status during execution).

## Global Constraints

- Execute after plan 01 reuses local `fix/production-hardening` at `8d1b3ed` on `codex/audit-remediation`; do not change main, push, deploy, or provider settings.
- Cash closing compares declared physical cash with expected physical cash. Mercado Pago and other digital receipts appear separately and never inflate expected drawer cash.
- Unknown historical tender/date stays unknown; no timestamp inferred from `Pedido.createdAt` or `updatedAt`. Existing closed snapshots retain their legacy mixed-tender meaning.
- No refunds, partial/split payments, new provider, backend queue, generic repositories, or distributed lock subsystem. English artifacts; existing domain identifiers and neutral Spanish UI copy.
- Receipt-driven reviews remain disabled/unmanaged. Tests below are verification, not review actors. Every checkbox remains unchecked until execution.
- Tests and seed target only an explicitly disposable database; missing infrastructure means unverified, never passing. Conventional commits, no AI attribution.

## Review Focus

1. Same key with changed quantity/tenant or a legacy missing fingerprint: retry cannot silently change a pedido (Task 2).
2. Cash close racing receipt/movement posting: snapshot includes a committed-before-close operation or rejects it afterward (Task 3).
3. Already-cash-collected order receiving a valid digital approval: retain one receipt and a visible payment incident (Task 4).
4. Timeout/crash between preference creation and local persistence: retry recovers the same attempt, never creates a second checkout blindly (Task 4).
5. Historical approvals without a proven collection timestamp/open shifts with ambiguous history: remain unresolved, block unsafe cash-close rollout (Task 1).

## File Map and Integration Contract

| Files (repository relative) | Responsibility |
|---|---|
| `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260927010000_money/migration.sql`, `apps/api/scripts/money-preflight.mjs`, `apps/api/scripts/backfill-cobros.mjs` | Additive schema, diagnostics, evidence-only backfill |
| `apps/api/src/prisma/branch-lock.ts`, `apps/api/test/money-fixture.ts`, `apps/api/test/money-migration.integration.spec.ts` | Lock primitive and disposable fixtures |
| `apps/api/src/pedidos/{pedidos.service.ts,pedidos.controller.ts,estado-pedido.ts}`, `apps/api/test/pedidos.integration.spec.ts`, `apps/api/src/pedidos/dto/{create-pedido.dto.ts,create-item-pedido.dto.ts,update-estado-pedido.dto.ts}`, `apps/api/src/salon/mesas/mesas.service.ts` | Creation, state/version, transactional occupancy |
| `apps/api/src/caja/caja.service.ts`, `apps/api/test/caja.integration.spec.ts`, `apps/api/src/pedidos/cobros.service.ts`, `apps/api/src/pedidos/pedidos.module.ts` | Receipts and frozen drawer totals |
| `apps/api/src/pagos/{pagos.service.ts,pagos.controller.ts,mercadopago.client.ts,pagos.module.ts}`, `apps/api/test/pagos.integration.spec.ts` | Attempts, verification, recovery |
| `packages/shared/src/index.ts`, `packages/shared/src/money.spec.ts`, `apps/web/app/{pedidos,caja}/page.tsx`, `apps/operativa/src/{MozoView,CocinaView}.tsx`, `apps/operativa/src/db/schema.ts` | Shared contracts and caller migration |
| `apps/api/src/catalogo/platos/platos.service.ts`, `ARCHITECTURE.md`, `openspec/specs/pedidos/spec.md`, `openspec/specs/pedidos-admin/spec.md`, `SEED.md` | Actual monetary semantics and rollout limits |

Consume slice 01's `apps/api/test/test-app.ts` harness `createTestApp(provider?:Partial<MercadoPagoClient>):Promise<{app:INestApplication;prisma:PrismaService;close():Promise<void>}>` and `apps/api/jest.integration.config.cjs` (real disposable PostgreSQL/Redis, integration files outside src). Also consume slice 01's `TenantContext={orgId:string;sucursalId:string}`, `JwtClaims`, `CurrentActor`, `CurrentUser` projection, `assertPedidoActionAllowed(rol:RolUsuario,destino)`; table role checks stay at the service boundary (no additional policy-helper API). Never spread actor claims into Prisma.

Produce these exact contracts for slice 03:

```ts
type MetodoCobro = "efectivo" | "mercadopago";
type Cobro = { id:string; pedidoId:string; orgId:string; sucursalId:string;
  monto:number; metodo:MetodoCobro; cobradoEn:string|null; mpPaymentId:string|null;
  usuarioId:string|null; turnoCajaId:string|null };
// Pedido schema gains version:number (int >= 0), cobro:Cobro|null.
type UpdateEstadoPedidoInput = { estado:EstadoPedido; expectedVersion:number };
// PATCH /pedidos/:id/estado; no browser can request cobrado.
avanzarEstadoPedido(baseUrl:string,id:string,estado:EstadoPedido,
  expectedVersion:number,options?:ApiOptions):Promise<Pedido>;
// POST /pedidos/:id/cobro-efectivo, admin/caja only; returns authoritative pedido.
cobrarPedidoEfectivo(baseUrl:string,id:string,options?:ApiOptions):Promise<Pedido>;
// Service signatures:
PedidosService.create(input:CreatePedidoInput,tenant:TenantContext,actor:JwtClaims):Promise<Pedido>;
PedidosService.updateEstado(id:string,input:UpdateEstadoPedidoInput,
  tenant:TenantContext,actor:JwtClaims):Promise<Pedido>;
CobrosService.cobrarEfectivo(id:string,tenant:TenantContext,actor:JwtClaims):Promise<Pedido>;
```

`Pedido.turnoCajaId` remains compatibility-only. Shared `siguienteEstadoPedido` returns null for unpaid `entregado`; Caja offers the separate cash action. Creation key is optional for online legacy callers, mandatory in slice 03's outbox. Persist and return `cobro` on every list/find/create/state path. Migrate RxDB's new fields using plan 03's migration, not by deleting databases.

### Task 1: Add receipts, attempt history and safe rollout diagnostics

**Files:** schema/migration/scripts/lock/fixture/migration test from file map; shared receipt and shift schemas.

**Interfaces:** `lockSucursal(tx:Prisma.TransactionClient,tenant:TenantContext):Promise<void>`; `moneyFixture():Promise<{prisma:PrismaService,tenant:TenantContext,actor:JwtClaims,platoId:string,dispose():Promise<void>}>`; script `runBackfill(prisma, evidence)` consumes verified `{pedidoId,paymentId,monto,cobradoEn:Date|null}` and never fabricates evidence.

- [ ] Write `money-migration.integration.spec.ts`: apply upgrade SQL to a schema containing two open shifts and assert diagnostic failure; with one ambiguous open shift assert preflight exits nonzero; backfill one verified digital record without date and assert `cobradoEn===null`, `turnoCajaId===null`; an unknown paid pedido must have no Cobro. Keep legacy closed `totalCalculado` byte-for-byte unchanged.

```ts
it("preserves proven digital tender without inventing a collection date", async () => {
  await runBackfill(f.prisma, [{ pedidoId: legacyPedido.id,
    paymentId: "verified-legacy-123", monto: 1000, cobradoEn: null }]);
  const receipt = await f.prisma.cobro.findUniqueOrThrow({
    where: { pedidoId: legacyPedido.id },
  });
  expect(receipt).toMatchObject({ metodo: "mercadopago", monto: 1000,
    cobradoEn: null, turnoCajaId: null });
  const shift = await f.prisma.turnoCaja.findUniqueOrThrow({where:{id:legacyShift.id}});
  expect(shift.totalCalculado).toBe(legacyShift.totalCalculado);
});
```

`legacyPedido` and `legacyShift` are this spec's representative pre-upgrade fixture; export `runBackfill` from the script while guarding CLI execution by entrypoint, and invoke it through a Node subprocess test when the Jest CommonJS transform cannot import `.mjs`. The subprocess receives only this fixture's evidence file and test DB URL; compare receipt/snapshot via real Prisma afterward. Never load production environment files in this test.
- [ ] Add a fixture using real Prisma. Guard database name before connecting; create one random org, branch, admin/caja user, category and available dish. `dispose` deletes only that org's cobros, pagos, movements, pedidos/items, shifts, invitations/tokens, dishes/categories/tables/users/branch/org in FK order and disconnects. Instantiate `PrismaService`, not a fake database.

```ts
const url = new URL(process.env.DATABASE_URL!);
if (url.pathname!=="/comanda_test") throw new Error("Disposable comanda_test database required");
// Each test org has randomUUID() id; never truncate another test's business data.
```

- [ ] Red: `corepack pnpm --filter api exec jest --config jest.integration.config.cjs money-migration.integration --runInBand` (missing receipt schema/diagnostic).
- [ ] Implement fields: `Pedido.version Int @default(0)`, `requestFingerprint String?`; replace global key uniqueness with `@@unique([orgId,sucursalId,clientRequestId])`; `Pedido.cobro Cobro?`, `Pedido.pagos Pago[]`. Add Cobro's contract fields (integer cents, unique pedido/payment ID, optional collection user/shift), tenant FKs and reverse relations. `cobradoEn DateTime?` permits only evidence-backfilled unknown dates; all live writes require a date. Never manufacture a receipt for generic historical `cobrado`.
- [ ] Change Pago's unique pedido relation to many attempts. Add `externalReference String @unique`, `merchantId String?`, `moneda String @default("ARS")`, `leaseUntil DateTime?`, `incidente String?`; nullable preference/init URL; extend `EstadoPago` with `creando` and `incidente`. Preserve existing identifiers and states, populate historical `externalReference=pedidoId`, leave unknown merchant null (verify before reconciling). New attempts use their UUID as reference. Add `TurnoCaja.semantica String @default("efectivo")`, `totalDigital Int?`, `totalVentas Int?`, `cobros Cobro[]`; migration explicitly labels all existing shifts `legacy_mixta`.

```sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "TurnoCaja" WHERE estado='abierto'
    GROUP BY "orgId","sucursalId" HAVING count(*)>1)
  THEN RAISE EXCEPTION 'Duplicate open shifts: reconcile before money migration'; END IF;
END $$;
CREATE UNIQUE INDEX "TurnoCaja_one_open" ON "TurnoCaja"("orgId","sucursalId")
 WHERE estado='abierto';
CREATE UNIQUE INDEX "Pago_one_active_attempt" ON "Pago"("orgId","sucursalId","pedidoId")
 WHERE estado IN ('creando','pendiente');
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_positive" CHECK (monto > 0);
```

Preflight prints org/branch/shift and count of historical `cobrado/cerrado` pedidos without proven receipts. Any preexisting open `legacy_mixta` shift blocks new money mutations until its owner reconciles it or closes it under the old release. Do not mutate it automatically; record this gate in Caja opening/collection/movement/closing paths. Backfill script defaults to dry-run, requires explicit `--apply` and a reviewed evidence file produced by fresh provider verification. Historical digital receipts never attach to a closed or next shift; null-date receipts are excluded from date reports and shown unresolved. No network inside backfill transactions.

```ts
export async function lockSucursal(tx:Prisma.TransactionClient,tenant:TenantContext) {
  const rows = await tx.$queryRaw<{id:string}[]>`
    SELECT id FROM "Sucursal" WHERE id=${tenant.sucursalId}
    AND "organizacionId"=${tenant.orgId} FOR UPDATE`;
  if (!rows.length) throw new NotFoundException("Sucursal no encontrada");
}
```

All writers acquire **Sucursal first**, then TurnoCaja, Mesa, Pedido, Pago/Cobro as needed; IDs sorted if multiple rows. Reads occur after branch lock. No writer acquires a child row then branch; no nested independent transactions. Use existing default READ COMMITTED and explicit branch serialization. Branch deletion/catalog availability/price writes that affect creation use this same lock. PostgreSQL uniqueness remains a second correctness guard.
- [ ] Green: migration test, `corepack pnpm --filter api exec prisma validate`, `corepack pnpm --filter api exec prisma generate`, shared/API lint. Commit explicit files: `feat: add receipt ledger and safe money migration`.

### Task 2: Make order creation and fulfillment transactional

**Files:** Pedidos/DTO/estado, Mesas, branch lock, integration tests; shared index and all state callers in file map. Also modify `apps/api/src/catalogo/platos/platos.service.ts` to share the branch lock for availability/price changes.

**Interfaces:** exact Pedido APIs above; `canonicalPedido(input:CreatePedidoInput):string` exported from `pedidos.service.ts`; existing `MesasService.marcarEstado(tx,id,estado)` used only after owned row validation/branch lock.

- [ ] Write concurrency and fingerprint tests in `pedidos.integration.spec.ts`, construct real services with fixture Prisma plus a stub `RealtimeGateway.emitToSucursal`. Tests create 20 concurrent identical requests and assert one ID; different quantity conflicts; same key in a second tenant is independent; same mesa with two different keys has one success. Seed a legacy same-key record with no fingerprint and assert conflict rather than guessing. Service tests also reject quantity 0/1000, empty items, unavailable dish and whitespace delivery fields.

```ts
const input = {tipoServicio:"barra" as const,clientRequestId:randomUUID(),
  items:[{platoId:f.platoId,cantidad:1}]};
const rows = await Promise.all(Array.from({length:20},()=>service.create(input,f.tenant,f.actor)));
expect(new Set(rows.map(p=>p.id)).size).toBe(1);
await expect(service.create({...input,items:[{platoId:f.platoId,cantidad:2}]},f.tenant,f.actor))
  .rejects.toBeInstanceOf(ConflictException);
```

- [ ] Red: `corepack pnpm --filter api exec jest --config jest.integration.config.cjs pedidos.integration --runInBand`.
- [ ] Implement canonical creation payload before locks: validate every source quantity as integer 1..999, trim delivery values, combine repeated dish IDs, sort by ID, enforce each combined quantity 1..999, 1..100 source/distinct items and safe positive total <= 2,147,483,647 cents. Add `@Max(999)` to the item DTO and `ArrayMinSize(1)/ArrayMaxSize(100)` to `apps/api/src/pedidos/dto/create-pedido.dto.ts`; keep service validation for direct calls. Preserve delivery XOR platform/address and self-delivery branch. Store SHA-256 of normalized input including item IDs/quantities (not today's dish prices).

```ts
export function canonicalPedido(input:CreatePedidoInput):string {
  if(input.items.length<1||input.items.length>100)throw new BadRequestException("Cantidad de elementos inválida");
  const quantities = new Map<string,number>();
  for (const i of input.items) {
    if(!Number.isInteger(i.cantidad)||i.cantidad<1||i.cantidad>999)throw new BadRequestException("Cantidad inválida");
    const cantidad=(quantities.get(i.platoId)??0)+i.cantidad;
    if(cantidad>999)throw new BadRequestException("Cantidad inválida");
    quantities.set(i.platoId,cantidad);
  }
  return JSON.stringify({tipoServicio:input.tipoServicio,mesaId:input.mesaId??null,
    plataforma:input.plataforma?.trim()||null,direccionEnvio:input.direccionEnvio?.trim()||null,
    items:[...quantities].sort(([a],[b])=>a.localeCompare(b))});
}
```

Under branch lock, check existing key first (same fingerprint returns original snapshots even if catalog changed; absent/different fingerprint returns 409). Validate table and available owned dishes in transaction. Reject any non-closed pedido for a table, even when `Mesa.estado` says libre. Insert snapshots and mark occupied in transaction. Catch P2002 **outside** failed transaction, query the tenant key and compare fingerprint; do not issue recovery queries inside an aborted PostgreSQL transaction. If no matching key, propagate a typed conflict.
- [ ] Add expectedVersion DTO `@IsInt() @Min(0)`, require actor policy at service entrance; reject generic destination `cobrado`. Under branch lock verify version, transition and tenant, update with `{id,version:expectedVersion}` and increment version. On delivery with a known live receipt advance to `cobrado` without opening shift; null-date historical evidence stays a legacy exception requiring explicit reconciliation, not fresh fulfillment. Closing requires receipt and paid state. Close/free mesa in the same transaction. Manual freeing rejects any active pedido; table deletion remains FK-restricted. Assert competing expectedVersion updates produce one success, one 409; all denied actors leave version unchanged.

```ts
if (pedido.version !== input.expectedVersion) throw new ConflictException("Pedido actualizado; recargue la vista");
const estado = input.estado === "entregado" && pedido.cobro?.cobradoEn ? "cobrado" : input.estado;
return tx.pedido.update({where:{id:pedido.id,version:input.expectedVersion},
  data:{estado,version:{increment:1}},include:{items:true,cobro:true}});
```

- [ ] Migrate every `avanzarEstadoPedido` caller to current version; never send optimistic local IDs. Wire explicit cash endpoint/button in Caja; remove generic cobrado action in shared helper. Existing role UI policy comes from plan 01. Publish events after commit; catch/log publish failure without rejecting a committed write (plan 03 owns missed-event refresh).
- [ ] Green: targeted integration + existing estado/pedidos tests, `corepack pnpm turbo run lint`, `corepack pnpm turbo run build`. Commit explicit files: `fix: serialize orders and enforce versioned fulfillment`.

### Task 3: Post cash once and freeze drawer snapshots

**Files:** Cobros/Caja services, controller/module wiring, `caja.integration.spec.ts`, shared shift types, console Caja/Pedidos.

**Interfaces:** `CobrosService.postDigital(tx:Prisma.TransactionClient,pago:Pago,paymentId:string,cobradoEn:Date,tenant:TenantContext):Promise<Cobro>` (caller owns branch lock); `CajaService.calcularTotales(turno:{montoInicial:number;movimientos:{tipo:TipoMovimientoCaja;monto:number}[];cobros:{metodo:MetodoCobro;monto:number}[]}):{totalCalculado:number;totalDigital:number;totalVentas:number}`. No dependency from Cobros to Pagos; wire providers through PedidosModule exports, preventing circular imports.

- [ ] Write real DB race tests: opening twice has one success; duplicate cash collection returns the same Cobro and does not require an open shift on replay; a digital receipt makes cash collection 409. Receipt before closing is included; closing first rejects cash/movement. Use a held branch lock and `Promise.allSettled` to force both orderings, not a sleep-based guess. After close, retry digital posting yields unassigned receipt and leaves snapshot unchanged.

```ts
expect(caja.calcularTotales({montoInicial:1000,movimientos:[{tipo:"egreso",monto:100}],
  cobros:[{metodo:"efectivo",monto:500},{metodo:"mercadopago",monto:800}]}))
  .toEqual({totalCalculado:1400,totalDigital:800,totalVentas:1300});
```

- [ ] Red: `corepack pnpm --filter api exec jest --config jest.integration.config.cjs caja.integration --runInBand`.
- [ ] Implement cash: admin/caja policy, branch lock, owned pedido read. Existing efectivo returns original pedido regardless of later fulfillment/shift close; existing digital returns conflict. Unpaid pedido must be entregado; obtain current nonlegacy open shift inside transaction, insert receipt with server date/user/full snapshot sum, update state/version and compatibility shift ID atomically. Check amount bounds; no method/amount supplied by browser.

```ts
const cobro = await tx.cobro.create({data:{...tenant,pedidoId:id,monto,
  metodo:"efectivo",cobradoEn:new Date(),usuarioId:actor.sub,turnoCajaId:turno.id}});
const updated = await tx.pedido.update({where:{id},data:{estado:"cobrado",
  version:{increment:1},turnoCajaId:turno.id},include:{items:true,cobro:true}});
```

- [ ] Implement shift open/check/movement/close under same branch lock and tenant checks. Closing reads receipt/movement rows and freezes `totalCalculado,totalDigital,totalVentas,diferencia,estado,cerradoEn` in one transaction; repeated close with identical declared amount returns frozen shift, changed declaration conflicts. No posting may target closed shift. Use BigInt sums then safe-number guards; reject any totalCalculado/totalDigital/totalVentas/diferencia outside retained Int snapshot bounds rather than wrap. Return separate unassigned digital and unresolved legacy counts via `obtenerActual/obtenerUno`; preserve legacy closed total and label `Total histórico mixto` instead of `Efectivo esperado`.

```ts
const efectivo = turno.cobros.filter(c=>c.metodo==="efectivo").reduce((n,c)=>n+BigInt(c.monto),0n);
const digital = turno.cobros.filter(c=>c.metodo==="mercadopago").reduce((n,c)=>n+BigInt(c.monto),0n);
const movimientos = turno.movimientos.reduce((n,m)=>n+(m.tipo==="ingreso"?1n:-1n)*BigInt(m.monto),0n);
const esperado = BigInt(turno.montoInicial)+efectivo+movimientos;
if (esperado < -2147483648n || esperado > 2147483647n) throw new ConflictException("Total fuera de rango");
```

- [ ] Green: Caja/Cobros integration and unit tests, shared schema tests, lint/build. Update monetary architecture/rollout documentation in this commit: `fix: separate physical cash and freeze shift closing`.

### Task 4: Verify provider identity and recover every attempt

**Files:** Pagos/adapter/controller/module/integration tests; preflight backfill adapter; shared payment schema and admin Caja reconciliation controls.

**Interfaces:** Update existing `CrearPreferenciaInput` with `externalReference:string`; keep `pedidoId` only as internal context, never use it as the new attempt reference. `PagoMercadoPago={id:string;status:string;externalReference:string|null;amountCents:number;currency:string;merchantId:string;preferenceId:string|null;approvedAt:Date|null}`; `MercadoPagoClient.obtenerPago(id):Promise<PagoMercadoPago>`; `buscarPreferencias(reference):Promise<PreferenciaCreada[]>`; `PreferenciaCreada={preferenceId:string;initPoint:string;externalReference:string;merchantId:string;monto:number;currency:string}`; `PagosService.reconciliar(pagoId:string,paymentId:string,tenant:TenantContext,actor:JwtClaims):Promise<{estado:string;incidente:string|null}>`. POST `/pagos/:id/reconciliar` admin only, body `{paymentId}`; return same incident shape on permanent mismatch.

- [ ] Write fake-provider/real-PostgreSQL tests, constructing real Caja/Cobros/Pedidos/Pagos services with fixture; fake only provider HTTP and realtime. Parameterize wrong ID, amount, currency, reference, preference and merchant; each writes visible `incidente` and no receipt. Test approval before delivery preserves abierto, later delivery becomes cobrado without shift; no-open-shift approval posts unassigned. Duplicate approvals leave one receipt; an approved Pago with missing Cobro repairs it. A valid approval after cash preserves cash and writes incident. Throw provider timeout, retry then succeeds; webhook failure must be non-2xx.

```ts
const valid:PagoMercadoPago = {id:"123",status:"approved",externalReference:attempt.id,
  amountCents:attempt.monto,currency:"ARS",merchantId:"777",
  preferenceId:attempt.mpPreferenceId,approvedAt:new Date()};
for (const wrong of [{amountCents:valid.amountCents+1},{currency:"USD"},{merchantId:"other"},
  {externalReference:"other"},{preferenceId:"other"},{id:"other"}]) {
  provider.obtenerPago.mockResolvedValue({...valid,...wrong});
  await pagos.procesarWebhook("123");
  expect(await f.prisma.cobro.count({where:{pedidoId:attempt.pedidoId}})).toBe(0);
  expect((await f.prisma.pago.findUniqueOrThrow({where:{id:attempt.id}})).incidente).not.toBeNull();
}
```

- [ ] Red: `corepack pnpm --filter api exec jest --config jest.integration.config.cjs pagos.integration --runInBand`.
- [ ] Extend adapter using installed SDK's `Payment.get`, `MerchantOrder.get({merchantOrderId})` to prove checkout association (`order.preference_id`), `Preference.get/search({options:{external_reference}})` and merchant identity. Require amount*100 to be within safe integer epsilon then round; missing fields fail verification, never default to zero. Live approved payments require a valid provider approval date; pass that verified date to `postDigital` as `cobradoEn`, so a delayed webhook reports the actual collection day rather than delivery time. Only explicit historical evidence backfill permits a null date. Production validates expected `MERCADOPAGO_MERCHANT_ID` plus current signature config; dev signature bypass must remain impossible in production. Test adapter mapping and signed HTTP webhook through compiled Nest fixture from plan 01.
- [ ] Reserve attempt UUID (`externalReference=id`) with expected amount/merchant/ARS and `creando`, 60-second lease under branch lock. Existing pendiente returns stored URL; creating live lease returns retriable 409; expired reservation searches provider by stable reference **outside transaction**, retrieves and verifies full results. Exactly one match attaches it under branch lock. Zero/multiple matches become visible incident and block new checkout pending admin recovery; do not assume provider create idempotency or recreate on timeout. `rejected` attempts permit a fresh UUID. A creating incident remains blocking until a verified result or explicitly documented provider investigation resolves it; history is never overwritten.

```ts
// HTTP boundary remains outside branch transaction.
const created = await this.mpClient.crearPreferencia({...input,externalReference:attempt.id});
return this.prisma.$transaction(async tx=>{
  await lockSucursal(tx,tenant);
  const pedido = await tx.pedido.findFirstOrThrow({where:{id:pedidoId,...tenant},include:{cobro:true}});
  if (pedido.cobro) {
    await tx.pago.update({where:{id:attempt.id},data:{estado:"incidente",incidente:"Pedido ya cobrado"}});
    return {estado:"incidente" as const}; // throw 409 after commit, never roll this record back.
  }
  return tx.pago.update({where:{id:attempt.id},data:{estado:"pendiente",
    mpPreferenceId:created.preferenceId,mpInitPoint:created.initPoint,leaseUntil:null}});
});
```

Test two preference requests produce one provider create; crash after successful external call recovers through search; cash collection during external create records incident and never returns usable URL. Never hold lock over provider calls. A provider rejection is terminal for that attempt, not for the pedido.
- [ ] For webhook, fetch verified data outside transaction, resolve known attempt by external reference (legacy reference mapped only to its preserved unique historical attempt), then under branch lock re-read amount/merchant/preference/current receipt. Bind payment ID once; conflicting provider payment ID is incident. Atomically write payment state + Cobro + delivered fulfillment reconciliation. `postDigital` returns existing same-provider/same-payment receipt; any other receipt or amount conflicts. Approval is monotonic: a late pending/rejected notification cannot erase a posted receipt. Store permanent incident and acknowledge only after commit; unknown external reference is logged/ignored, no pedido mutation. Remove controller catch-and-200: transient provider/DB failure returns 503, invalid signature 401. Admin action verifies known payment and tenant, reuses same reconciler and handles approved-with-missing-receipt recovery.
- [ ] Green: payment/HTTP/DB suites, `corepack pnpm turbo run lint`, `corepack pnpm turbo run build`; documentation includes disabled refunds and admin recovery. Commit explicit files: `fix: verify payments and recover checkout reconciliation`.

## Slice Exit Evidence

- [ ] Run `corepack pnpm --filter api exec jest --runInBand`, `corepack pnpm --filter api exec jest --config jest.integration.config.cjs --runInBand`, `corepack pnpm --filter @comanda/shared test -- --runInBand`, `corepack pnpm turbo run lint`, `corepack pnpm turbo run build` against disposable PostgreSQL/Redis; record command exits and unavailable dependencies honestly.
- [ ] Confirm every race above exercised real PostgreSQL with both lock orderings, not only mocks; preserve all existing regression suites.
- [ ] Inspect `git diff --check` and monetary docs; report disabled/unmanaged review status. Hand the exact shared contract to plan 03 before offline work starts.
