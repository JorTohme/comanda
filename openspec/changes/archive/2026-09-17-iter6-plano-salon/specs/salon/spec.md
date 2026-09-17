# Salon Specification (delta)

## MODIFIED Requirements

### Requirement: Spatial position on the 2D floor plan

The system MUST persist a `Mesa`'s position on the 2D floor plan as `posX`/`posY` (percentage 0–100 of the rendering container, nullable), `rotacion` (degrees, default 0), `forma` (`rect` | `circle`, default `rect`), and `ancho`/`alto` (pixels, default 70). These fields MUST be settable via the same `PATCH /mesas/:id` endpoint used for every other Mesa field, with no dedicated endpoint. A `Mesa` with `posX`/`posY` unset MUST still be listed by `GET /mesas` and rendered by clients at a deterministic fallback position — it MUST NOT be omitted or error.

(Previously: `salon/spec.md`'s Purpose explicitly scoped these fields out — "Out of scope: spatial/plano fields (pos_x/pos_y/rotacion/forma/ancho/alto)". Iter 6 reverses that exclusion.)

#### Scenario: Setting a Mesa's position

- GIVEN a Mesa exists with id X and no position set
- WHEN a client sends `PATCH /mesas/X` with `posX` and `posY`
- THEN the system MUST persist both values and respond 200 with the updated Mesa

#### Scenario: Position, shape and size update independently

- GIVEN a Mesa exists with id X
- WHEN a client sends `PATCH /mesas/X` with only `forma`, `ancho`, `alto`, and `rotacion` (no `posX`/`posY`)
- THEN the system MUST persist those fields without requiring or altering `posX`/`posY`

#### Scenario: A Mesa without a position is still listed

- GIVEN a Mesa exists with id X and `posX`/`posY` both `null`
- WHEN a client sends `GET /mesas`
- THEN the system MUST include Mesa X in the response with `posX`/`posY` as `null`, not omit it or error

#### Scenario: Invalid forma rejected

- GIVEN a Mesa exists with id X
- WHEN a client sends `PATCH /mesas/X` with `forma: "hexagono"` (outside `rect`/`circle`)
- THEN the system MUST respond 400 and MUST NOT persist the change
