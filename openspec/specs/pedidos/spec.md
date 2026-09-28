# Pedidos Specification

## Purpose

Persistence and HTTP contract for tenant-scoped orders: validated creation with price/name snapshots and idempotency, serialized Mesa/catalog mutations, optimistic state transitions, receipt-aware closure, and post-commit realtime notifications. Service actor authorization and tenant isolation are enforced at the API boundary as well as by HTTP guards.

## Requirements

### Requirement: Create Pedido with items

The system MUST create a `Pedido` given a `tipoServicio` (`mesa` or `barra`) and one or more items (`platoId` + `cantidad`), and MUST default `estado` to `abierto`. Each created `ItemPedido` MUST snapshot `nombre` and `precioUnitario` from the referenced `Plato` at creation time.

#### Scenario: Successful creation with snapshot

- GIVEN a valid `Plato` with `precio=1500`
- WHEN a client sends `POST /pedidos` with `tipoServicio=barra` and one item referencing that `Plato`
- THEN the system MUST persist the Pedido with `estado=abierto` and the item's `precioUnitario=1500`, `nombre` copied from the Plato, and respond 201

#### Scenario: Price change does not affect existing items

- GIVEN a Pedido was created with an item snapshotting `precioUnitario=1500`
- WHEN the referenced `Plato.precio` is later updated to `2000`
- THEN the existing `ItemPedido.precioUnitario` MUST remain `1500`

#### Scenario: Invalid payload rejected

- GIVEN a body with no items, an unknown field, or a non-positive `cantidad`
- WHEN `POST /pedidos` is called
- THEN the system MUST respond 400 and MUST NOT persist a Pedido

### Requirement: tipoServicio determines mesaId requirement

The system MUST require a valid `mesaId` (existing `Mesa`) when `tipoServicio=mesa`, and MUST reject a `mesaId` when `tipoServicio=barra`.

#### Scenario: mesa requires valid mesaId

- GIVEN an existing `Mesa` with id X
- WHEN a client sends `POST /pedidos` with `tipoServicio=mesa` and `mesaId=X`
- THEN the system MUST persist the Pedido linked to Mesa X and respond 201

#### Scenario: mesa with nonexistent mesaId rejected

- GIVEN no `Mesa` exists with id Y
- WHEN a client sends `POST /pedidos` with `tipoServicio=mesa` and `mesaId=Y`
- THEN the system MUST respond 400 and MUST NOT persist a Pedido

#### Scenario: mesa without mesaId rejected

- WHEN a client sends `POST /pedidos` with `tipoServicio=mesa` and no `mesaId`
- THEN the system MUST respond 400 and MUST NOT persist a Pedido

#### Scenario: barra with mesaId rejected

- WHEN a client sends `POST /pedidos` with `tipoServicio=barra` and a non-null `mesaId`
- THEN the system MUST respond 400 and MUST NOT persist a Pedido

### Requirement: platoId FK validation

The system MUST reject item references to a nonexistent `Plato`.

#### Scenario: Nonexistent platoId rejected

- GIVEN no `Plato` exists with id Z
- WHEN a client sends `POST /pedidos` with an item referencing `platoId=Z`
- THEN the system MUST respond 400 and MUST NOT persist a Pedido

### Requirement: Linear EstadoPedido transitions

The system MUST enforce `EstadoPedido` as a strictly linear sequence: `abierto → enviado_a_cocina → en_preparacion → listo → entregado → cobrado → cerrado`. A transition MUST only move to the next state in that sequence; skipping or reversing MUST be rejected.

#### Scenario: Legal transition accepted

- GIVEN a Pedido exists with `estado=abierto`
- WHEN a client sends `PATCH /pedidos/X/estado` with `estado=enviado_a_cocina`
- THEN the system MUST persist the transition and respond 200

#### Scenario: Illegal skip rejected

- GIVEN a Pedido exists with `estado=abierto`
- WHEN a client sends `PATCH /pedidos/X/estado` with `estado=listo`
- THEN the system MUST respond 400 and MUST NOT persist the transition

