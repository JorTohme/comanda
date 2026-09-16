# Pedidos-Admin Specification

## Purpose

Admin screen behavior in `apps/web` (`/pedidos`) for creating Pedidos, adding items from the Plato catalog, advancing their `estado`, and listing them against the `pedidos` HTTP API. Out of scope: authentication/authorization, tenancy, real-time updates, mozo-facing UI in `apps/operativa`, payment/caja flows.

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
