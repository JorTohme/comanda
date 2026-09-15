# Salon-Admin Specification

## Purpose

Admin screen behavior in `apps/web` (`/salon`) for managing Mesa against the `salon` HTTP API: listing as a color-coded grid, creating, editing, deleting, cycling occupancy state, and surfacing API errors. Out of scope: authentication/authorization, tenancy, real-time updates, spatial/plano layout (canvas, coordinates, drag-and-drop), mozo-facing toggle in `apps/operativa`.

## ADDED Requirements

### Requirement: Grid display of Mesas

The admin screen MUST display all Mesas as a CSS-grid of clickable cards, not a table, with each card showing `nombre`, `capacidad`, and a background color determined by `estado`.

#### Scenario: Initial load

- GIVEN the salon API has existing Mesas across all three `estado` values
- WHEN the admin navigates to `/salon`
- THEN the screen MUST render a CSS-grid of mesa cards, each colored according to its `estado`

### Requirement: Create Mesa

The admin screen MUST provide a form to create a Mesa, MUST submit it to the salon API, and MUST reflect the new Mesa as a grid card on success.

#### Scenario: Create Mesa

- GIVEN the admin fills the Mesa form with a `nombre` and `capacidad`
- WHEN the admin submits the form
- THEN the screen MUST call the create-Mesa endpoint and, on success, MUST show the new Mesa as a card in the grid

### Requirement: Edit Mesa

The admin screen MUST allow editing an existing Mesa's `nombre` and `capacidad` via a form, and MUST submit the changes to the salon API.

#### Scenario: Edit Mesa fields

- GIVEN a Mesa is displayed as a grid card
- WHEN the admin edits its `nombre` or `capacidad` and submits
- THEN the screen MUST call the update-Mesa endpoint and MUST reflect the updated values on the card on success

### Requirement: Delete Mesa

The admin screen MUST allow deleting an existing Mesa and MUST remove its card from the grid on success.

#### Scenario: Delete Mesa

- GIVEN a Mesa is displayed as a grid card
- WHEN the admin confirms deletion
- THEN the screen MUST call the delete-Mesa endpoint and MUST remove the card from the grid on success

### Requirement: Cycle occupancy state by clicking a card

The admin screen MUST change a Mesa's `estado` when its card is clicked, cycling through the three states (`libre` / `ocupada` / `pedido_en_curso`), and MUST submit the new state to the salon API via PATCH.

#### Scenario: Click cycles to next state

- GIVEN a Mesa card is displayed with `estado=libre`
- WHEN the admin clicks the card
- THEN the screen MUST call the update-Mesa endpoint with the next `estado` in the cycle and MUST update the card's color to match on success

#### Scenario: Manually asserting pedido_en_curso

- GIVEN a Mesa card is displayed with `estado=ocupada`
- WHEN the admin clicks the card to advance it to `pedido_en_curso`
- THEN the screen MUST call the update-Mesa endpoint with `estado: "pedido_en_curso"` without requiring any order to exist, since this state is operator-asserted this iteration

### Requirement: Surface API errors

The admin screen MUST display a visible error message whenever a create, update, or delete request to the salon API fails, and MUST NOT silently discard the failure.

#### Scenario: Failed creation shows error

- GIVEN the admin submits a Mesa create form with invalid data
- WHEN the salon API responds 400
- THEN the screen MUST display an error message and MUST NOT show the invalid Mesa as created

#### Scenario: Failed state cycle shows error

- GIVEN the admin clicks a Mesa card to cycle its `estado`
- WHEN the salon API request fails
- THEN the screen MUST display an error message and MUST NOT reflect the new state on the card
