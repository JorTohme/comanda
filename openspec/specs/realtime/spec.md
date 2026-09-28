# Realtime Specification

## Purpose

Gateway Socket.io con adapter Redis para propagar invalidaciones y snapshots CRUD a clientes conectados de la misma sucursal. Los datos persistidos siguen siendo la autoridad: perder un evento nunca revierte ni falla una escritura confirmada.

## ADDED Requirements

### Requirement: Autenticación del socket por JWT

El sistema MUST exigir un JWT válido en `handshake.auth.token` para aceptar una conexión, y MUST desconectar cualquier socket sin token o con un token inválido/expirado, usando el mismo `JwtService.verify` que ya valida HTTP.

#### Scenario: Conexión con JWT válido

- GIVEN un JWT válido emitido por `/auth/login`
- WHEN un cliente conecta el socket con ese token en `handshake.auth.token`
- THEN el sistema MUST aceptar la conexión y unirla a la sala de su `sucursalId`

#### Scenario: Conexión sin token o con token inválido

- GIVEN un socket que conecta sin `handshake.auth.token`, o con un token inválido/expirado
- WHEN el gateway procesa la conexión
- THEN el sistema MUST desconectarlo (`disconnect`) sin unirlo a ninguna sala

### Requirement: Aislamiento por sucursal

El sistema MUST emitir cada evento únicamente a los sockets de la misma sucursal que originó el cambio, usando una sala `sucursal:<id>` derivada del `sucursalId` del JWT.

#### Scenario: Un evento no cruza sucursales

- GIVEN dos sockets conectados con JWTs de sucursales distintas, A y B
- WHEN se emite un evento para la sucursal A
- THEN solo el socket de la sucursal A MUST recibirlo; el socket de B MUST NOT recibirlo

### Requirement: Evento pedido.actualizado

El sistema MUST emitir `pedido.actualizado` con el `Pedido` completo (incluyendo `items`) cada vez que un `Pedido` se crea o cambia de `estado`, después de que la escritura en base de datos se confirma.

#### Scenario: Crear un pedido lo emite

- GIVEN un cliente conectado a la sala de la sucursal
- WHEN se crea un `Pedido` vía `POST /pedidos` en esa sucursal
- THEN el sistema MUST emitir `pedido.creado` con el `Pedido` creado, incluyendo `items`

#### Scenario: Avanzar el estado lo emite

- GIVEN un `Pedido` existente y un cliente conectado a la sala de su sucursal
- WHEN su `estado` avanza vía `PATCH /pedidos/:id/estado`
- THEN el sistema MUST emitir `pedido.actualizado` con el `Pedido` actualizado

### Requirement: Evento mesa.actualizada

El sistema MUST emitir `mesa.creada` con la `Mesa` completa al crearla, y `mesa.actualizada` cada vez que su `estado` cambia — ya sea por `PATCH /mesas/:id` directo o por el driver automático de `pedidos` (ver spec `salon`, requirement "pedido_en_curso has a manual path and an automatic driver").

#### Scenario: Cambio manual de estado lo emite

- GIVEN un cliente conectado a la sala de la sucursal
- WHEN una `Mesa` cambia de `estado` vía `PATCH /mesas/:id`
- THEN el sistema MUST emitir `mesa.actualizada` con la `Mesa` actualizada

#### Scenario: El driver automático de pedidos también lo emite

- GIVEN un cliente conectado a la sala de la sucursal
- WHEN se crea un `Pedido` `tipoServicio=mesa` (o llega a `cerrado`) y esto cambia `Mesa.estado` automáticamente
- THEN el sistema MUST emitir `mesa.actualizada` con la `Mesa` resultante, además de `pedido.actualizado`

### Requirement: Evento plato.actualizado

El sistema MUST emitir `plato.actualizado` con el `Plato` completo cada vez que `PATCH /platos/:id` lo modifica.

#### Scenario: Togglear disponibilidad lo emite

