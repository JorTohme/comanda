# Operational Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans as coordinator with delegated-direct narrow implementation according to repository routing. Steps use checkbox (`- [ ]`) syntax for tracking. Receipt-driven reviews remain disabled; do not launch review actors.

**Goal:** Ship an installable offline operational shell, trustworthy branch-local reporting, usable staff invitations, safe demo maintenance and repeatable acceptance evidence.

**Architecture:** Keep the console's existing online administrative workflows and make the waiter/kitchen operational app installable with a static-only service worker. PostgreSQL performs branch-timezone conversion and receipt aggregation; the existing invitation backend remains the single provisioning path. Development seeding is fixed-identity, transactional and explicitly gated; CI owns disposable services.

**Tech Stack:** Vite/React, Next.js console, NestJS/Prisma/PostgreSQL, native service workers/Intl, existing Jest; Playwright only for browser acceptance; corepack pnpm 9.1.2.

**Spec:** `C:/Users/JorLo/Desktop/comanda/docs/superpowers/specs/2026-09-27-audit-remediation-design.md` (approved). Execute after plans 01–03; this document is not product-change authorization by itself.

## Global Constraints

- Preserve modular monolith/shared contracts/two frontends, current role policy and branch isolation; no UI redesign, email service, framework rewrite or backend queue.
- Cash closing compares declared physical cash with expected physical cash. Digital receipts never inflate expected drawer cash; historical unknown tender/date remains unresolved.
- Use receipt collection time for sales and paid-dish rankings; pedido creation time for explicitly labelled order activity. Default branch timezone is `America/Argentina/Buenos_Aires`.
- Service worker caches static shell only: no API responses, JWTs, credentials, or outbox in shared HTTP caches. Updates preserve IndexedDB and never force-reload unsaved input.
- Tests/demo seed never target live business databases. Missing infrastructure is unverified. No external deployment/provider changes; use corepack pnpm 9.1.2, conventional commits without AI attribution.
- English documents/code, existing domain identifiers and neutral Spanish UI. Receipt-driven reviews disabled/unmanaged; no review actors. Leave execution checkboxes unchecked until executing.

## Review Focus

1. Offline cold reload after installation with a saved session/queued pedido: shell opens and command survives (Task 1 + Task 5).
2. Application update while draft or failed/quarantined command exists: old worker stays active, no input/data loss (Task 1 + Task 5).
3. Collection after local midnight, DST boundary, different branch timezone, sums above int32: receipt day and safe JSON totals remain correct (Task 2).
4. Invitation result arrives after logout/branch switch or copying fails: no stale activation URL leaks into next actor and manual copy remains possible (Task 3).
5. Seed run against same-named real org, invalid target, or mid-transaction failure: no business data deletion/partial replacement (Task 4).

## File Map and Prerequisites

| Files (repository relative) | Responsibility |
|---|---|
| `apps/operativa/public/{manifest.webmanifest,icon-192.png,icon-512.png}`, `apps/operativa/scripts/{build-sw.mjs,generate-icons.mjs,sw-template.js,pwa-build.test.mjs}`, `apps/operativa/src/{pwa.ts,App.tsx,main.tsx}`, `apps/operativa/{index.html,vite.config.ts,package.json}` | Installable build-specific static shell/update prompt |
| `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260927020000_branch_timezone/migration.sql`, `apps/api/src/reportes/{reportes.service.ts,reportes.service.spec.ts}`, `apps/api/test/reportes.integration.spec.ts` | Timezone-safe receipts/demand SQL |
| `apps/api/src/reportes/dto/reportes-query.dto.ts`, `apps/api/src/sucursales/{sucursales.service.ts,dto/create-sucursal.dto.ts}`, `packages/shared/src/index.ts`, `apps/web/app/{reportes,sucursales}/page.tsx` | Date/timezone validation, response contracts, labels |
| `apps/web/app/equipo/page.tsx`, `apps/web/app/_components/NavLinks.tsx`, `packages/shared/src/invitation.spec.ts` | Existing staff-invitation API console |
| `apps/api/prisma/seed.mjs`, `apps/api/test/seed.integration.spec.ts`, `SEED.md` | Gated fixed-identity transactional demo |
| `playwright.config.ts`, `tests/browser/{pwa,invitation,recovery,money}.spec.ts`, `tests/browser/session.ts`, `package.json`, `pnpm-lock.yaml`, `.github/workflows/ci.yml` | Browser harness and CI acceptance |
| `ARCHITECTURE.md`, `AUTHENTICATION.md`, `README.md`, `openspec/specs/operativa-offline/spec.md` | Rollout, recovery, evidence and known limits |

