# Tasks: Iter 5 — Offline-first (Mozo)

Sin ceremonia de sdd-apply/chained-PR — implementación directa. Strict TDD Mode activo para la idempotencia del backend (lógica real); el store RxDB del cliente y el wiring de componentes son mecánicos, se verifican manualmente con DevTools → Offline.

## 1. Backend: clientRequestId idempotente (test-first)

- [x] 1.1 `clientRequestId String? @unique` agregado a `model Pedido`
- [x] 1.2 Migración generada a mano vía `prisma migrate diff` (el entorno no soporta `migrate dev` no-interactivo) y aplicada con `migrate deploy`
- [x] 1.3 Tests RED agregados en `pedidos.service.spec.ts` (replay idempotente + creación normal con `clientRequestId` nuevo)
- [x] 1.4 RED confirmado
- [x] 1.5 Corto-circuito implementado en `pedidos.service.ts`
- [x] 1.6 `clientRequestId?: @IsOptional @IsString` en `create-pedido.dto.ts`
- [x] 1.7 GREEN — 141 tests, sin regresión

_Satisfies: pedidos spec (MODIFIED) "Create Pedido is idempotent via clientRequestId"._

## 2. packages/shared

- [x] 2.1 `clientRequestId` agregado a `pedidoSchema`/`Pedido`/`CreatePedidoInput`
- [x] 2.2 Build y tests de `shared` verdes

## 3. apps/operativa — store RxDB

- [x] 3.1 `rxdb` agregado, instalado
- [x] 3.2 `apps/operativa/src/db/schema.ts` — colecciones `mesas`, `platos`, `pedidos`, `outbox`
- [x] 3.3 `apps/operativa/src/db/useRxData.ts`
- [x] 3.4 `apps/operativa/src/db/sync.ts` — `crearPedidoOffline`, `flushOutbox`, `setupAutoSync`; distingue `TypeError` (red) de error HTTP

## 4. apps/operativa — swap a lectura reactiva

- [x] 4.1 `MozoView.tsx` migrado a RxDB + `useRxData`
- [x] 4.2 `CocinaView.tsx` migrado a RxDB + `useRxData` (incluye revertir el toggle optimista de disponibilidad vía RxDB en vez de `setState`)
- [x] 4.3 `MozoView.tsx`: `handleSubmitPedido` usa `crearPedidoOffline`

## 5. Verificación

- [x] `pnpm --filter operativa run lint` (type-check) — limpio
- [x] `pnpm --filter operativa run build` (Vite) — limpio; bundle subió de ~253KB a ~494KB gzip 154KB (esperado, es el costo de RxDB aceptado en el proposal)
- [x] `pnpm --filter api test` (141) y `pnpm build` (monorepo completo) — verdes
- [x] 5.1 DevTools → Network → Offline en Mozo: crear un pedido de barra → aparece de inmediato, sin error
- [x] 5.2 Volver a Online → el pedido optimista se reemplaza por el real sin recargar, y aparece en Cocina
- [x] 5.3 `GET /pedidos` confirma que no quedó duplicado
- [x] 5.4 Provocar un 400 real (payload roto) y confirmar que no queda reintentando solo
- [x] Nota: verificado el 2026-09-17 con Playwright MCP (Chromium real) contra `apps/api` + `apps/operativa` en local, org de QA descartable:
  - 5.1: `context.setOffline(true)` + crear pedido de barra → aparece al instante en "Mis pedidos"; consola muestra `net::ERR_INTERNET_DISCONNECTED` en el POST, sin error visible al usuario.
  - 5.2: `setOffline(false)` → `setupAutoSync` reintenta el POST solo (sin recargar), pasa de "Abierto" a estado real; una segunda pestaña logueada como Cocina lo ve aparecer en "Nuevos" vía WS sin refrescar.
  - 5.3: `GET /pedidos` devuelve exactamente 1 pedido — sin duplicado del intento offline + el reintento online.
  - 5.4: intercepté el POST con Playwright para devolver 400 real → la app muestra `Request failed: POST .../pedidos (400)` y el pedido optimista se saca de "Mis pedidos" (branch no-TypeError de `flushOutbox` corrió: borra `pedidos` + `outbox` y no reintenta). Reconectado 4s después, sin nuevos requests a `/pedidos` ni duplicados en el servidor.

## 6. Fix post-verify — CRITICAL de `sdd-verify`

`sdd-verify` (2026-09-17) encontró que 5.4 solo probé el path de submit directo (`crearPedidoOffline` llamado desde `handleSubmitPedido`, que sí propaga el error). El path real de reconexión automática — `setupAutoSync`'s listener de `online` — hacía `flushOutbox(apiUrl).catch(() => {})`, tragándose cualquier error HTTP real: un pedido rechazado al reconectar solo desaparecía de "Mis pedidos" sin avisar al mozo.

- [x] 6.1 Reproducido en vivo (Playwright): offline → pedido encolado → intercepté el POST a 400 → disparé `window.dispatchEvent(new Event("online"))` (el path que `setupAutoSync` escucha, no el submit directo) → confirmado RED: el pedido desaparece, cero banner de error.
- [x] 6.2 Fix: `setupAutoSync(apiUrl, onError?)` ahora acepta un callback y lo invoca en el catch en vez de tragarse el error; `MozoView.tsx` lo conecta a `setError(mensajeDeError(err))`, mismo mecanismo que ya usa el submit directo.
- [x] 6.3 GREEN confirmado con el mismo repro: banner `Request failed: POST .../pedidos (400)` visible también en el path de reconexión.
- [x] 6.4 `pnpm --filter operativa run lint` y `run build` — verdes tras el fix.

_Satisfies: operativa-offline spec — "A real validation error does not stay queued" debe surfacear al mozo inmediatamente, sin importar qué dispare el flush._