- GIVEN un cliente conectado a la sala de la sucursal
- WHEN un `Plato` cambia su campo `disponible` vía `PATCH /platos/:id`
- THEN el sistema MUST emitir `plato.actualizado` con el `Plato` actualizado

### Requirement: CRUD snapshots and delete envelopes

The system MUST publish `categoria.creada` and `categoria.actualizada` with the canonical Categoria snapshot and `categoria.eliminada` with `{ id, orgId, sucursalId }`; the equivalent Plato events are `plato.creado`, `plato.actualizado`, and `plato.eliminado`, and Mesa events are `mesa.creada`, `mesa.actualizada`, and `mesa.eliminada`. Create/update events carry the canonical shared entity payload. Delete events carry only the entity id and tenant UUIDs. Creation of a Pedido uses `pedido.creado`; later changes use `pedido.actualizado`.

The API MUST constrain event names and payloads against the shared TypeScript event contract at compile time. Runtime Zod validation MUST occur in event receivers (including `apps/operativa` and `apps/web`) before applying payloads. The API's CommonJS Nest process MUST NOT load the shared ESM runtime module solely to validate outbound events.

#### Scenario: Delete publishes a tenant-scoped envelope

- GIVEN an entity is owned by organization O and branch S
- WHEN it is deleted successfully
- THEN its delete event MUST contain only the deleted id and tenant identifiers and MUST be emitted to branch S

### Requirement: Best-effort committed-write publication

Realtime publication MUST be attempted only after persistence commits. Synchronous transport errors MUST be logged and contained at the gateway boundary so an already committed HTTP mutation remains successful. Clients MUST treat events as invalidation/snapshot hints and reload authoritative data from the API.

#### Scenario: Transport failure does not fail a committed mutation

- GIVEN a database write has committed
- WHEN Socket.io/Redis publication throws synchronously
- THEN the gateway MUST log the transport error and the HTTP write MUST still succeed

### Requirement: Client events invalidate tenant-safe views

Operativa and Web realtime receivers MUST validate each payload with `realtimeEventSchemas` before using it and reject events whose `orgId` or `sucursalId` does not match the mounted session. Operativa may apply validated same-tenant CRUD snapshots locally; deletion envelopes remove only the matching tenant record. Web Pedidos and Caja MUST treat relevant events as invalidation hints and refetch complete authorized API views rather than trusting event data as the final state. Async refetches MUST be canceled or ignored after the session generation, user, organization, or branch changes. Socket listeners, timers, and outstanding requests MUST be cleaned up when their owning view is disposed.

Operativa MUST also refresh complete authoritative `mesas`, `platos`, and `pedidos` lists at startup, on socket reconnect, when the page becomes online/visible/focused, and on a bounded foreground interval. A snapshot may prune local server rows only after every list succeeds and every record matches the active tenant. Snapshot fetches stay outside the tenant write lock; applying the snapshot serializes with local enqueue and delivery writes. Events received during fetch invalidate the result and request at most one immediate follow-up.

#### Scenario: A malformed or foreign-tenant event is received

- GIVEN an event payload that fails its shared schema or identifies a different organization or branch
- WHEN a client receiver processes it
- THEN it MUST NOT mutate local state or refetch using that payload

#### Scenario: A Web view receives a valid same-tenant invalidation

- GIVEN a Web view has an active session for organization O and branch S
- WHEN it receives a valid Pedido or Caja event for O and S
- THEN it MUST refetch the relevant API data and ignore any late response after the active session changes

### Requirement: Caja invalidation event

The system MUST emit `caja.actualizada` after successful shift, movement, or receipt mutations. Its payload MUST contain only `{ orgId, sucursalId, turnoId }`, where `turnoId` may be `null`; it MUST NOT contain trusted balance totals. Cash and digital receipt mutations also emit `pedido.actualizado` with the Pedido including its Cobro.

#### Scenario: Receipt changes Caja and Pedido views

- GIVEN a cash or digital receipt is committed
- WHEN clients receive its events
- THEN they MUST receive the updated Pedido snapshot and a Caja invalidation for the applicable shift (or `null` when unassigned)