Plan 01 supplies shared `ApiError(status,message,retryAfterMs?)`, `ApiOptions.signal`, `readSession/saveSession/clearSession/subscribeSession/ensureFreshSession/getSessionGeneration`; existing `AuthSession`/invitation acceptance. Plan 02 supplies `Cobro`, `Pedido.version/cobro`, cash collection/versioned transitions, unknown/legacy labels and `apps/api/test/money-fixture.ts`. Plan 01's `apps/api/test/test-app.ts` exports `createTestApp(provider?:Partial<MercadoPagoClient>)` and integration Jest config. Plan 03 owns tenant-scoped RxDB/offline commands, `getPendingCommandCount(tenant:TenantContext):Promise<number>` using its existing getDb internally. Count includes pending/failed/quarantined commands; never erase them for PWA upgrade.

### Task 1: Build a static-only offline operational shell

**Files:** operational PWA files in map; browser PWA tests are completed in Task 5.

**Interfaces:** `registerOfflineShell(canActivate:()=>Promise<boolean>):Promise<ServiceWorkerRegistration|null>`; `activateOfflineUpdate(registration,canActivate):Promise<boolean>`; App passes false when draft exists or pending command count > 0. No service worker in development.

- [ ] Add build validation test `apps/operativa/scripts/pwa-build.test.mjs` using `node:test`: build dist then assert manifest name/start_url/icons, icons dimensions, versioned SW allowlist contains every built JS/CSS and excludes API paths. This script is a new test file in addition to the map; run after production build.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('built worker caches shell, not authenticated API', async()=>{
  const sw=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');
  assert.match(sw,/comanda-shell-/);
  assert.match(sw,/request\.headers\.has\('authorization'\)/);
  const manifest=JSON.parse(await readFile(new URL('../dist/manifest.webmanifest',import.meta.url),'utf8'));
  assert.equal(manifest.start_url,'/');
  assert.deepEqual(manifest.icons.map(i=>i.sizes),['192x192','512x512']);
});
```

- [ ] Red: `corepack pnpm --filter operativa build; node --test apps/operativa/scripts/pwa-build.test.mjs` (missing manifest/SW).
- [ ] Create manifest `{name:"Comanda Operativa",short_name:"Comanda",start_url:"/",scope:"/",display:"standalone",background_color:"#fff",theme_color:"#2d6a4f",icons:[{src:"/icon-192.png",sizes:"192x192",type:"image/png"},{src:"/icon-512.png",sizes:"512x512",type:"image/png"}]}`; add `<link rel="manifest" href="/manifest.webmanifest">` and theme-color to index. Generate icons with a stdlib Node PNG encoder (RGBA scanlines, zlib.deflateSync, IHDR/IDAT/IEND and CRC32), opaque green square/white C; persist both actual PNGs, not renamed SVGs. No image-generation dependency.
- [ ] Build script recursively enumerates `dist/assets` static JS/CSS/fonts/images plus `/`, `/index.html`, manifest/icons. Hash sorted paths **and contents** using SHA-256; emit `dist/sw.js`. `package.json.build` becomes `vite build && node scripts/build-sw.mjs`. Fail build on missing shell/asset; do not maintain a hand-written list of hashed assets. Write the build generator to `scripts/build-sw.mjs` and the worker below to `scripts/sw-template.js`:

```js
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,relative,sep} from 'node:path';
const dist=fileURLToPath(new URL('../dist/',import.meta.url));
async function files(dir){
  return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(d=>
    d.isDirectory()?files(join(dir,d.name)):[join(dir,d.name)]))).flat();
}
const paths=['/index.html','/manifest.webmanifest','/icon-192.png','/icon-512.png',
  ...(await files(join(dist,'assets'))).map(f=>'/'+relative(dist,f).split(sep).join('/'))].sort();
