# Authorization and sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to coordinate delegated-direct implementation task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not enable receipt-driven reviews.

**Goal:** Reuse existing hardening without tenant regressions and make permissions and session rotation reliable.

**Architecture:** Keep the NestJS modules and shared browser client. Project tenant claims explicitly, enforce actor policy at the service boundary, and coordinate refresh through one shared session store and native browser locks.

**Tech Stack:** NestJS 10, Prisma 5/PostgreSQL, Jest 29/ts-jest, Zod, React, Socket.IO, Web Locks.

**Spec:** `../specs/2026-09-27-audit-remediation-design.md`.

## Global Constraints

- Work remains on `codex/audit-remediation`; do not rewrite `main`, push, deploy or modify external provider settings.
- Preserve the modular NestJS monolith, Prisma/PostgreSQL, shared contracts and two frontends.
- Use the repository-declared pnpm `9.1.2`, Node 20 in CI; no new production dependency for session coordination.
- New technical artifacts use English; existing UI uses neutral Spanish. Conventional commits without AI attribution.
- Explicit browser state `cobrado` is forbidden; cash collection belongs to plan 02.
- Receipt-driven development remains disabled/unmanaged. Tests are delivery evidence, not a fabricated approval.

## Review Focus

1. Full signed JWT containing `sub`, `rol`, `iat`, `exp` must never reach Prisma tenant arguments (task 2 HTTP regression).
2. Failed replacement-token insertion must roll back consumption of the old token (task 3 transaction test).
3. Concurrent 401 responses in two tabs must consume one refresh token once (task 4 unit test; plan 04 browser test).
4. Logout or branch change during refresh must reject a late response without restoring the old session (task 4 deferred-response test).
5. An expired connected socket must disconnect and reconnect with current credentials, never retain the old branch room (task 5 gateway test; plan 04 browser test).

---

### Task 1: Reuse and verify the recorded hardening baseline

**Files:** Read `package.json`, `pnpm-lock.yaml`, `apps/api/src/runtime-config.ts` after merge; merge all changes already recorded at `8d1b3ed`; modify this plan only to record executed evidence.

**Interfaces:** Consumes Git commit `8d1b3ed`; produces invitation-only auth, production config checks and branch-bound refresh/storage as the starting implementation, not as presumed correct behavior.

- [ ] **Step 1: Verify isolation and toolchain before writing code.** Read `using-git-worktrees` at execution. Verify `git branch --show-current`, `git status --short`, `git merge-base --is-ancestor 054019a 8d1b3ed`, and `corepack pnpm --version`. Expected branch `codex/audit-remediation`, clean tracked tree, ancestor exit 0, pnpm `9.1.2`. Use an isolated checkout when necessary; do not copy unknown changes or switch another worktree's active branch.
- [ ] **Step 2: Preserve history and import existing work.**

```powershell
git merge --no-ff 8d1b3ed -m "chore: reuse recorded production hardening"
corepack pnpm install --frozen-lockfile
corepack pnpm --filter api exec prisma generate
corepack pnpm --filter @comanda/shared test -- --runInBand
corepack pnpm --filter api test -- --runInBand
corepack pnpm -r lint
```

Expected: merge preserves both histories; tests/typechecks pass or expose a reproducible baseline failure. Stop at an unresolvable conflict, do not invent conflict resolutions for unrelated changes. Network/toolchain failures are environment blockers, not product-test evidence.
- [ ] **Step 3: Pin the known tenant regression before accepting reuse.** In task 2's HTTP test, sign a token with real claims and assert the Prisma mock sees only two tenant fields. Expected before repair: assertion or Prisma strict-argument error. Keep production secrets, runtime fail-closed checks, invitation endpoints and rate limits from the imported work.
- [ ] **Step 4: Record baseline commands, versions and failures in the execution evidence section of the plan index.** Do not report the old 224 tests as evidence for this new baseline. The merge commit is this task's commit; no separate empty commit.

### Task 2: Separate actor identity from tenant projection and enforce action policy

