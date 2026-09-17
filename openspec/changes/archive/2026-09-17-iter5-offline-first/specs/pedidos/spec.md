# Pedidos Specification (delta)

## ADDED Requirements

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