const hash=createHash('sha256');
for(const path of paths)hash.update(path).update(await readFile(join(dist,path.slice(1))));
const template=await readFile(new URL('./sw-template.js',import.meta.url),'utf8');
await writeFile(join(dist,'sw.js'),`const BUILD_HASH=${JSON.stringify(hash.digest('hex').slice(0,16))};\n`+
  `const ASSET_PATHS=${JSON.stringify(['/',...paths])};\n`+template);
```

```js
// build-sw.mjs writes these literal constants with JSON.stringify from real dist.
const CACHE='comanda-shell-'+BUILD_HASH;
const STATIC=new Set(ASSET_PATHS);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll([...STATIC]))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys()) if(name.startsWith('comanda-shell-')&&name!==CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||request.headers.has('authorization'))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).catch(()=>caches.open(CACHE).then(c=>c.match('/index.html'))));return;
  }
  if(!STATIC.has(url.pathname))return;
  event.respondWith(caches.open(CACHE).then(async c=>(await c.match(url.pathname))??fetch(request)));
});
```

The generated script replaces `BUILD_HASH`/`ASSET_PATHS` constants with actual build values; these are template variables, not hand-filled placeholders. No runtime caching of navigation responses (shell is precached, contains no tenant data). Only operational origin receives worker; the Next console remains network-dependent administrative UI, not a counterfeit offline console.
- [ ] Implement update activation with explicit user click, never install-time skipWaiting or automatic reload. Render `Nueva versión disponible` and `Actualizar` in App, disable while draft/pending work exists; if disabled show `Guarde o sincronice los cambios antes de actualizar`. New worker preserves all non-shell caches and never touches IndexedDB. On accepted update, reload only after controllerchange; an update arriving offline stays waiting. Saved session follows plan 01 expiry/connectivity behavior; new login requires network.

```ts
export async function activateOfflineUpdate(registration:ServiceWorkerRegistration,
  canActivate:()=>Promise<boolean>):Promise<boolean>{
  if(!registration.waiting||!await canActivate())return false;
  registration.waiting.postMessage({type:"SKIP_WAITING"});return true;
}
export async function registerOfflineShell(canActivate:()=>Promise<boolean>){
  if(!import.meta.env.PROD||!("serviceWorker" in navigator))return null;
  const registration=await navigator.serviceWorker.register("/sw.js");
  // App observes registration.waiting/updatefound and explicitly calls activateOfflineUpdate.
  return registration;
}
```

- [ ] Green: build/node test, operativa lint; browser cold-reload/update tests in Task 5. Commit explicit files: `feat: add safe offline operational shell`.

### Task 2: Report receipts in each branch's timezone

**Files:** timezone migration/schema, report service/DTO/tests, branch create DTO/service, shared and report/branch pages.

**Interfaces:** `Sucursal.timezone:string`; `CreateSucursalInput={nombre:string;timezone?:string}`; `Reportes` preserves `ventasPorDia/platosMasPedidos/horasPico`, adds `{cobrosSinFecha:number;pedidosLegadoSinCobro:number;timezone:string}`. `obtenerConsolidado(query,orgId)` returns each branch including zero-data branches and each timezone. `toSafeInteger(value:number|bigint|string):number` exported for tests.

- [ ] Write unit guard test and PostgreSQL fixtures: pedido created 2026-09-26T23:00Z, receipt 2026-09-27T03:01Z reports September 27 in Buenos Aires; same receipt reports September 26 in Los Angeles. Seed two 2,000,000,000-cent receipts and assert 4,000,000,000 result; assert > MAX_SAFE_INTEGER rejects instead of silently rounding. New York 2026-03-08 local interval is 23 hours. Unknown date receipts never enter totals; legacy unknown pedidos appear in unresolved counts, not zero-value sales.

```ts
expect(toSafeInteger('4000000000')).toBe(4000000000);
expect(()=>toSafeInteger('9007199254740992')).toThrow();
const rows=await f.prisma.$queryRaw<{hours:number}[]>`
 SELECT EXTRACT(EPOCH FROM (((DATE '2026-03-08'+1)::timestamp AT TIME ZONE 'America/New_York')-
  (DATE '2026-03-08'::timestamp AT TIME ZONE 'America/New_York')))/3600 AS hours`;
