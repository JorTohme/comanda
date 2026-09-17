# Proposal: Iter 5 — Offline-first (Mozo)

## Intent

`iter3-pedidos` dejó anotado explícitamente: "Anything in `apps/operativa` — untouched until Iter 5 (offline-first, Service Worker, RxDB, sync)". `sistema-gestion-gastronomico.md` §8 lista "Carga de pedidos (mesa y barra) offline-first en la PWA" como ítem de MVP núcleo. Hoy `apps/operativa` es 100% online-only (confirmado: sin RxDB, sin IndexedDB, `useState` + `fetch` directo) — es el único ítem de MVP que sigue sin cerrar después de Iter 4 (tiempo real).

## Scope

### In Scope

- Store local en `apps/operativa` con **RxDB** (adapter Dexie/IndexedDB, sin plugins premium) — 3 colecciones espejo de los tipos de `packages/shared` (`mesas`, `platos`, `pedidos`) + 1 `outbox` para pedidos creados offline.
- Lectura: el fetch inicial y los eventos de `pedido.actualizado`/`mesa.actualizada`/`plato.actualizado` (Iter 4) actualizan RxDB en vez de `useState` directo. `MozoView`/`CocinaView` leen de queries reactivas de RxDB — el último estado conocido sobrevive aunque se caiga la red mientras la pestaña sigue abierta.
- Escritura offline: crear un `Pedido` (mesa o barra) funciona sin red. Inserción optimista local con un `clientRequestId` generado en el cliente, encolada en `outbox`, y reenviada a `POST /pedidos` (ahora idempotente) al reconectar (`window.addEventListener("online", ...)` + un flush al montar la vista).
- Backend: `Pedido.clientRequestId` (nullable, único) + migración; `CreatePedidoDto.clientRequestId` opcional; `PedidosService.create` devuelve el pedido existente sin duplicar ni re-disparar el efecto sobre `Mesa` cuando el `clientRequestId` ya existe para ese tenant.

### Out of Scope

- **Service Worker / manifest.json / iconos / instalación como PWA.** No hace falta para que el offline de datos funcione mientras la pestaña sigue abierta — RxDB/IndexedDB no depende del Service Worker. Lo que sí requiere Service Worker es sobrevivir un *reload en frío sin red* (cerrar la pestaña y reabrirla offline); ese caso queda fuera, ligado al pase de diseño visual pendiente de `apps/operativa` (todavía no hay ícono de marca ni `DESIGN.md` cerrado para esa app — ver conversación previa).
- Avanzar `estado` de un pedido offline (Enviar a cocina / Empezar / Listo / Entregar) — sigue online-only. El patrón de `outbox` queda armado para sumarlo después sin rediseñar.
- Togglear disponibilidad de plato (Cocina) offline — sigue online-only.
- CRDT o resolución de conflictos más allá de lo ya cerrado en `sistema-gestion-gastronomico.md` §3 (servidor autoritativo, ítems commutativos, last-write-wins por versión en el resto).
- `apps/web` — no es offline-first por diseño (doc §5, la caja necesita red sí o sí); sin cambios.
- Reintentos con backoff exponencial o cola robusta ante horas de desconexión — alcanza con reintentar en `online` y al montar; cubre el caso real (wifi de local que parpadea), no un dispositivo perdido por horas con cientos de pedidos en cola.
- iOS / Background Sync API — aceptado en el doc de arquitectura, fuera de alcance (dispositivos Android del local).

## Capabilities

### New Capabilities

- `operativa-offline`: store local RxDB, cola `outbox`, reconciliación al reconectar.

### Modified Capabilities

- `pedidos`: `POST /pedidos` gana idempotencia opcional vía `clientRequestId` — mismo contrato, un campo nuevo opcional, sin romper los llamados existentes que no lo mandan.

## Approach

1. Migración additiva: `Pedido.clientRequestId String? @unique`.
2. RED-first en `PedidosService`: replay con el mismo `clientRequestId` devuelve el pedido existente, no crea uno nuevo, no toca `Mesa`, no emite de nuevo.
3. `CreatePedidoDto` + `Pedido`/`CreatePedidoInput` en `packages/shared` ganan `clientRequestId`.
4. `apps/operativa/src/db/`: schema RxDB + hook reactivo mínimo (`useRxData`) + manejador de `outbox` (encolar, flush, reconciliar por `clientRequestId`).
5. `MozoView`/`CocinaView`: swap de `useState` a las queries reactivas; `MozoView` gana la ruta de creación offline.

## Affected Areas

| Area | Impacto | Descripción |
|---|---|---|
| `apps/api/prisma/schema.prisma` | Modificado | `Pedido.clientRequestId String? @unique` |
| `apps/api/src/pedidos/dto/create-pedido.dto.ts` | Modificado | `clientRequestId?: string` |
| `apps/api/src/pedidos/pedidos.service.ts` | Modificado | corto-circuito idempotente al inicio de `create` |
| `packages/shared/src/index.ts` | Modificado | `clientRequestId` en `Pedido`/`CreatePedidoInput`; deps `rxdb`, `rxdb` storage dexie quedan en `apps/operativa`, no acá |
| `apps/operativa/package.json` | Modificado | `rxdb`, `rxdb/plugins/storage-dexie` |
| `apps/operativa/src/db/schema.ts`, `sync.ts`, `useRxData.ts` | Nuevo | store local, outbox, hook reactivo |
| `apps/operativa/src/MozoView.tsx`, `CocinaView.tsx` | Modificado | lectura vía RxDB reactivo; `MozoView` suma creación offline |

## Risks

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Doc optimista local (id temporal) queda duplicado junto al real tras el push | Media (evitado por diseño) | El doc local usa `clientRequestId` como `id` temporal; al confirmar el push se borra ese doc y se upsertea el real por su `id` de servidor — nunca conviven |
| `outbox` reintenta un error de validación (400) indefinidamente | Media (evitado por diseño) | Solo un fallo de red real (fetch rechazado, no una respuesta HTTP) encola en `outbox`; un 4xx se muestra como error al mozo de inmediato, igual que hoy online |
| Precio del plato cambia mientras el pedido está en cola offline | Baja (aceptado) | El snapshot optimista es solo visual; el servidor vuelve a snapshotear `nombre`/`precioUnitario` desde `Plato` al procesar el push — la fuente de verdad sigue siendo el servidor |
| RxDB agrega peso al bundle de `apps/operativa` | Baja (aceptado, decisión ya cerrada) | Es la elección primaria del doc de arquitectura §6; queda contenida a `apps/operativa`, no entra a `packages/shared` |

## Rollback Plan

- `git revert` remueve `apps/operativa/src/db/`, revierte `MozoView`/`CocinaView` a `useState`+`fetch`, y el campo `clientRequestId` en API/shared. La migración de `clientRequestId` es additiva y nullable — un down-migration la dropea sin pérdida de datos.

## Dependencies

- Iter 4 (tiempo real) — los mismos eventos de socket alimentan RxDB en vez de `useState`.
- Redis/Postgres ya corren.

## Success Criteria

- [ ] `pnpm --filter api test` verde, con el test de idempotencia de `clientRequestId` RED-first.
- [ ] Con DevTools → Network → Offline activado en Mozo: crear un pedido de barra lo muestra al instante en la lista (optimista), sin error.
- [ ] Al desactivar Offline, el pedido se sincroniza solo (sin recargar la página) y aparece en Cocina.
- [ ] Reintentar el flush dos veces con el mismo `clientRequestId` no crea un pedido duplicado (verificado contra la API).
- [ ] `pnpm build` pasa en modo estricto.
