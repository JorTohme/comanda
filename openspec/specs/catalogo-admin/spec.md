# Catalogo-Admin Specification

## Purpose

Admin screen behavior in `apps/web` (`/catalogo`) for managing Categoria and Plato against the `catalogo` HTTP API: listing, creating, editing, deleting, toggling availability, and surfacing API errors. Out of scope: authentication/authorization, tenancy, real-time updates, takeaway/delivery, payments, floor plan.

## ADDED Requirements

### Requirement: List Categorias and Platos

The admin screen MUST display all Categorias and all Platos, including each Plato's `nombre`, `precio`, `disponible` state, and associated Categoria.

#### Scenario: Initial load

- GIVEN the catalogo API has existing Categorias and Platos
- WHEN the admin navigates to `/catalogo`
- THEN the screen MUST render a table of Categorias and a table of Platos with their fields

### Requirement: Create Categoria and Plato

The admin screen MUST provide forms to create a Categoria and a Plato, MUST submit them to the catalogo API, and MUST reflect the new record in the list on success.

#### Scenario: Create Categoria

- GIVEN the admin fills the Categoria form with a `nombre`
- WHEN the admin submits the form
- THEN the screen MUST call the create-Categoria endpoint and, on success, MUST show the new Categoria in the list

#### Scenario: Create Plato

- GIVEN the admin fills the Plato form with `nombre`, `precio`, and a categoria
- WHEN the admin submits the form
- THEN the screen MUST call the create-Plato endpoint and, on success, MUST show the new Plato in the list

### Requirement: Edit Categoria and Plato

The admin screen MUST allow editing an existing Categoria's `nombre` and an existing Plato's fields, and MUST submit the changes to the catalogo API.

#### Scenario: Edit Plato fields

- GIVEN a Plato is displayed
- WHEN the admin edits its `nombre` or `precio` and submits
- THEN the screen MUST call the update-Plato endpoint and MUST reflect the updated values on success

### Requirement: Delete Categoria and Plato

The admin screen MUST allow deleting an existing Categoria or Plato and MUST remove it from the displayed list on success.

#### Scenario: Delete Plato

- GIVEN a Plato is displayed
- WHEN the admin confirms deletion
- THEN the screen MUST call the delete-Plato endpoint and MUST remove the Plato from the list on success

### Requirement: Toggle disponible inline

The admin screen MUST allow toggling a Plato's `disponible` state directly from the list, without opening a separate edit form.

#### Scenario: Inline toggle

- GIVEN a Plato is listed with `disponible=true`
- WHEN the admin activates the inline toggle for that Plato
- THEN the screen MUST call the update-Plato endpoint with `disponible=false` and MUST reflect the new state in the list on success

### Requirement: Surface API errors

The admin screen MUST display a visible error message whenever a create, update, or delete request to the catalogo API fails, and MUST NOT silently discard the failure.

#### Scenario: Failed creation shows error

- GIVEN the admin submits a Plato create form with invalid data
- WHEN the catalogo API responds 400
- THEN the screen MUST display an error message and MUST NOT show the invalid Plato as created

#### Scenario: Failed toggle shows error

- GIVEN the admin toggles `disponible` on a Plato
- WHEN the catalogo API request fails
- THEN the screen MUST display an error message and MUST NOT reflect the toggle as applied

### Requirement: Integer centavos in the admin UI

The admin screen MUST treat `precio` as an integer number of centavos end-to-end and MUST NOT coerce it to a float or decimal representation when submitting, displaying, or editing it.

#### Scenario: Precio stays an integer

- GIVEN the admin enters a `precio` value in the Plato form
- WHEN the form is submitted and the Plato is later displayed
- THEN the value sent to the API and shown in the list MUST be the same integer number of centavos, not a floating-point conversion