expect(Number(rows[0].hours)).toBe(23);
```

- [ ] Red: `corepack pnpm --filter api exec jest --config jest.integration.config.cjs reportes --runInBand` and `corepack pnpm --filter api exec jest reportes.service --runInBand`.
- [ ] Add `timezone String @default("America/Argentina/Buenos_Aires")`. Validate IANA identifiers with `Intl.DateTimeFormat('en',{timeZone:value})` before saving; reject unknown identifiers, not silently default. Validate strict real `YYYY-MM-DD` dates (round-trip UTC components; reject Feb 30), inclusive desde<=hasta, maximum 366 days; do not parse client date as server local time.
- [ ] Build half-open UTC boundaries in SQL using branch-local dates; Prisma DateTime columns are timestamp without timezone storing UTC, so convert explicitly. Aggregate receipts once (do not join items into sales sum). Dish ranking joins ItemPedido to Cobro and filters collection date; hour/order demand uses all pedidos and `createdAt`, not only paid states. Use BigInt/numeric intermediate sums, never `::int` on aggregate. Convert with safe guard before JSON serialization.

```ts
const sales=await this.prisma.$queryRaw<{fecha:string;total:bigint}[]>(Prisma.sql`
 SELECT to_char((c."cobradoEn" AT TIME ZONE 'UTC') AT TIME ZONE s.timezone,'YYYY-MM-DD') AS fecha,
 SUM(c.monto::bigint) AS total
 FROM "Cobro" c JOIN "Sucursal" s ON s.id=c."sucursalId" AND s."organizacionId"=c."orgId"
 WHERE c."orgId"=${tenant.orgId} AND c."sucursalId"=${tenant.sucursalId}
 AND c."cobradoEn">= ((${query.desde}::date)::timestamp AT TIME ZONE s.timezone) AT TIME ZONE 'UTC'
 AND c."cobradoEn"< ((${query.hasta}::date+1)::timestamp AT TIME ZONE s.timezone) AT TIME ZONE 'UTC'
 GROUP BY 1 ORDER BY 1`);
