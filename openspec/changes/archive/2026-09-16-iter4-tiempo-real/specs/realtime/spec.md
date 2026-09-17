# Realtime Specification

## Purpose

Gateway Socket.io con adapter Redis para propagar cambios de `Pedido`, `Mesa` y `Plato` en tiempo real a los clientes conectados de la misma sucursal, reemplazando el polling de `apps/operativa`. Fuera de alcance: revocación de socket en expiración de JWT, eventos granulares por transición, `apps/web` `/caja`.

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
- THEN el sistema MUST emitir `pedido.actualizado` con el `Pedido` creado, incluyendo `items`

#### Scenario: Avanzar el estado lo emite

- GIVEN un `Pedido` existente y un cliente conectado a la sala de su sucursal
- WHEN su `estado` avanza vía `PATCH /pedidos/:id/estado`
- THEN el sistema MUST emitir `pedido.actualizado` con el `Pedido` actualizado

### Requirement: Evento mesa.actualizada

El sistema MUST emitir `mesa.actualizada` con la `Mesa` completa cada vez que su `estado` cambia — ya sea por `PATCH /mesas/:id` directo o por el driver automático de `pedidos` (ver spec `salon`, requirement "pedido_en_curso has a manual path and an automatic driver") — y también al crearse una `Mesa`.

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