**Files:** Modify `apps/api/src/auth/current-user.decorator.ts`, `apps/api/src/auth/auth.controller.ts`, `apps/api/src/pedidos/pedidos.controller.ts`, `apps/api/src/pedidos/pedidos.service.ts`, `apps/api/src/catalogo/platos/platos.controller.ts`, `apps/api/src/catalogo/platos/platos.service.ts`, `apps/api/src/salon/mesas/mesas.controller.ts`, `apps/api/src/salon/mesas/mesas.service.ts`, `packages/shared/src/index.ts`; create `apps/api/src/auth/current-actor.decorator.ts`, `apps/api/src/pedidos/pedido-policy.ts`, `apps/api/src/catalogo/platos/dto/update-disponibilidad.dto.ts`; test `apps/api/src/auth/tenant-http.spec.ts`, `apps/api/src/pedidos/pedido-policy.spec.ts`, existing service/controller specs.

**Interfaces:** `CurrentUser` produces `TenantContext {orgId:string;sucursalId:string}`. `CurrentActor` produces `JwtClaims`. `assertPedidoActionAllowed(rol:RolUsuario,destino:EstadoPedido):void` throws `ForbiddenException`. Service state changes accept actor `JwtClaims` in addition to projected tenant and call the policy with `actor.rol`; plan 02 adds `expectedVersion`. `PATCH /platos/:id/disponibilidad` accepts only `{disponible:boolean}`; full dish update remains admin-only. Table full configuration remains admin-only; admin/mozo occupancy changes cannot free a table with an active order.

- [ ] **Step 1: Add failing HTTP and policy tests.** Use `@nestjs/testing`, real `JwtService`, the actual decorators/guards/controllers, `ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true})`, and strict Prisma mocks; listen on port 0 and call native `fetch`. Include every actor/destination pair, cocina price edits, cross-tenant references and invitation creation by a valid admin.

```ts
it("projects claims before a business query", async () => {
  const token = jwt.sign({ sub: userId, rol: "mozo", orgId, sucursalId });
  const response = await fetch(`${origin}/mesas`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  expect(prisma.mesa.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { orgId, sucursalId } }),
  );
});
it("does not let cocina collect cash", () => {
  expect(() => assertPedidoActionAllowed("cocina", "cobrado")).toThrow();
});
```

Define `origin`, `jwt`, `prisma` and UUID fixture values in this spec's `beforeAll`; close the Nest app in `afterAll`. Reuse the signing signature present in `jwt.service.ts`; do not mock guard success, which would hide the defect.
- [ ] **Step 2: Run red.** `corepack pnpm --filter api test -- --runInBand tenant-http pedido-policy`. Expected failing projection/authorization assertions.
- [ ] **Step 3: Implement explicit projections and one destination policy.**

```ts
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const actor = ctx.switchToHttp().getRequest().user as JwtClaims;
  return { orgId: actor.orgId, sucursalId: actor.sucursalId };
});
export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext) =>
  ctx.switchToHttp().getRequest().user as JwtClaims,
);
const allowed: Partial<Record<EstadoPedido, RolUsuario[]>> = {
  enviado_a_cocina: ["admin", "caja", "mozo"],
  en_preparacion: ["admin", "cocina"], listo: ["admin", "cocina"],
  en_camino: ["admin", "caja", "mozo"], entregado: ["admin", "caja", "mozo"], cobrado: ["admin", "caja"], cerrado: ["admin", "caja"],
};
export function assertPedidoActionAllowed(rol: RolUsuario, destino: EstadoPedido): void {
  if (!allowed[destino]?.includes(rol)) throw new ForbiddenException("Action not allowed");
}
```

Use actual enum values from the merged shared contract; service transitions still enforce valid source/destination. Generic controller rejects `cobrado` for every actor; this policy's cash permission is consumed only by the explicit endpoint in plan 02. Audit every `@CurrentUser` caller: invitations need `CurrentActor`; Prisma calls need projection. A typed parameter alone does not strip JWT properties. Keep organization-wide admin branch/report scopes deliberately explicit.
- [ ] **Step 4: Run green and existing regression suites.** Run step 2, then `corepack pnpm --filter api test -- --runInBand` and `corepack pnpm -r lint`. Update `openspec/specs/pedidos-admin/spec.md`, `openspec/specs/catalogo-admin/spec.md` and `openspec/specs/salon-admin/spec.md` with destination/availability/occupancy rules using each existing document's language.
- [ ] **Step 5: Commit only task files.** `git commit -m "fix: enforce tenant projection and actor action policy"` after staging exact modified files with `git add <paths>`; no `git add .`.

### Task 3: Rotate refresh tokens in one transaction

**Files:** Modify `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.service.spec.ts`, `apps/api/src/auth/dto/refresh.dto.ts` only if merged contract still accepts a branch hint.

