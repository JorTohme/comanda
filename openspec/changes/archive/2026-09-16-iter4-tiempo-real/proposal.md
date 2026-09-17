# Proposal: Iter 4 — Tiempo real (Socket.io + Redis)

## Intent

`MozoView`/`CocinaView` (`apps/operativa`) pollean cada 5s con un comentario explícito en el código: `// ponytail: polling until Iter 4 wires Socket.io`. `sistema-gestion-gastronomico.md` §7.3 nombra esto como el desafío técnico central del proyecto (sincronía salón ↔ cocina en tiempo real) y §8 lo lista como ítem de MVP núcleo, no de fase 2. Redis ya corre en `docker-compose.yml` pero no lo usa nadie.

## Scope

### In Scope

- Un `RealtimeGateway` (NestJS `@WebSocketGateway`, Socket.io) con autenticación por JWT en el handshake y salas por sucursal (`sucursal:<id>`) — mismo aislamiento multi-tenant que ya existe en HTTP vía `TenantContext`.
- Redis pub/sub adapter (`@socket.io/redis-adapter`) para que los eventos se propaguen entre instancias del backend, tal como describe la arquitectura — no solo un único proceso.
- Emisión de 3 eventos desde los servicios existentes, sin cambiar sus contratos HTTP: `pedido.actualizado` (`PedidosService.create`/`updateEstado`), `mesa.actualizada` (`MesasService.create`/`update`, y el driver automático dentro de `PedidosService`), `plato.actualizado` (`PlatosService.update`, cuando cambia `disponible`).
- Cliente: `packages/shared` expone `connectRealtime(baseUrl, accessToken)`. `apps/operativa` (`MozoView`, `CocinaView`) reemplaza el `setInterval` por listeners de socket. `apps/web` (`/salon`) suma un listener para reflejar `mesa.actualizada` en vivo.

### Out of Scope

- Offline-first / Service Worker / RxDB / sync (iteración aparte, sin numerar todavía).
- `apps/web` `/caja`: hoy no pollea nada (fetch único), se deja fuera para no ampliar el diff; nada le impide sumarse después con el mismo patrón.
- Reconexión visual ("● En línea"), UI de estado de conexión — es un ítem de diseño (`DESIGN.md`), no de esta iteración funcional.
- Revocar sockets cuando expira el JWT a mitad de conexión (aceptado: la sesión dura 8h, un turno típico es más corto).
- `DELETE /mesas/:id` y creación/borrado de `Plato` no emiten evento — cambios estructurales, no de estado operativo; admin puede refrescar.

## Capabilities

### New Capabilities

- `realtime`: gateway Socket.io + Redis adapter, autenticación por JWT, salas por sucursal, 3 eventos de dominio.

### Modified Capabilities

- `pedidos`, `salon`, `catalogo`: mismos contratos HTTP, más un efecto secundario (emiten evento). No se reescriben sus specs completas — el detalle vive en `specs/realtime/spec.md` como el contrato del lado que sí es nuevo.

## Approach

1. Dependencias + `RedisIoAdapter` en `main.ts` (conecta a Redis antes de levantar el server WS).
2. `RealtimeModule` (`@Global()`, mismo patrón que `AuthModule`) con `RealtimeGateway`: `handleConnection` valida JWT y hace `join`; `emitToSucursal(sucursalId, evento, payload)` para que lo inyecten los servicios de dominio.
3. RED-first: mockear `RealtimeGateway` en los specs existentes de `PedidosService`/`MesasService`/`PlatosService`, agregar la aserción de emisión, implementar.
4. `packages/shared`: `socket.io-client` + `connectRealtime`.
5. Clientes: swap de polling → sockets en `operativa`; listener nuevo en `/salon`.

## Affected Areas

| Area | Impacto | Descripción |
|---|---|---|
| `apps/api/src/realtime/` | Nuevo | `realtime.module.ts`, `realtime.gateway.ts`, `redis-io.adapter.ts` |
| `apps/api/src/main.ts` | Modificado | conecta `RedisIoAdapter` antes de `app.listen` |
| `apps/api/src/pedidos/pedidos.service.ts` | Modificado | inyecta `RealtimeGateway`, emite tras el `$transaction` |
| `apps/api/src/salon/mesas/mesas.service.ts` | Modificado | inyecta `RealtimeGateway`, emite en `create`/`update` |
| `apps/api/src/catalogo/platos/platos.service.ts` | Modificado | inyecta `RealtimeGateway`, emite en `update` |
| `apps/api/package.json` | Modificado | `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`, `redis`, `@socket.io/redis-adapter` |
| `apps/api/.env.example` | Modificado | `REDIS_URL` |
| `packages/shared/src/index.ts` | Modificado | `connectRealtime` + dep `socket.io-client` |
| `apps/operativa/src/MozoView.tsx`, `CocinaView.tsx` | Modificado | reemplaza `setInterval` por listeners de socket |
| `apps/web/app/salon/page.tsx` | Modificado | listener `mesa.actualizada` |

## Risks

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Emitir dentro de una transacción que después falla | Media (evitado por diseño) | Todo emit ocurre después de que el `$transaction` resuelve, nunca dentro del callback |
| Token expira con el socket ya conectado | Baja (aceptado) | Fuera de alcance — ver Out of Scope |
| Dos instancias del backend en dev no prueban el adapter de Redis | Baja | El adapter es transparente en single-instance; el pub/sub real se puede validar con `docker exec redis redis-cli monitor` durante la verificación manual |
| Nuevo dep en `packages/shared` (`socket.io-client`) infla el bundle de `apps/web` para pantallas que no lo usan | Baja | Tree-shaking estándar de Next; solo `/salon` importa `connectRealtime` |

## Rollback Plan

- `git revert` remueve `apps/api/src/realtime/`, las 3 inyecciones en los servicios, y los listeners del lado cliente. Los contratos HTTP no cambiaron — nada más se rompe.
- Redis vuelve a quedar sin uso, como estaba.

## Dependencies

- Redis 7 ya corre vía `docker-compose.yml`.
- `pedidos`, `salon` (mesas), `catalogo` (platos) ya existen (Iter 1–3).

## Success Criteria

- [ ] `pnpm --filter api test` verde, con tests RED-first que confirman la emisión de cada evento.
- [ ] Login como mozo y como cocina en dos pestañas; crear un pedido en Mozo lo hace aparecer en Cocina sin refrescar.
- [ ] Marcar un plato no disponible en Cocina lo refleja en Mozo (deshabilitado) sin refrescar.
- [ ] Ciclar el estado de una mesa en `/salon` (web) se refleja en Mozo sin refrescar, y viceversa vía el driver automático de pedidos.
- [ ] `pnpm build` pasa en modo estricto.
