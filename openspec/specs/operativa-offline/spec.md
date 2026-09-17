# Operativa Offline Specification

## Purpose

Offline-first data layer for `apps/operativa` (Mozo/Cocina): a local RxDB store that survives a dropped connection while the tab stays open, and an outbox that queues Pedido creation for the Mozo role until connectivity returns. Out of scope: Service Worker / cold-reload-without-network, offline writes for anything other than Pedido creation, `apps/web`.

## ADDED Requirements

### Requirement: Reads survive a dropped connection

The system MUST keep showing the last known `mesas`, `platos`, and `pedidos` state in `apps/operativa` when the network drops while the tab is already open, sourced from the local RxDB store rather than requiring a live request.

#### Scenario: Network drops mid-session

- GIVEN `apps/operativa` has successfully loaded mesas, platos, and pedidos at least once in this tab
- WHEN the network becomes unavailable
- THEN the system MUST continue rendering that data from the local store without an error state

### Requirement: Creating a Pedido works offline

The system MUST allow a Mozo to create a Pedido (mesa or barra) while offline. The Pedido MUST appear immediately in the Mozo's local list (optimistic), and MUST be queued for delivery to the server.

#### Scenario: Mozo creates a Pedido with no network

- GIVEN the Mozo's device has no network connectivity
- WHEN the Mozo submits a new Pedido
- THEN the system MUST insert it into the local store immediately and MUST NOT show an error, and MUST queue it in the outbox for later delivery

### Requirement: Queued Pedidos sync automatically on reconnect

The system MUST attempt to deliver every queued Pedido to `POST /pedidos` when the browser regains connectivity, without requiring a manual retry or a page reload.

#### Scenario: Connectivity returns

- GIVEN one or more Pedidos are queued in the outbox
- WHEN the browser's `online` event fires
- THEN the system MUST send each queued Pedido to the server, and on success MUST replace the optimistic local record with the server's response (same `clientRequestId`, matched and reconciled — no duplicate entry)

### Requirement: A real validation error does not stay queued

The system MUST distinguish a network failure (no response reached the server) from an HTTP error response. A network failure MUST stay queued for retry; an HTTP error response MUST be surfaced to the Mozo immediately and MUST NOT be retried automatically.

#### Scenario: Server rejects the payload

- GIVEN the device has network connectivity
- WHEN a queued (or newly submitted) Pedido is sent and the server responds with an HTTP error (e.g. 400)
- THEN the system MUST show that error to the Mozo and MUST NOT keep retrying that same request automatically
