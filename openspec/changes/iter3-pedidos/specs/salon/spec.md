# Delta for Salon

## MODIFIED Requirements

### Requirement: pedido_en_curso has a manual path and an automatic driver

The system MUST allow setting `estado` to `pedido_en_curso` through the same update endpoint as any other state (`PATCH /mesas/:id`), with no validation that a corresponding order exists — this manual path MUST continue to work exactly as before. In addition, the system MUST automatically set a `Mesa.estado` to `pedido_en_curso` when a `Pedido` with `tipoServicio=mesa` is created against that Mesa, and MUST automatically set it back to `libre` when that `Pedido` reaches its terminal `estado=cerrado`. The automatic driver and the manual path are independent: neither disables the other.

(Previously: `pedido_en_curso` was purely operator-asserted with no automatic trigger and no `Pedido` reference of any kind, because `Pedido` did not exist. Iter 3 introduces `Pedido` and wires the automatic transition described above; the manual PATCH path is preserved unchanged.)

#### Scenario: Operator manually asserts pedido_en_curso

- GIVEN a Mesa exists with `estado=libre` and no `Pedido` is linked to it
- WHEN a client sends `PATCH /mesas/X` with `estado: "pedido_en_curso"`
- THEN the system MUST persist `estado=pedido_en_curso` and respond 200, without requiring or checking for any related order

#### Scenario: Creating a mesa Pedido automatically sets pedido_en_curso

- GIVEN a Mesa exists with id X and `estado=libre`
- WHEN a `Pedido` is created with `tipoServicio=mesa` and `mesaId=X`
- THEN the system MUST automatically set Mesa X's `estado` to `pedido_en_curso` without any direct `PATCH /mesas/X` call

#### Scenario: Closing the linked Pedido automatically frees the Mesa

- GIVEN a Mesa exists with id X and `estado=pedido_en_curso` due to a linked `Pedido`
- WHEN that `Pedido` transitions to `estado=cerrado`
- THEN the system MUST automatically set Mesa X's `estado` back to `libre`

#### Scenario: Manual path still works after Pedido exists

- GIVEN a Mesa exists with id X and `estado=ocupada`, with no `Pedido` linked to it
- WHEN a client sends `PATCH /mesas/X` with `estado: "pedido_en_curso"`
- THEN the system MUST persist `estado=pedido_en_curso` and respond 200, exactly as it did before `Pedido` existed