export function toSafeInteger(value:number|bigint|string):number{
  const n=Number(value);if(!Number.isSafeInteger(n))throw new BadRequestException("Total fuera de rango seguro");return n;
}
```

Use `SUM(i.cantidad::bigint)` for paid-dish ranking; filter through c.cobradoEn with identical SQL boundaries. Demand uses `EXTRACT(HOUR FROM ((p.createdAt AT TIME ZONE 'UTC') AT TIME ZONE s.timezone))`, `COUNT(*)`, and p.createdAt boundaries. Consolidated query filters org only, groups branch/timezone/date and independently uses each branch's timezone; preserve cross-org exclusion. Expose counts for null-date Cobros and paid legacy pedidos without Cobro; label `Registros históricos sin fecha o medio verificado` and explain excluded totals.
- [ ] Rename console headings to `Ventas por fecha de cobro`, `Platos cobrados`, `Actividad de pedidos por hora`; show branch timezone/date semantics. Add timezone input to branch creation with default; no timezone library. Green: report integration/unit/shared tests, lint/build. Commit: `fix: report receipt dates in branch timezones`.

### Task 3: Expose the existing staff invitation workflow

**Files:** equipo page, NavLinks, shared invitation wrapper/tests; backend authorization already owned by plan 01, no second provisioning backend.

**Interfaces:** `CreateInvitationInput={email:string;sucursalId:string;rol:"caja"|"mozo"|"cocina"}`; `createInvitation(baseUrl,input,options?:ApiOptions):Promise<{activationUrl:string;expiresAt:string}>`, POST `/auth/invitations`; consumes `listSucursales`, shared session generation and ApiError.

- [ ] Write shared fetch contract test: body contains no orgId/token/password, uses authenticated shared fetch and parses activation URL/date. Reject mock 403 via ApiError; assert role admin cannot compile as `CreateInvitationInput`. Browser tests in Task 5 assert hidden employee navigation and backend denial, not only hidden buttons.

```ts
it("creates an invitation without accepting a caller-supplied tenant", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
    activationUrl: "http://localhost:3000/invitacion?token=test-only-token",
    expiresAt: "2026-09-30T12:00:00.000Z",
  }), { status: 201 }));
  await createInvitation(baseUrl, {email:"staff@example.test",sucursalId,rol:"mozo"},
    { accessToken: "test-access-token" });
  const request = fetchMock.mock.calls[0][1];
  expect(JSON.parse(request.body)).toEqual({email:"staff@example.test",sucursalId,rol:"mozo"});
  expect(request.headers.Authorization).toBe("Bearer test-access-token");
});
```

Define `fetchMock` as `jest.fn()` assigned to `global.fetch`, `baseUrl="http://localhost:3001"` and a UUID `sucursalId` in this spec; restore the original global fetch afterward. If shared headers use the `Headers` class, read the assertion via `new Headers(request.headers).get("authorization")`, not a mock-specific plain-object assumption.

```ts
const invitationSchema=z.object({activationUrl:z.string().url(),expiresAt:timestampSchema});
export async function createInvitation(baseUrl:string,input:CreateInvitationInput,options?:ApiOptions){
  const url=`${baseUrl}/auth/invitations`;
  return parseJsonOrThrow(await apiFetch(url,{method:"POST",body:JSON.stringify(input)},options),
    invitationSchema,"POST",url);
}
```

- [ ] Red: `corepack pnpm --filter @comanda/shared exec jest invitation --runInBand`.
- [ ] Add admin-only Equipo route/nav using live shared session subscription, same-org branch list. Form has labelled email/branch/employee role inputs, submit pending guard; backend decides authorization. Display URL and expiration only for successful request; no email-sent claim. Copy via clipboard on click with manual selectable URL fallback. Error copy describes expired authorization versus connectivity; do not expose token in console logs, analytics or persistent storage.

```ts
const generation=getSessionGeneration();
const result=await createInvitation(API_BASE_URL,input,{signal:controller.signal});
if(generation!==getSessionGeneration())return;
setInvitation(result);
// subscription callback aborts controller, clears result/form branch and reloads owned branches.
```

Test logout and branch switch while response pending: callback cannot display old URL; unmount aborts; clipboard rejection preserves readonly labelled URL. Invalid/used invitation acceptance follows existing `/invitacion` path and plan 01 server tests, not an invented reset workflow.
- [ ] Green: invitation shared tests, browser invitation tests, web lint/build; update authentication docs. Commit: `feat: add admin staff invitation console`.

### Task 4: Make demo seed identity-safe and transactional

**Files:** seed.mjs, seed integration test, SEED.md.

**Interfaces:** export `DEMO_ORG_ID="5dbff8f2-89ed-4c65-b39d-f6c029346ee1"`; `assertSeedEnvironment(env):void`; `seedDemo(prisma:PrismaClient,beforeCommit?:()=>Promise<void>):Promise<void>` test fault hook inside the transaction. CLI invokes only when file is entrypoint, always disconnects.

- [ ] Write integration tests: production/missing flag/live-named DB rejects **before client construction**; unrelated org named Asador Don Mario survives; second seed produces same org identity without duplicate open shifts; fault hook throws and all prior demo data survives. Verify each demo paid pedido has actual receipt/tender/date, cash snapshots exclude digital, and active mesa uniqueness holds.

```ts
const before=await f.prisma.pedido.count({where:{orgId:DEMO_ORG_ID}});
await expect(seedDemo(f.prisma,async()=>{throw new Error("forced rollback")})).rejects.toThrow("forced rollback");
expect(await f.prisma.pedido.count({where:{orgId:DEMO_ORG_ID}})).toBe(before);
```

- [ ] Red: `corepack pnpm --filter api exec jest --config jest.integration.config.cjs seed --runInBand`.
- [ ] Replace name-based deletion with fixed ID and explicit environment gate. Allowed DB hostname is localhost/127.0.0.1/postgres and name ends `_demo` or `_test`; `NODE_ENV=development` and `ALLOW_DEMO_SEED=true` required together. CI sets those only for seed child process, not production-built API. If existing fixed ID has unexpected non-demo staff identity, fail rather than erase it; never adopt a same-named legacy org automatically.

```js
export function assertSeedEnvironment(env){
  if(env.NODE_ENV!=='development'||env.ALLOW_DEMO_SEED!=='true')throw new Error('Development demo seed explicitly required');
  const u=new URL(env.DATABASE_URL);
  if(!['localhost','127.0.0.1','postgres'].includes(u.hostname)||!/_demo$|_test$/.test(u.pathname))
    throw new Error('Only isolated local *_demo/*_test databases are allowed');
}
export async function seedDemo(prisma,beforeCommit=async()=>{}){
  await prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(27092026)`;
    // Existing wipeExisting and seed helpers now receive tx and filter fixed DEMO_ORG_ID.
    await wipeExisting(tx,DEMO_ORG_ID);
    const org=await tx.organizacion.create({data:{id:DEMO_ORG_ID,nombre:ORG_NOMBRE}});
    await populateDemo(tx,org);
    await beforeCommit();
  },{timeout:120000});
}
```

`populateDemo(tx,org):Promise<void>` is the existing main creation loop extracted with tx parameters; `wipeExisting(tx,orgId):Promise<void>` takes the fixed identity and uses tenant-filtered deletes; all seedHistorial/seedTurnoAbiertoYPedidosVivos/wipeExisting queries use tx. FK delete order: Cobro/Pago, MovimientoCaja, ItemPedido/Pedido, TurnoCaja, Invitation/RefreshToken, Plato/Categoria/Mesa, Usuario, Sucursal, Organizacion; every query scopes fixed org or its branch/shift IDs. Precompute hashes before transaction. Paid historical table pedidos become cerrado/free; live assigned tables are unique, never fall back to an already used mesa. Create Cobro during each paid pedido insertion using snapshot sum, realistic alternating efectivo/mercadopago, known collection timestamp, unique demo MP payment ID and matching shift. Close demo shifts with efectivo sum + opening/movements, store separate digital/total sales; no legacy fabricated receipts.
- [ ] Green: seed integration, money/report suite, fresh seed twice on disposable DB. Document flags, fixed ID, rollback guarantee and no implicit legacy adoption. Commit: `fix: guard and transact demo data replacement`.

### Task 5: Run browser acceptance and disposable-service CI

**Files:** browser harness/tests, root package/lock, CI and maintainer documentation in map.

**Interfaces:** new Playwright dev dependency; `corepack pnpm test:browser` runs `playwright test`; config builds/starts API at 3001, web at 3000, operativa preview at 5173. `tests/browser/session.ts` exports `loginAs(page,email,password,origin):Promise<void>` using actual login form. Seed fixture uses documented demo accounts; provider HTTP remains fake only in API integration harness, browser never calls live MP.

- [ ] Add Playwright during execution (`corepack pnpm add -Dw @playwright/test`; record lock). Browser config uses one worker, no reuseExistingServer in CI, `trace:'retain-on-failure'`; exercise production operational build (service workers disabled in Vite dev). Define real login helper and cold offline test:

```ts
export async function loginAs(page:Page,email:string,password:string,origin:string){
  await page.goto(origin);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button",{name:origin.endsWith("5173")?"Entrar":"Ingresar"}).click();
  await expect(page.getByRole("button",{name:"Cerrar sesión"})).toBeVisible();
}
test('offline cold reload preserves saved session',async({page,context})=>{
  await loginAs(page,'mozo.belgrano@donmario.test','Comanda2026!','http://localhost:5173');
  await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>undefined));
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Mesa 1',{exact:true})).toBeVisible();
  await context.setOffline(false);
});
```

Verify actual labels against existing LoginScreen/AuthSession; adjust helper to visible current Spanish labels rather than introducing testing-only product copy.
- [ ] Red: `corepack pnpm exec playwright test tests/browser/pwa.spec.ts` before worker implementation; failing test must demonstrate absent offline shell, not a broken selector/server.
- [ ] Complete named browser scenarios with real interactions and assertions: offline create/reload/reconnect returns one server pedido; route API requests to 503 then 429 and observe retained visible command, restore network and observe one commit; failed validation retains retry/discard control; reload between outbox/view writes reconstructs command; old DB fixture migration quarantine; realtime deletion/reconnect snapshot removes stale row. Session scenarios: parallel 401, logout during blocked refresh, two pages refresh once, latest-token reconnect, account/branch switch isolates data. Money scenario admin opens shift, delivered cash collects once, closes shift and digital total does not change drawer. Invitation admin link/acceptance, nonadmin 403, pending response canceled on logout, copy failure/manual URL. PWA update test builds second version, triggers registration.update, draft/failed command blocks activation, clearing draft and explicitly resolving command allows user update while indexed data survives. Use plan 03's export/recovery controls, not destructive database deletion.
- [ ] Extend CI services with health checks and `comanda_test` database, Redis 7; consistent env includes production config requirements and fake integration merchant. Keep corepack pnpm 9.1.2/Node 20. Add migration clean/upgrade tests, dedicated Jest integration command, frontend unit commands from plans 01/03, production build then Playwright; upload failure traces. Unit tests do not secretly skip integration failures.

```yaml
# api-services job: existing postgres/redis services gain readiness health checks.
env:
  DATABASE_URL: postgresql://comanda:comanda@localhost:5432/comanda_test?schema=public
  REDIS_URL: redis://localhost:6379
  MERCADOPAGO_MERCHANT_ID: "777"
# After frozen install and prisma generate:
steps:
  - run: corepack pnpm --filter api exec prisma migrate deploy
  - run: corepack pnpm --filter api exec jest --config jest.integration.config.cjs --runInBand
  - run: corepack pnpm turbo run test lint build
  - run: NODE_ENV=development ALLOW_DEMO_SEED=true node apps/api/prisma/seed.mjs
  - run: corepack pnpm exec playwright install --with-deps chromium
  - run: corepack pnpm test:browser
```

Merge snippet into existing job rather than duplicate keys. Database service POSTGRES_DB must match comanda_test; HTTP servers use full test/CI JWT/CORS/public/web/signature configuration from plan 01. Browser fixtures do not require provider credentials. Migration upgrade test creates legacy fixture in separate disposable schema and applies migrations; duplicate-open shift diagnostic is asserted separately. Replace existing tautological smoke test only through plan 01's compiled HTTP boundary, do not remove healthy existing tests.
- [ ] Green: all unit/integration/browser suites, `corepack pnpm turbo run lint`, `corepack pnpm turbo run build`, node PWA test, `git diff --check`. Record actual command results/infrastructure limits and update architecture/auth/offline/README/SEED docs with migration gates, rollback (retain receipt data; never downgrade money semantics by deleting Cobro), manual reconciliation, pending command export, update behavior and non-goals. Commit: `test: verify recovery workflows with disposable services`.

## Delivery Checklist

- [ ] Map each original audit finding to its owning plan/task, test file/name, changed documentation and actual evidence; no invented review approval.
- [ ] Report operational PWA acceptance separately from online-only console scope; report unknown historical data honestly, not as accurate historical sales.
- [ ] Report remaining blocked/unverified tests explicitly, leave associated execution boxes unchecked, and preserve receipt-driven disabled/unmanaged status.
