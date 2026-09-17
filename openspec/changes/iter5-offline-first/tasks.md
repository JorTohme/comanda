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
- [ ] 5.1 DevTools → Network → Offline en Mozo: crear un pedido de barra → aparece de inmediato, sin error
- [ ] 5.2 Volver a Online → el pedido optimista se reemplaza por el real sin recargar, y aparece en Cocina
- [ ] 5.3 `GET /pedidos` confirma que no quedó duplicado
- [ ] 5.4 Provocar un 400 real (payload roto) y confirmar que no queda reintentando solo
- [ ] Nota: no armé un harness Node/fake-indexeddb para probar RxDB fuera del browser — `schema.ts` depende de `import.meta.env` (Vite), y meter un test runner nuevo (vitest) para esto era más alcance del que pediste. El type-check + build cubren la parte estática; lo que sigue (5.1–5.4) necesita un browser real