#### Scenario: Illegal reverse rejected

- GIVEN a Pedido exists with `estado=en_preparacion`
- WHEN a client sends `PATCH /pedidos/X/estado` with `estado=abierto`
- THEN the system MUST respond 400 and MUST NOT persist the transition

#### Scenario: Transition on nonexistent Pedido

- GIVEN no Pedido exists with id Y
- WHEN a client sends `PATCH /pedidos/Y/estado`
- THEN the system MUST respond 404

### Requirement: Mesa coupling on Pedido lifecycle

When a Pedido with `tipoServicio=mesa` is created, the system MUST set the linked `Mesa.estado` to `pedido_en_curso`. When that Pedido reaches `estado=cerrado`, the system MUST set the linked `Mesa.estado` back to `libre`. Both the Pedido write and the Mesa write MUST occur atomically: if either fails, neither MUST be persisted.

#### Scenario: Creating a mesa Pedido sets Mesa to pedido_en_curso

- GIVEN a Mesa exists with id X and `estado=libre`
- WHEN a client sends `POST /pedidos` with `tipoServicio=mesa` and `mesaId=X`
- THEN the system MUST persist the Pedido and MUST set Mesa X's `estado` to `pedido_en_curso`

#### Scenario: Closing a mesa Pedido frees the Mesa

- GIVEN a Pedido linked to Mesa X is at `estado=cobrado`
- WHEN a client sends `PATCH /pedidos/X/estado` with `estado=cerrado`
- THEN the system MUST persist `estado=cerrado` and MUST set Mesa X's `estado` back to `libre`

#### Scenario: barra Pedido never touches Mesa.estado

- WHEN a client creates or transitions a Pedido with `tipoServicio=barra`
- THEN the system MUST NOT modify any `Mesa.estado`

### Requirement: List and get Pedido

The system MUST list all Pedidos with their items and current `estado`, and MUST return 404 when getting a nonexistent Pedido by id.

#### Scenario: List returns all with items

- GIVEN one or more Pedidos exist
- WHEN a client sends `GET /pedidos`
- THEN the system MUST respond 200 with an array including each Pedido's items and `estado`

#### Scenario: Get nonexistent Pedido

- GIVEN no Pedido exists with id Y
- WHEN a client sends `GET /pedidos/Y`
- THEN the system MUST respond 404

### Requirement: Idempotent creation preserves the original order snapshot

The system MUST serialize order mutations on the tenant's Sucursal row. A supplied `clientRequestId` is scoped by organization and branch, and a canonical fingerprint of normalized service/destination/items MUST match before replay returns the original order. Historical keys without a fingerprint MUST conflict rather than be guessed. Creation MUST snapshot currently available tenant-owned dishes and their current names/prices in the same transaction as Pedido and Mesa writes. Dish quantities MUST be integers from 1 through 999, at most 100 input lines are accepted, combined quantity per dish MUST NOT exceed 999, and the computed order total MUST be positive and within the supported integer range. A table MUST NOT have two active orders.

#### Scenario: Equivalent retry returns original snapshot

- GIVEN a Pedido created with a `clientRequestId` and dish snapshot
- WHEN the same normalized payload is retried in the same organization and branch
- THEN the API MUST return the original Pedido and item snapshots without another write or event

#### Scenario: Conflicting or historical key is rejected

- GIVEN the key belongs to a different payload, or the historical Pedido has no fingerprint
- WHEN the key is reused
- THEN the API MUST return 409 and MUST NOT overwrite or infer the existing request

#### Scenario: Concurrent table orders are serialized

- GIVEN no active Pedido exists for a Mesa
- WHEN concurrent create requests use different idempotency keys for that Mesa
- THEN at most one transaction MUST create an active Pedido

#### Scenario: Unavailable/foreign dish or invalid total is rejected

- GIVEN a dish is unavailable or does not belong to the current tenant, or the total is invalid
- WHEN a Pedido is created
- THEN the API MUST reject the request without persisting the Pedido, item snapshots, or Mesa state

