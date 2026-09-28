# Pedidos-Admin Specification

## Purpose

Admin screen behavior in `apps/web` (`/pedidos`) for creating Pedidos, adding items from the Plato catalog, advancing their versioned `estado`, and listing the order/receipt contract from the `pedidos` HTTP API. Cash collection remains an explicit caja operation, not a generic state change.

## Requirements

### Requirement: Create Pedido with items

The admin screen MUST provide a form to select `tipoServicio`, optionally a `Mesa` (required only when `tipoServicio=mesa`), and one or more items from the Plato list, and MUST submit it to the pedidos API.

#### Scenario: Create a mesa Pedido

- GIVEN the admin selects `tipoServicio=mesa`, a Mesa, and adds one item from the Plato list
- WHEN the admin submits the form
- THEN the screen MUST call the create-Pedido endpoint with the selected Mesa and items, and on success MUST show the new Pedido in the list

#### Scenario: Mesa selector hidden for barra

- GIVEN the admin selects `tipoServicio=barra`
- WHEN the form is rendered
- THEN the screen MUST NOT require or submit a `mesaId`

### Requirement: List Pedidos

The admin screen MUST display all Pedidos with their `tipoServicio`, items, and current `estado`.

#### Scenario: Initial load

- GIVEN the pedidos API has existing Pedidos in various `estado` values
- WHEN the admin navigates to `/pedidos`
- THEN the screen MUST render each Pedido with its items and current `estado`

### Requirement: Advance Pedido state respecting linear order

The admin screen MUST allow advancing a Pedido's `estado` only to the next state in the linear sequence and MUST NOT offer a control that would skip a state.

#### Scenario: Advance to next state

- GIVEN a Pedido is displayed with `estado=abierto`
- WHEN the admin triggers the advance action
- THEN the screen MUST call the update endpoint with `estado=enviado_a_cocina` and reflect it on success

#### Scenario: No skip control offered

- GIVEN a Pedido is displayed with `estado=abierto`
- WHEN the admin views available actions
- THEN the screen MUST NOT present an option to set `estado` to anything other than `enviado_a_cocina`

### Requirement: State advance uses the displayed version and excludes cash collection

Every state advance MUST submit the version currently displayed by the screen as `expectedVersion`. The admin order screen MUST NOT offer generic `cobrado`; stale-version conflicts MUST preserve the current server state and prompt the user to refresh/retry from current data. Order representations MUST retain `version` and `cobro` when loaded and after mutations.

#### Scenario: Versioned transition

- GIVEN a Pedido is displayed at version 4
- WHEN the admin advances its state
- THEN the screen MUST submit `expectedVersion: 4` and use the returned current Pedido on success

#### Scenario: Stale version is not presented as a successful update

- GIVEN another actor has already advanced the Pedido
- WHEN the admin submits an outdated version and receives 409
- THEN the screen MUST keep the server-confirmed state and show a refreshable conflict error

#### Scenario: Cash collection is not a state action

- GIVEN a Pedido is listed in the admin screen
- WHEN available state actions are rendered
- THEN `cobrado` MUST NOT be offered as a manual state transition

### Requirement: Surface API errors

The admin screen MUST display a visible error message whenever a create or state-advance request to the pedidos API fails, and MUST NOT silently discard the failure.

#### Scenario: Failed creation shows error

- GIVEN the admin submits a Pedido create form with invalid data
- WHEN the pedidos API responds 400
- THEN the screen MUST display an error message and MUST NOT show the invalid Pedido as created

#### Scenario: Failed state advance shows error

- GIVEN the admin triggers the advance action on a Pedido
- WHEN the pedidos API request fails
- THEN the screen MUST display an error message and MUST NOT reflect the new state
