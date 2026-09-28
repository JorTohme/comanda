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

### Requirement: Offline commands are durable before their local projection

The system MUST persist a tenant-scoped outbox command before writing its optimistic Pedido projection. The command MUST retain the original request payload and client request ID, plus enough validated Pedido data to rebuild the projection. The local Pedido MUST use the current shared contract, including `version: 0` and `cobro: null`, and MUST NOT contain public payment-attempt history. Startup MUST validate and restore pending projections for the active organization and branch before fetching server data. It MUST NOT replace an acknowledged server Pedido with a pending projection that has the same `clientRequestId`.

#### Scenario: The tab closes after saving a command but before the Pedido projection

- GIVEN the durable command is present in the active branch outbox and its optimistic Pedido row is absent
- WHEN the Mozo view starts again for the same organization and branch
- THEN it MUST rebuild the optimistic Pedido from the stored command before fetching server data

#### Scenario: Legacy outbox data cannot prove its branch

- GIVEN an old outbox record is missing complete organization and branch proof, or its associated optimistic Pedido does not match both tenant IDs
- WHEN the current schema migrates or startup examines that record
- THEN it MUST preserve the original raw data in quarantine and MUST NOT assign the currently selected branch or delete the old store

#### Scenario: Legacy data can be exported without destructive migration

- GIVEN a supported browser exposes an old global or organization-keyed database, or the exact historical database name can be probed safely
- WHEN the user exports legacy local data
- THEN the system MUST download a read-only raw JSON snapshot and MUST leave the source database unchanged

**Verification status:** Jest tests exercise write ordering, optimistic reconstruction, tenant-scoped counting, proof-gated migration, and raw quarantine using in-memory doubles. Browser IndexedDB persistence, migration behavior, cold reload, and multi-tab behavior remain pending Plan04 and are not claimed as verified here.

### Requirement: Queued Pedidos retry without losing commands

The system MUST serialize delivery by organization and branch with Web Locks where available, and MUST coalesce same-key requests within a tab. Without Web Locks, delivery is serialized only within the current tab; idempotency MUST still use the same `clientRequestId` and immutable input. Before and after each POST, the system MUST verify the active session generation, user, organization and branch. A changed session or tenant, request cancellation, or timeout MUST NOT delete the outbox command or its optimistic Pedido.

Transient network failures, request timeouts, HTTP 408/429, and HTTP 5xx MUST remain pending with bounded exponential backoff. A valid `Retry-After` value MUST be treated as a minimum delay. HTTP 400/403/404/409/422 and malformed successful responses MUST be marked failed for recovery while retaining the command and projection. HTTP 401 MUST suspend automatic delivery until a valid session notification. The authoritative Pedido MUST pass the shared schema and match the command's `clientRequestId` and tenant; it MUST be stored locally before the optimistic projection and command are removed. Any local write failure MUST retain the outbox command.

Startup, `online`, `focus`, visible-tab transitions, socket reconnects, and a five-second foreground timer MUST check due commands. Cleanup MUST remove listeners and timers and abort outstanding requests. The foreground timer MUST respect `retryAt` and MUST NOT bypass server retry delays.

#### Scenario: A transient response preserves identity and backs off

- GIVEN a queued Pedido and the server returns HTTP 503 or 429
- WHEN delivery is attempted
- THEN the command and optimistic Pedido MUST remain, its attempt and next retry time MUST be updated, and the next POST MUST reuse the same input and `clientRequestId`

#### Scenario: The server rejects the command permanently

- GIVEN a queued Pedido and the server returns HTTP 400, 403, 404, 409, 422, or an invalid successful payload
- WHEN delivery is attempted
- THEN the command MUST be marked failed and remain available with its optimistic Pedido for recovery; it MUST NOT be silently deleted or automatically retried

#### Scenario: The active session or branch changes during delivery

- GIVEN a POST is in flight for one branch
- WHEN its session generation or user/tenant changes before the response is applied
- THEN the late response MUST NOT mutate local data and the command MUST remain pending

#### Scenario: Local persistence fails after server success

- GIVEN the server returns a valid authoritative Pedido
- WHEN storing that Pedido or removing its optimistic projection fails
- THEN the outbox command MUST remain so a later idempotent attempt can recover the authoritative row

**Verification status:** Jest tests cover HTTP classification, timeout/abort, identity retention, tenant/generation cancellation, lock/singleflight coordination, local-write failure, and trigger cleanup. Real multi-tab Web Locks, browser IndexedDB, and end-to-end socket reconnection remain pending Plan04.

### Requirement: Mozo can recover pending and failed Pedido commands

The Mozo view MUST derive local delivery status from the tenant-scoped outbox, including commands whose optimistic projection could not be written. It MUST render such a command without duplicating a Pedido row when a projection exists. Pending commands MUST be visibly identified; failed commands MUST show their recovery reason and offer accessible retry and discard actions. Retrying a failed command MUST preserve its immutable input and `clientRequestId`, changing only delivery status and retry/error metadata. Discard MUST require confirmation and serialize with delivery using the tenant-scoped outbox lock where available and an in-tab queue; it MUST recheck the command and authoritative Pedido before removing only that command and its matching optimistic local projection. It MUST NOT delete an authoritative Pedido, including one persisted with the same `clientRequestId`. Without Web Locks, only same-tab coordination is guaranteed. Legacy quarantine/export remains a separate recovery path and MUST NOT be silently discarded by these actions.

The Cocina view MUST display and advance only acknowledged server Pedidos. An optimistic Pedido whose local ID is also its `clientRequestId`, or which has no authoritative server version, MUST NOT appear as a kitchen order or reach a state-update endpoint.

#### Scenario: A failed command is retried without changing identity

- GIVEN a failed command for the active organization and branch
- WHEN the Mozo chooses to retry it
- THEN it MUST return to pending delivery with the original request body and `clientRequestId`

#### Scenario: A command remains recoverable when projection persistence fails

- GIVEN a durable outbox command exists but its optimistic Pedido row is absent
- WHEN the Mozo view renders the active branch
- THEN the command MUST remain visible with available recovery actions
- AND it MUST NOT be duplicated when a matching Pedido projection exists

#### Scenario: A command is discarded after confirmation

- GIVEN a pending or failed optimistic Pedido for the active tenant
- WHEN the Mozo confirms discard
- THEN only its outbox command and matching optimistic projection MUST be removed
- AND any authoritative server Pedido MUST remain untouched

#### Scenario: Cocina ignores a local optimistic Pedido

- GIVEN an outbox-backed Pedido with a local optimistic ID
- WHEN the Cocina view renders or advances kitchen orders
- THEN that Pedido MUST NOT be displayed, counted as a kitchen order, or sent to a state endpoint

**Verification status:** Jest tests cover tenant-scoped retry/discard behavior, immutable identity, and protection of authoritative Pedido rows. DOM and interaction assertions remain pending Plan04 browser verification.
