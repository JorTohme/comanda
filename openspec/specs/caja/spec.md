# Caja and Receipt Specification

## Purpose

Define tenant-scoped cash-shift writes, receipt posting, physical drawer reconciliation, and immutable close snapshots. Unknown historical tender or collection time remains unknown; it is never inferred from order timestamps.

## Requirements

### Requirement: Serialize cash mutations by branch

The system MUST acquire the tenant-validated Sucursal row lock before opening or closing a shift, recording a movement, collecting cash, or posting an approved digital receipt. Only admin and caja actors belonging to the tenant may mutate cash state. An open `legacy_mixta` shift MUST block new money mutations until it is reconciled outside this workflow.

#### Scenario: Concurrent shift open

- GIVEN no open shift exists for a branch
- WHEN two actors open a shift concurrently
- THEN exactly one shift MUST be created and the other request MUST conflict

#### Scenario: Legacy shift blocks writes

- GIVEN an open shift is marked `legacy_mixta`
- WHEN a user attempts a new cash receipt, movement, digital receipt assignment, or shift close
- THEN the write MUST be rejected without changing the shift or receipt ledger

### Requirement: Record one authoritative receipt per Pedido

The system MUST persist at most one Cobro per Pedido. Cash collection MUST require an actor with admin/caja role, a tenant-owned delivered Pedido, a positive safe-integer item snapshot total, and an open effective cash shift. Repeating an already committed cash collection MUST return the same Pedido/Cobro, even after the shift closes. A digital receipt MUST carry verified payment identity and collection time, and MUST NOT replace an existing different receipt.

#### Scenario: Cash is collected once

- GIVEN a delivered Pedido without a Cobro and an open effective shift
- WHEN two cash collection requests race
- THEN one Cobro MUST be stored and both successful requests MUST return that same receipt

#### Scenario: Cash and digital receipts conflict

- GIVEN a Pedido already has a digital Cobro
- WHEN cash collection is attempted
- THEN the request MUST conflict and the ledger MUST retain only the digital Cobro

### Requirement: Separate physical cash from digital receipts

For an effective open shift, expected physical cash MUST equal opening cash plus cash Cobros plus net cash movements. `totalDigital` MUST contain only Mercado Pago Cobros and `totalVentas` MUST contain all Cobros. Unpaid Pedido item totals MUST NOT be treated as sales or drawer cash.

#### Scenario: Digital receipt does not inflate drawer cash

- GIVEN an open shift with opening cash and one approved digital receipt
- WHEN the shift totals are read or closed
- THEN expected physical cash MUST exclude that receipt while digital and sales totals include it

### Requirement: Freeze shift close snapshots

Closing an effective shift MUST atomically persist declared amount, expected physical cash, digital total, sales total, difference, close actor, and close time. A same-declaration retry MUST return the identical stored snapshot; a different declaration MUST conflict. No cash collection or movement may be added after close. Digital receipts posted after close MUST remain unassigned and MUST NOT mutate the closed snapshot.

#### Scenario: Close races with collection

- GIVEN a cash receipt and shift close contend for the branch lock
- WHEN the receipt commits first
- THEN the close snapshot MUST include it
- WHEN close commits first
- THEN the cash request MUST conflict and no Cobro MUST be written

#### Scenario: Closed historical shift retains mixed total

- GIVEN a pre-migration closed shift with a stored historical total
- WHEN the shift is read or an identical close is retried
- THEN the stored total MUST remain unchanged and MUST be labeled `Total histórico mixto`

### Requirement: Report unresolved receipt counts

The current-shift and shift-detail responses MUST include `cobrosDigitalesSinTurno`, the tenant-and-branch count of Mercado Pago Cobros without a shift, and `pedidosLegacySinCobro`, the per-shift count of Pedidos linked by `turnoCajaId` without a Cobro.

#### Scenario: Unassigned digital receipt is visible

- GIVEN a digital Cobro arrives after the branch has no open effective shift
- WHEN the current shift or shift detail is read
- THEN the unassigned digital count MUST include it without changing any closed snapshot