**Interfaces:** Preserve `refresh(rawToken:string):Promise<AuthSession>` and server-bound `RefreshToken.sucursalId`. Refactor existing private session minting to accept `Prisma.TransactionClient | PrismaService`; `session(user, sucursalId?, db=this.prisma)` writes the replacement through that supplied client. Admin branch switching remains the only branch-selection endpoint.

- [ ] **Step 1: Test rollback and single-winner rotation.** Extend transaction mocks so updates roll back on rejected `create`; real parallel database verification belongs to plan 02's integration harness.

```ts
it("keeps the old token usable when minting fails", async () => {
  tx.refreshToken.create.mockRejectedValueOnce(new Error("insert failed"));
  await expect(service.refresh(rawToken)).rejects.toThrow("insert failed");
  expect(prisma.$transaction).toHaveBeenCalled();
  expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
});
```

Also assert conditional consumption includes unexpired token, null revocation and exact ID; malicious `sucursalIdHint` is rejected/ignored according to the removed DTO contract, never used to choose a branch.
- [ ] **Step 2: Run red.** `corepack pnpm --filter api test -- --runInBand auth.service`. Expected missing transaction/conditional-expiry failure.
- [ ] **Step 3: Move all rotation writes into the transaction.**

```ts
return this.prisma.$transaction(async (tx) => {
  const now = new Date();
  const existing = await tx.refreshToken.findUnique({ where: { tokenHash } });
  if (!existing) throw new UnauthorizedException("Invalid or expired refresh token");
  const consumed = await tx.refreshToken.updateMany({
    where: { id: existing.id, revokedAt: null, expiresAt: { gt: now } },
    data: { revokedAt: now },
  });
  if (consumed.count !== 1) throw new UnauthorizedException("Invalid or expired refresh token");
  const user = await tx.usuario.findUnique({ where: { id: existing.usuarioId } });
  const branch = user && await tx.sucursal.findFirst({
    where: { id: existing.sucursalId, organizacionId: user.organizacionId },
  });
  if (!user || !branch)
    throw new UnauthorizedException("Invalid or expired refresh token");
  return this.session(user, existing.sucursalId, tx);
});
```

Use merged `Usuario`/token organization field names when checking membership; if token has no `orgId`, verify its bound branch belongs to `user.orgId` through `tx.sucursal.findFirst`. The transaction must fail before committing any consumption when membership no longer holds. Do not create external side effects inside this transaction.
- [ ] **Step 4: Run green.** Step 2 plus API full suite/typecheck. Add rotation/rollback protocol to `AUTHENTICATION.md`.
- [ ] **Step 5: Stage exact files and commit.** `git commit -m "fix: rotate branch-bound refresh tokens atomically"`.

### Task 4: One session store and coordinated browser refresh

**Files:** Create `packages/shared/src/auth-contract.ts`, `packages/shared/src/session.ts`, `packages/shared/src/session.spec.ts`; modify `packages/shared/src/index.ts`, `packages/shared/src/index.spec.ts`.

**Interfaces:** Export `TenantContext = {orgId:string;sucursalId:string}` from `auth-contract.ts`. Move existing `authSessionSchema`, `AuthSession`, `rolUsuarioSchema`, `RolUsuario` to `auth-contract.ts` and re-export, avoiding a circular runtime import. Export `readSession():AuthSession|null`, `saveSession(session:AuthSession):void`, `clearSession():void`, `subscribeSession(handler:()=>void):()=>void`, `getSessionGeneration():number`, `ensureFreshSession(baseUrl:string,failedAccessToken?:string):Promise<AuthSession>`, `SessionChangedError`. Export `ApiError extends Error {status:number;retryAfterMs?:number}` with constructor `(status,message,retryAfterMs?)`. Extend `ApiOptions` with `signal?:AbortSignal`.

- [ ] **Step 1: Add deferred-fetch tests and storage doubles.** Use existing Jest rather than a new test framework. Mock native storage, `navigator.locks.request`, `fetch`; deferred promises are resolved explicitly by tests.

