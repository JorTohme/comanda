# Salon Specification

## Purpose

Persistence and HTTP contract for `Mesa`: CRUD, `capacidad`, three-state occupancy (`libre` / `ocupada` / `pedido_en_curso`), and validation. Out of scope: spatial/plano fields (`pos_x`/`pos_y`/`rotacion`/`forma`/`ancho`/`alto`), automatic `pedido_en_curso` transitions, FK to `Pedido`, Redis locking, authentication/authorization, tenancy filtering by `org_id`/`sucursal_id` (columns exist but unused).

## ADDED Requirements

### Requirement: Create Mesa

The system MUST create a Mesa when given a non-empty `nombre` and a positive integer `capacidad`. `estado` MUST default to `libre` when omitted.

#### Scenario: Successful creation with default estado

- GIVEN a valid `nombre` and a positive integer `capacidad`
- WHEN a client sends `POST /mesas` without `estado`
- THEN the system MUST persist the Mesa with `estado=libre` and respond 201 with its id, nombre, capacidad, and estado

#### Scenario: Invalid payload rejected

- GIVEN a body missing `nombre`, or with an empty `nombre`, or `capacidad` is not a positive integer
- WHEN `POST /mesas` is called
- THEN the system MUST respond 400 and MUST NOT persist a Mesa

### Requirement: List Mesas

The system MUST return all Mesas, including each one's `estado`.

#### Scenario: List returns all

- GIVEN zero or more Mesas exist
- WHEN a client sends `GET /mesas`
- THEN the system MUST respond 200 with an array of all Mesas including `estado`

### Requirement: Update Mesa

The system MUST update an existing Mesa's `nombre`, `capacidad`, and/or `estado` by id; MUST validate updated fields under the same rules as creation; and MUST respond 404 when the id does not exist.

#### Scenario: Successful field update

- GIVEN a Mesa exists with id X
- WHEN a client sends `PATCH /mesas/X` with a new `nombre` or `capacidad`
- THEN the system MUST persist the change and respond 200 with the updated Mesa

#### Scenario: Update nonexistent Mesa

- GIVEN no Mesa exists with id Y
- WHEN a client sends `PATCH /mesas/Y`
- THEN the system MUST respond 404 and MUST NOT create a Mesa

#### Scenario: Invalid update rejected

- GIVEN a Mesa exists with id X
- WHEN a client sends `PATCH /mesas/X` with an empty `nombre`, a non-positive `capacidad`, or an `estado` outside the enum
- THEN the system MUST respond 400 and MUST NOT persist the change

### Requirement: Delete Mesa

The system MUST delete an existing Mesa by id and MUST respond 404 when the id does not exist.

#### Scenario: Successful deletion

- GIVEN a Mesa exists with id X
- WHEN a client sends `DELETE /mesas/X`
- THEN the system MUST remove it and respond 200 or 204

#### Scenario: Delete nonexistent Mesa

- GIVEN no Mesa exists with id Y
- WHEN a client sends `DELETE /mesas/Y`
- THEN the system MUST respond 404

### Requirement: Three-state occupancy enum

The system MUST represent `estado` as exactly one of `libre`, `ocupada`, or `pedido_en_curso` in persistence, HTTP payloads, and shared contract types, and MUST reject any other value.

#### Scenario: All three states accepted

- GIVEN a Mesa exists with id X
- WHEN a client sends `PATCH /mesas/X` with `estado` set to `libre`, `ocupada`, or `pedido_en_curso`
- THEN the system MUST persist the requested state and respond 200

#### Scenario: Unknown estado rejected

- GIVEN a Mesa exists with id X
- WHEN a client sends `PATCH /mesas/X` with `estado: "reservada"` or any value outside the enum
- THEN the system MUST respond 400 and MUST NOT persist the change

### Requirement: pedido_en_curso is operator-asserted

The system MUST allow setting `estado` to `pedido_en_curso` through the same update endpoint as any other state, with no automatic trigger, no validation that a corresponding order exists, and no `Pedido` reference of any kind. This is documented behavior for this iteration, not a defect: `Pedido` does not exist until Iter 3, so an operator (via the admin screen) asserts this state manually, and Iter 3 wires the real transition without a schema change.

#### Scenario: Operator manually asserts pedido_en_curso

- GIVEN a Mesa exists with `estado=libre` and no `Pedido` entity exists anywhere in the system
- WHEN a client sends `PATCH /mesas/X` with `estado: "pedido_en_curso"`
- THEN the system MUST persist `estado=pedido_en_curso` and respond 200, without requiring or checking for any related order
