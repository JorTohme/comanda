# Operativa Offline Specification

## Purpose

Offline-first data layer for `apps/operativa` (Mozo/Cocina): a local RxDB store that survives a dropped connection while the tab stays open, and an outbox that queues Pedido creation for the Mozo role until connectivity returns. This spec also records the shared browser-session contract used by both `operativa` and `web`; their business data remains scoped to each application. Out of scope: Service Worker / cold-reload-without-network and offline writes for anything other than Pedido creation.

## ADDED Requirements

### Requirement: Frontends use one canonical browser session

The system MUST use the shared validated `AuthSession` stored under `comanda.session` as the sole browser authentication source for `apps/web` and `apps/operativa`. Login, invitation acceptance, branch switching, refresh, and logout MUST use the shared session APIs; frontend components MUST NOT independently persist access token, refresh token, or user fields.

#### Scenario: Existing legacy session is migrated

- GIVEN `comanda.session` is absent and all three legacy keys (`comanda.accessToken`, `comanda.refreshToken`, and `comanda.user`) contain a valid session
- WHEN the shared session store is read
- THEN it MUST validate the complete session, persist `comanda.session`, and only then remove the legacy keys

#### Scenario: Legacy data is incomplete or invalid

- GIVEN `comanda.session` is absent and one or more legacy keys are missing or invalid
- WHEN the shared session store is read
- THEN it MUST NOT treat that data as an authenticated session

#### Scenario: Canonical session key exists

- GIVEN `comanda.session` exists
- WHEN the shared session store is read
- THEN it MUST use that key as the source of truth and MUST NOT fall back to the legacy keys

### Requirement: Refresh attempts coordinate through the shared session store

The system MUST share an in-flight refresh promise within a tab for the same API origin and refresh identity. Where the browser supports Web Locks, refresh attempts across tabs MUST use the origin-scoped `comanda.session.refresh` lock and reread the session inside the lock before sending a refresh request. Without Web Locks, only in-tab singleflight coordination is guaranteed. Transient network or server failures MUST preserve the current session; a confirmed invalid-session response MUST clear it. A late callback MUST NOT restore a session after logout or write under a different user, organization, or branch.

#### Scenario: Concurrent requests need a refresh in one tab

- GIVEN several API requests receive an unauthorized response for the same browser session
- WHEN they request session refresh concurrently in the same tab
- THEN they MUST reuse one in-flight refresh and the replacement session MUST be stored once

#### Scenario: A supported browser has another tab refresh first

- GIVEN two same-origin tabs share the same refresh token and Web Locks are available
- WHEN one tab completes token rotation before the other acquires the lock
- THEN the second tab MUST reread the shared session and use the newer session instead of submitting the consumed refresh token

#### Scenario: Refresh fails transiently

- GIVEN a valid stored session and a temporary network or server failure during refresh
- WHEN the refresh attempt fails
- THEN the stored session MUST remain available for a later retry

### Requirement: Realtime uses the current session credentials

The system MUST provide Socket.IO authentication from the current shared session at each connection or reconnection handshake, rather than reusing a token captured when a view first mounted. The owning frontend view MUST disconnect its socket when that view's session is cleared or its user/organization/branch changes. The server gateway MUST reject tokens with a missing or expired `exp` and MUST disconnect an authenticated socket when its access token expires, clearing the expiry timer if the socket disconnects first. Role-based UI visibility is a convenience only: the backend remains the authority for authentication and authorization.

#### Scenario: A socket reconnects after the session token changes

- GIVEN a connected view's session has been refreshed without changing its user, organization, or branch
- WHEN its socket performs a later connection or reconnection handshake
- THEN the handshake MUST use credentials read from the latest shared session

#### Scenario: Logout or tenant change occurs while a view is mounted

- GIVEN a realtime view owns a connected socket
- WHEN the shared session is cleared or changes user, organization, or branch
- THEN that view MUST disconnect the socket and MUST NOT continue using the previous tenant connection

#### Scenario: A connected socket reaches token expiry

- GIVEN the gateway verified a token with a valid future `exp` claim
- WHEN that token expires while the socket is connected
- THEN the gateway MUST disconnect the socket
- AND if the socket disconnects before expiry, the gateway MUST clear its scheduled expiry timer

**Verification status:** Gateway expiry enforcement is implemented and covered by API unit tests. Browser-level multi-tab behavior remains pending and is not claimed as verified here.

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