```ts
it("shares one refresh across concurrent callers", async () => {
  saveSession(original);
  const calls = [ensureFreshSession(baseUrl, original.accessToken),
    ensureFreshSession(baseUrl, original.accessToken)];
  resolveRefresh(new Response(JSON.stringify(replacement), { status: 200 }));
  expect(await Promise.all(calls)).toEqual([replacement, replacement]);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not resurrect a logged-out session", async () => {
  saveSession(original);
  const pending = ensureFreshSession(baseUrl, original.accessToken);
  clearSession();
  resolveRefresh(new Response(JSON.stringify(replacement), { status: 200 }));
  await expect(pending).rejects.toBeInstanceOf(SessionChangedError);
  expect(readSession()).toBeNull();
});
```

Define original/replacement valid sessions from current `authSessionSchema`, and a fetch deferred helper inside the spec. Add branch-switch-during-refresh, 503 preservation, invalid-token clearing, SSR no-storage and legacy-key migration tests. Two-tab locks are tested against an actual browser in plan 04, not claimed from a single mocked JS realm.
- [ ] **Step 2: Run red.** `corepack pnpm --filter @comanda/shared test -- --runInBand session index`.
- [ ] **Step 3: Store one atomic JSON document and guard refresh commits.**

```ts
const key = "comanda.session";
let generation = 0;
const listeners = new Set<() => void>();
export function getSessionGeneration(): number { return generation; }
export function saveSession(session: AuthSession): void {
  localStorage.setItem(key, JSON.stringify(authSessionSchema.parse(session)));
  generation++;
  listeners.forEach((notify) => notify());
}
export function clearSession(): void {
  localStorage.removeItem(key);
  generation++;
  listeners.forEach((notify) => notify());
}
```

Read/migrate the existing three legacy keys once only when the canonical document is absent; parse all fields before migrating; remove legacy keys after successful canonical write. Storage failure is surfaced, never silently converted to an authenticated session. SSR reads return null without accessing browser globals. Subscribe to same-document updates and native `storage` updates; increment generation on cross-tab changes.

Refresh holds `navigator.locks.request("comanda.session.refresh", callback)` on supported secure browsers. Inside the lock, reread storage: if another tab replaced the failed access token, return that session without calling refresh. Maintain one in-flight promise keyed by API origin and refresh identity within a tab. Before awaiting network, capture generation and original refresh token; after response, reread both and reject `SessionChangedError` if changed. Raw `fetch` to `/auth/refresh` avoids recursive `apiFetch`; validate JSON before writing. On 401/403 clear only the unchanged original session; network/408/429/5xx preserve it. Reject a late successful API result after tenant/generation change. Explicit `ApiOptions.accessToken` calls never mutate browser session. Copy `signal` into fetch options. Parse `Retry-After` seconds/date into bounded nonnegative `retryAfterMs` for outbox use.

Web Locks provide cross-tab exclusion; when unavailable, retain in-tab single-flight and display the unsupported coordination warning rather than inventing a fragile localStorage lease. Supported offline/multitab acceptance uses a browser with Web Locks in secure context. References: [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).
- [ ] **Step 4: Run green.** Step 2 plus shared build and all workspace typechecks. Replace the old global session-expired callback only after all callers migrate in task 5; document the canonical key/legacy migration in `openspec/specs/operativa-offline/spec.md`.
- [ ] **Step 5: Stage exact files and commit.** `git commit -m "fix: coordinate refresh through one shared session store"`.

### Task 5: Bind both frontends and sockets to the live session

**Files:** Modify `apps/web/app/_components/AuthSession.tsx`, `apps/web/app/_components/useAuthenticated.ts`, `apps/web/app/_components/SucursalSwitcher.tsx`, `apps/web/app/_components/NavLinks.tsx`, `apps/web/app/pedidos/page.tsx`, `apps/web/app/catalogo/page.tsx`, `apps/web/app/salon/page.tsx`, `apps/operativa/src/App.tsx`, `apps/operativa/src/LoginScreen.tsx`, `apps/operativa/src/CocinaView.tsx`, `apps/operativa/src/MozoView.tsx`, `packages/shared/src/index.ts`, `apps/api/src/realtime/realtime.gateway.ts`; create `apps/api/src/realtime/realtime.gateway.spec.ts`; extend shared socket tests in `packages/shared/src/index.spec.ts`.

**Interfaces:** Replace `connectRealtime(baseUrl,accessToken)` with `connectRealtime(baseUrl:string):Socket`; socket auth callback reads the current session and invokes `ensureFreshSession` when token expired. React providers consume `subscribeSession` and `readSession`. Login/accept/switch/logout use `saveSession`/`clearSession` only. Preserve any merged invitation-accept page and migrate its storage too.