### Requirement: Actor and tenant boundaries apply to service calls

The service MUST independently require the actor to belong to the supplied organization and branch. Only admin, caja, and mozo actors may create orders; transition actions MUST follow the role/action policy. Generic browser state mutation MUST NOT set `cobrado`; cash collection is an explicit receipt operation.

#### Scenario: Unauthorized actor or mismatched tenant is rejected

- GIVEN the actor lacks permission for create/action or belongs to another organization/branch
- WHEN the service is invoked directly
- THEN it MUST reject before persisting a change

### Requirement: State transitions use optimistic concurrency and receipt evidence

Every transition request MUST include a non-negative `expectedVersion`. The service MUST validate tenant ownership, compare that version, validate the legal next state and actor action, and atomically update using ID, organization, branch, and expected version while incrementing version. A stale version MUST return 409. An order MUST NOT close unless a `Cobro` with a proven `cobradoEn` timestamp exists. Reaching `entregado` when a live receipt already exists MUST result in `cobrado`. Every API order representation MUST include `items`, current `version`, and `cobro`.

#### Scenario: Stale transition loses compare-and-swap

- GIVEN two clients read the same Pedido version
- WHEN both submit a transition using that version
- THEN only one may commit and the other MUST receive 409

#### Scenario: Close requires proven receipt

- GIVEN an order has no receipt timestamp
- WHEN close is requested
- THEN the API MUST reject it and preserve the order and Mesa state

#### Scenario: Live receipt updates delivery state

- GIVEN an order has a proven receipt timestamp
- WHEN it reaches `entregado`
- THEN its persisted state MUST be `cobrado`, with Cobro returned in the response

### Requirement: Critical mutations and notifications are atomic and ordered

Pedido create/transition, Mesa writes that can conflict with active orders, and Plato create/update/delete mutations that affect order creation MUST acquire the tenant's Sucursal lock before reading dependent state and persist all related changes in one transaction. Realtime notifications MUST be published only after commit; a notification failure MUST be logged and MUST NOT convert a committed mutation into an API failure.

#### Scenario: Database failure rolls back coupled writes

- GIVEN a Pedido transition or creation requires a Mesa change
- WHEN either write fails
- THEN neither write MUST commit

#### Scenario: Notification failure does not undo a committed mutation

- GIVEN the database transaction commits
- WHEN the realtime publisher throws
- THEN the API MUST return the committed result and log the publication failure
### Requirement: Create Pedido is idempotent via clientRequestId

The system MUST accept an optional `clientRequestId` on `POST /pedidos`. When a `Pedido` already exists for that `clientRequestId` within the same tenant, the system MUST return that existing `Pedido` (200/201, same shape as a fresh creation) instead of creating a new one, and MUST NOT trigger the `Mesa` side effect or re-emit the `pedido.actualizado`/`mesa.actualizada` realtime events for that replay.

(Previously: `POST /pedidos` had no idempotency key; every call created a new `Pedido`. Iter 5 adds `clientRequestId` to support retrying a creation that was queued offline without producing duplicates.)

#### Scenario: First request with a clientRequestId creates normally

- GIVEN no `Pedido` exists with `clientRequestId="req-1"` in this tenant
- WHEN a client sends `POST /pedidos` with `clientRequestId: "req-1"` and a valid payload
- THEN the system MUST create the `Pedido` exactly as it would without `clientRequestId`, persisting `clientRequestId="req-1"`

#### Scenario: Replaying the same clientRequestId does not duplicate

- GIVEN a `Pedido` already exists with `clientRequestId="req-1"` in this tenant
- WHEN a client sends `POST /pedidos` again with the same `clientRequestId="req-1"` and payload
- THEN the system MUST respond with the existing `Pedido`, MUST NOT create a second `Pedido`, and MUST NOT change `Mesa.estado` again

#### Scenario: No clientRequestId behaves exactly as before

- GIVEN a client sends `POST /pedidos` without a `clientRequestId`
- WHEN the request is otherwise valid
- THEN the system MUST create a new `Pedido`, exactly as it did before this change
