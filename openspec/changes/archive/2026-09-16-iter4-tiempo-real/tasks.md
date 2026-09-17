# Tasks: Iter 4 — Tiempo real

Sin ceremonia de sdd-apply/chained-PR — implementación directa, un solo diff. Strict TDD Mode sigue activo para todo lo que tiene lógica real (gateway, emisión desde los servicios); el resto (deps, wiring de módulos, cliente) es mecánico.

## 1. Dependencias y bootstrap

- [x] 1.1 Agregar a `apps/api/package.json`: `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`, `redis`, `@socket.io/redis-adapter`
- [x] 1.2 Agregar `socket.io-client` a `packages/shared/package.json`
- [x] 1.3 `pnpm install`
- [ ] 1.4 Agregar `REDIS_URL=redis://localhost:6379` a `apps/api/.env.example` (y al `.env` local) — pendiente: permisos de la sesión bloquean tocar archivos `.env*`; funciona igual porque el adapter cae al mismo default cuando la variable no está definida, pero conviene declararla explícitamente

## 2. RealtimeGateway (test-first)

- [x] 2.1 Escribir `apps/api/src/realtime/realtime.gateway.spec.ts`
- [x] 2.2 `pnpm --filter api test` — confirmado RED
- [x] 2.3 Crear `apps/api/src/realtime/realtime.gateway.ts`
- [x] 2.4 Crear `apps/api/src/realtime/realtime.module.ts`
- [x] 2.5 Crear `apps/api/src/realtime/redis-io.adapter.ts`
- [x] 2.6 Modificar `apps/api/src/main.ts`
- [x] 2.7 Agregar `RealtimeModule` a `apps/api/src/app.module.ts`
- [x] 2.8 `pnpm --filter api test` — GREEN

_Satisfies: realtime spec "Autenticación del socket por JWT", "Aislamiento por sucursal"._

## 3. Emisión desde PedidosService (test-first)

- [x] 3.1–3.5 completos — RED confirmado, implementado, GREEN

_Satisfies: realtime spec "Evento pedido.actualizado", "Evento mesa.actualizada" (driver automático)._

## 4. Emisión desde MesasService y PlatosService (test-first)

- [x] 4.1–4.5 completos — RED confirmado, implementado, GREEN

_Satisfies: realtime spec "Evento mesa.actualizada" (path manual), "Evento plato.actualizado"._

## 5. Cliente compartido

- [x] 5.1 `connectRealtime(baseUrl, accessToken)` en `packages/shared/src/index.ts`
- [x] 5.2 `pnpm --filter shared build` y `test` — verdes

## 6. apps/operativa — swap polling → sockets

- [x] 6.1 `MozoView.tsx` — polling reemplazado por `connectRealtime` + listeners
- [x] 6.2 `CocinaView.tsx` — ídem
- [x] 6.3 Comentario ponytail borrado en ambos

## 7. apps/web — listener en /salon

- [x] 7.1 `apps/web/app/salon/page.tsx` — listener `mesa.actualizada` agregado

## 8. Verificación

- [x] 8.1 Postgres + Redis ya corrían vía `docker-compose.yml`
- [x] 8.7 `pnpm --filter api test` (139 tests) y `pnpm build` — verdes
- [x] Verificación end-to-end automatizada (script descartable): login real, `POST /categorias` + `/platos` como admin, `POST /pedidos` como mozo, socket conectado con el JWT de mozo recibe `pedido.actualizado` con el mismo id — confirma auth de handshake, join de sala, emisión post-transacción y el adapter de Redis en un solo flujo real (no mockeado)
- [ ] 8.2–8.6, 8.8 — recorrido visual en el browser (dos pestañas de `apps/operativa` + `/salon`, togglear disponibilidad, ciclar mesa, verificar aislamiento entre sucursales): pendiente para vos, ya que necesita ojos en la pantalla — el mecanismo que lo sostiene (emisión + auth + sala) ya está probado end-to-end arriba