- [ ] **Step 1: Add fake-clock gateway expiry and socket-auth tests.**

```ts
it("disconnects when the verified token expires", () => {
  jest.useFakeTimers();
  jwt.verify.mockReturnValue({ sub: userId, orgId, sucursalId,
    rol: "mozo", exp: Math.floor(Date.now() / 1000) + 2 });
  gateway.handleConnection(socket);
  jest.advanceTimersByTime(2001);
  expect(socket.disconnect).toHaveBeenCalledWith(true);
  jest.useRealTimers();
});
```

Add replacement-token-on-reconnect and timer cleanup on disconnect. Browser role/branch/lifecycle tests are owned by plan 04; do not treat hidden UI buttons as authorization enforcement.
- [ ] **Step 2: Run red.** `corepack pnpm --filter api test -- --runInBand realtime.gateway` and shared socket tests.
- [ ] **Step 3: Implement credential callbacks and expiry cleanup.**

```ts
const socket = io(baseUrl, { autoConnect: false, auth: async (done) => {
  try {
    const session = await ensureFreshSession(baseUrl);
    done({ token: session.accessToken });
  } catch { socket.disconnect(); }
} });
// In the owning React effect, not hidden inside connectRealtime:
const unsubscribe = subscribeSession(() => {
  socket.disconnect();
  if (readSession()) socket.connect();
});
```

