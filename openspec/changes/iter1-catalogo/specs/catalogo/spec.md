# Catalogo Specification

## Purpose

Persistence and HTTP contract for `Categoria` and `Plato`: CRUD, availability, price-in-cents, and validation. Out of scope: authentication/authorization, tenancy filtering by `org_id`/`sucursal_id` (columns exist but unused), real-time/socket propagation, takeaway/delivery, payments, floor plan.

## ADDED Requirements

### Requirement: Create Categoria

The system MUST create a Categoria when given a non-empty `nombre` and MUST reject the request otherwise.

#### Scenario: Successful creation

- GIVEN a valid `nombre`
- WHEN a client sends `POST /categorias` with `{ nombre }`
- THEN the system MUST persist a new Categoria and respond 201 with its id and nombre

#### Scenario: Missing nombre rejected

- GIVEN a body without `nombre` or with an empty string
- WHEN `POST /categorias` is called
- THEN the system MUST respond 400 and MUST NOT persist a Categoria

### Requirement: List Categorias

The system MUST return all Categorias.

#### Scenario: List returns all

- GIVEN zero or more Categorias exist
- WHEN a client sends `GET /categorias`
- THEN the system MUST respond 200 with an array of all Categorias

### Requirement: Update Categoria

The system MUST update an existing Categoria's `nombre` by id and MUST respond 404 when the id does not exist.

#### Scenario: Successful update

- GIVEN a Categoria exists with id X
- WHEN a client sends `PATCH /categorias/X` with a new `nombre`
- THEN the system MUST persist the change and respond 200 with the updated Categoria

#### Scenario: Update nonexistent Categoria

- GIVEN no Categoria exists with id Y
- WHEN a client sends `PATCH /categorias/Y`
- THEN the system MUST respond 404 and MUST NOT create a Categoria

### Requirement: Delete Categoria

The system MUST delete an existing Categoria by id and MUST respond 404 when the id does not exist.

#### Scenario: Successful deletion

- GIVEN a Categoria exists with id X
- WHEN a client sends `DELETE /categorias/X`
- THEN the system MUST remove it and respond 200 or 204

#### Scenario: Delete nonexistent Categoria

- GIVEN no Categoria exists with id Y
- WHEN a client sends `DELETE /categorias/Y`
- THEN the system MUST respond 404

### Requirement: Create Plato

The system MUST create a Plato when given a non-empty `nombre`, a positive integer `precio` in centavos, and a `categoriaId` referencing an existing Categoria. `disponible` MUST default to `true` when omitted.

#### Scenario: Successful creation with default disponible

- GIVEN a valid `nombre`, a positive integer `precio`, and an existing `categoriaId`
- WHEN a client sends `POST /platos` without `disponible`
- THEN the system MUST persist the Plato with `disponible=true` and respond 201

#### Scenario: Invalid payload rejected

- GIVEN a body missing `nombre`, or `precio` is not a positive integer, or `categoriaId` does not reference an existing Categoria
- WHEN `POST /platos` is called
- THEN the system MUST respond 400 and MUST NOT persist a Plato

### Requirement: List Platos

The system MUST list all Platos and MAY filter the list by `categoriaId` when passed as a query parameter.

#### Scenario: List all

- GIVEN Platos exist across multiple categorias
- WHEN a client sends `GET /platos` with no query parameters
- THEN the system MUST respond 200 with all Platos

#### Scenario: Filtered list

- GIVEN Platos exist across multiple categorias
- WHEN a client sends `GET /platos?categoriaId=X`
- THEN the system MUST respond 200 with only Platos whose `categoriaId` equals X

### Requirement: Update Plato

The system MUST update an existing Plato's fields, including toggling `disponible`, by id; MUST validate updated fields under the same rules as creation; and MUST respond 404 when the id does not exist.

#### Scenario: Toggle disponible

- GIVEN a Plato exists with `disponible=true`
- WHEN a client sends `PATCH /platos/X` with `disponible=false`
- THEN the system MUST persist `disponible=false` and respond 200

#### Scenario: Update nonexistent Plato

- GIVEN no Plato exists with id Y
- WHEN a client sends `PATCH /platos/Y`
- THEN the system MUST respond 404

#### Scenario: Invalid update rejected

- GIVEN a Plato exists with id X
- WHEN a client sends `PATCH /platos/X` with a non-integer `precio` or a `categoriaId` that does not exist
- THEN the system MUST respond 400 and MUST NOT persist the change

### Requirement: Delete Plato

The system MUST delete an existing Plato by id and MUST respond 404 when the id does not exist.

#### Scenario: Successful deletion

- GIVEN a Plato exists with id X
- WHEN a client sends `DELETE /platos/X`
- THEN the system MUST remove it and respond 200 or 204

#### Scenario: Delete nonexistent Plato

- GIVEN no Plato exists with id Y
- WHEN a client sends `DELETE /platos/Y`
- THEN the system MUST respond 404

### Requirement: Precio as integer centavos

The system MUST represent `precio` as an integer number of centavos in persistence, HTTP payloads, and shared contract types, and MUST NOT accept or emit it as a float or decimal.

#### Scenario: Integer precio round-trips

- GIVEN a Plato created with `precio=1550`
- WHEN a client fetches it via `GET /platos`
- THEN the response MUST contain `precio: 1550` as an integer, not `15.50`

#### Scenario: Non-integer precio rejected

- GIVEN a request body with `precio: 15.5`
- WHEN `POST /platos` or `PATCH /platos/:id` is called
- THEN the system MUST respond 400