`ensureFreshSession(baseUrl)` checks JWT expiry locally for scheduling only; verification remains server-side. Do not refresh an unexpired token absent a failed-token argument. The owning effect returns `() => { unsubscribe(); socket.disconnect(); }`; keep the shared factory free of hidden subscriptions. Return socket ownership with deterministic cleanup: every component closes socket and unsubscribe on unmount/branch change. Avoid reconnecting to an invalid session in a tight loop; retry transient failures with bounded backoff/foreground trigger. In gateway use validated JWT `exp`, store timeout in `client.data`, clear in `handleDisconnect`, and disconnect at expiry. Tenant room binding must come from verified claims, never client-supplied branch. Session refresh notifications do not restart offline stores unless tenant actually changes. Hide unauthorized actions according to task 2 policy; price/name inputs unavailable to cocina. Reference: [Socket.IO client auth options](https://socket.io/docs/v4/client-options/).
- [ ] **Step 4: Run green and search remaining legacy writes.** Run task tests, `corepack pnpm -r lint`, and `git grep -n 'localStorage.setItem\|setSessionExpiredHandler\|connectRealtime' -- apps packages`. Only canonical session module may write auth keys; no stale-token socket signatures remain. Update auth behavior in `ARCHITECTURE.md` and `openspec/specs/operativa-offline/spec.md`.
- [ ] **Step 5: Stage exact files and commit.** `git commit -m "fix: bind frontend actions and sockets to current sessions"`.

### Task 6: Prove rotation with the real application and disposable infrastructure

**Files:** Create `apps/api/test/test-app.ts`, `apps/api/test/refresh.integration.spec.ts`, `apps/api/jest.integration.config.cjs`; create root `docker-compose.test.yml`; modify `apps/api/package.json`, `apps/api/src/realtime/redis-io.adapter.ts` and its unit test for deterministic Redis shutdown. No production database reset commands.

**Interfaces:** Export `createTestApp(provider?:Partial<MercadoPagoClient>):Promise<{app:INestApplication;prisma:PrismaService;close():Promise<void>}>`. Later plans consume the real application with a fake external provider only, not fake Prisma/Redis. Add `RedisIoAdapter.close():Promise<void>` to quit both retained pub/sub clients. Use the imported Redis throttler's existing module cleanup, or add its lifecycle cleanup if missing.

- [ ] **Step 1: Add a database race and rollback regression.** Define organization/branch/user fixtures with `crypto.randomUUID()`, hash a password with the existing helper, and create a session through actual login. Test two refresh HTTP calls concurrently and transaction rollback with a temporary PostgreSQL trigger restricted to that fixture's user.

```ts
const responses = await Promise.all([1, 2].map(() => fetch(`${origin}/auth/refresh`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ refreshToken: session.refreshToken }),
})));
expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
expect(await prisma.refreshToken.count({
  where: { usuarioId: userId, revokedAt: null },
})).toBe(1);
```

For rollback, inject an INSERT failure with a test-only trigger on `RefreshToken` for `usuarioId=userId`, refresh once (500), drop trigger in `finally`, then retry the same token (200). Trigger/function identifiers are hardcoded test names, user ID a validated UUID; run this suite serially. Clean only rows from the created organization in foreign-key order. Assert fixture branch membership survives and a non-admin refresh cannot select another branch.
- [ ] **Step 2: Run red with dedicated infrastructure.** Start disposable PostgreSQL/Redis using this task's `docker-compose.test.yml` services (or already provided disposable localhost test services), set `DATABASE_URL` to database `comanda_test`, `REDIS_URL` to the test instance, apply migrations, then `corepack pnpm --filter api test:integration -- --runInBand refresh`. Before task 3's repair, expected double-use/rollback failure; after repair this first run may be green, so preserve task 3's red evidence separately.
- [ ] **Step 3: Implement the harness using actual Nest guards and adapter.**

```ts
export async function createTestApp(provider?: Partial<MercadoPagoClient>) {
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (database.pathname !== "/comanda_test") throw new Error("Test database required");
  if (!process.env.REDIS_URL) throw new Error("Test Redis required");
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (provider) builder.overrideProvider(MercadoPagoClient).useValue(provider);
  const module = await builder.compile();
  const app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true,
    forbidNonWhitelisted: true, transform: true }));
  const adapter = new RedisIoAdapter(app);
  await adapter.connectToRedis();
  app.useWebSocketAdapter(adapter);
  await app.listen(0, "127.0.0.1");
  return { app, prisma: app.get(PrismaService), close: async () => {
    await app.close(); await adapter.close();
  } };
}
```

Set test secrets and test-mode runtime configuration before importing `AppModule`; do not bypass production validation. Redis fixture must be a separate disposable instance, never flush a user-supplied production URL. Dedicated config: `rootDir: "."`, `testMatch: ["<rootDir>/test/**/*.integration.spec.ts"]`, `testEnvironment: "node"`, `testTimeout: 30000`, `transform: {"^.+\\.ts$": ["ts-jest",{tsconfig:{rootDir:".",module:"commonjs"}}]}`. Add script `"test:integration": "jest --config jest.integration.config.cjs"`. Exported TypeScript tests live outside unit `src` config. Initialize fixtures in `beforeAll`, close app/Redis in `afterAll`, no `--forceExit` masking leaked handles.

Create a separate compose file, no shared production volumes or destructive reuse:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: comanda
      POSTGRES_PASSWORD: comanda
      POSTGRES_DB: comanda_test
    ports: ["55432:5432"]
    tmpfs: ["/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U comanda -d comanda_test"]
      interval: 2s
      timeout: 2s
      retries: 20
  redis:
    image: redis:7
    ports: ["56379:6379"]
    command: ["redis-server", "--save", "", "--appendonly", "no"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 2s
      retries: 20
```

Start with `docker compose -p comanda-remediation-test -f docker-compose.test.yml up -d --wait`. In PowerShell set `$env:DATABASE_URL='postgresql://comanda:comanda@localhost:55432/comanda_test?schema=public'`, `$env:REDIS_URL='redis://localhost:56379'`, `$env:JWT_SECRET='integration-only-secret-not-for-production'`, `$env:NODE_ENV='test'`; set any merged runtime-required local public/CORS URLs before import. Run `corepack pnpm --filter api exec prisma migrate deploy`. At task/suite completion `docker compose -p comanda-remediation-test -f docker-compose.test.yml down` removes only this disposable project, not existing development services. Docker unavailable means this test is unverified until alternative disposable services are provided.
- [ ] **Step 4: Run green against PostgreSQL and Redis.** Step 2, then the API unit suite/typecheck. Assert no open handles. Document infrastructure URLs and actual test output in index.
- [ ] **Step 5: Stage exact files and commit.** `git commit -m "test: exercise auth rotation with postgres and redis"`.

## Acceptance and handoff

- [ ] All five review-focus regressions have runnable tests; actual cross-tab/browser evidence remains explicitly pending until plan 04.
- [ ] Full shared/API suites and workspace typechecks pass on reused baseline plus repairs.
- [ ] No generic endpoint permits browser collection; plan 02 supplies the explicit collection endpoint/version contract.
- [ ] Record actual outputs and environment limitations in plan index; proceed to plan 02 without claiming whole-system completion.
