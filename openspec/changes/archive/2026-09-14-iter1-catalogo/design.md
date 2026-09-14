# Design: Iter 1 — Catálogo

## Technical Approach

Three layers, built in strict order: (1) a Jest runner so TDD can start at all, (2) Prisma + `@nestjs/config` persistence, (3) `catalogo` HTTP modules, shared contracts and one admin page. Every new API module is a literal copy of `src/health/`'s shape (module + controller, plus a service where Prisma logic lives). No new patterns are invented; `packages/shared` stays dependency-free.

**Sequencing is a hard constraint**: `jest.config.js`, the `test` script/task and an empty smoke test MUST exist and pass before any `Categoria`/`Plato` test is written. Strict TDD Mode fails closed without a runner, so a RED test authored earlier is unrunnable, not red.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Test runner | Jest + ts-jest + `@nestjs/testing`, `apps/api/jest.config.js`, smoke test first | Vitest; deferring tests | Nest's documented default; `config.yaml` already pre-committed the flip to `tdd: true` for Iter 1 |
| Money | `precio Int` = centavos | `Decimal`, float | Exact arithmetic, no ceremony; conversion isolated in shared helpers |
| Tenancy | `orgId`/`sucursalId` nullable, never written, never filtered | Seed org row; add later | Confirmed in `state.yaml`; columns are free now, migrations aren't |
| Prisma wiring | `PrismaService extends PrismaClient` in a `@Global()` `PrismaModule` | Provider per feature module | One connection lifecycle; feature modules just inject |
| Validation | class-validator DTOs + global `ValidationPipe({ whitelist, forbidNonWhitelisted })` | Zod in `packages/shared` | Built into Nest, zero plumbing; keeps `shared` at zero runtime deps (proposal §Out of Scope) |
| Module split | `src/catalogo/categorias/` + `src/catalogo/platos/` | One flat `CatalogoModule` | Capability folder matches the screaming layout; each subfolder mirrors `health/` exactly |
| Config | `ConfigModule.forRoot({ isGlobal: true })` + committed `.env.example` | Raw `process.env`, dotenv | Nest-native; `.env.example` documents `DATABASE_URL` since no `.env` exists yet |
| Shared errors | CRUD wrappers `throw` on `!res.ok` | `pingApi`'s sentinel-object style | A sentinel `Categoria` is not representable; deliberate, documented deviation |

## Data Flow

```
apps/web /catalogo ──→ @comanda/shared (fetch) ──→ apps/api ValidationPipe
                                                        │
                                                        ▼
                                              Categorias/PlatosService
                                                        │
                                              PrismaService ──→ Postgres 16
```

### Sequence: admin creates a plato

```mermaid
sequenceDiagram
    actor Admin
    participant Page as apps/web<br/>catalogo/page.tsx
    participant Shared as @comanda/shared<br/>createPlato()
    participant Pipe as apps/api<br/>ValidationPipe
    participant Ctrl as PlatosController
    participant Svc as PlatosService
    participant Prisma as PrismaService
    participant DB as [(Postgres)]

    Admin->>Page: submit <form> (nombre, precio en pesos, categoriaId)
    Page->>Page: pesosToCentavos(precio)
    Page->>Shared: createPlato(API_URL, CreatePlatoInput)
    Shared->>Pipe: POST /platos (JSON)
    Pipe->>Pipe: CreatePlatoDto — whitelist + forbidNonWhitelisted
    alt payload inválido
        Pipe-->>Shared: 400 Bad Request
        Shared-->>Page: throw Error
        Page->>Admin: render error, tabla sin cambios
    else payload válido
        Pipe->>Ctrl: create(dto)
        Ctrl->>Svc: create(dto)
        Svc->>Prisma: plato.create({ data })
        Prisma->>DB: INSERT INTO "Plato"
        DB-->>Prisma: row
        Prisma-->>Svc: Plato
        Svc-->>Ctrl: Plato
        Ctrl-->>Shared: 201 + JSON
        Shared-->>Page: Plato
        Page->>Page: setPlatos([...platos, plato])
        Page->>Admin: tabla re-renderizada
    end
```

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/package.json` | Modify | +`@prisma/client`, `@nestjs/config`, `class-validator`, `class-transformer`; dev +`prisma`, `jest`, `ts-jest`, `@types/jest`, `@nestjs/testing`; `"test": "jest"` |
| `apps/api/jest.config.js` | Create | `preset: "ts-jest"`, `rootDir: "src"`, `testRegex: ".*\\.spec\\.ts$"` |
| `apps/api/src/app.smoke.spec.ts` | Create | Empty smoke test — gate for all later TDD |
| `turbo.json` | Modify | `"test": { "dependsOn": ["^build"] }` |
| `apps/api/prisma/schema.prisma` | Create | `Categoria`, `Plato` (below) |
| `apps/api/prisma/migrations/**` | Create | One additive migration (`migrate dev`) |
| `apps/api/.env` (gitignored) / `.env.example` | Create | `DATABASE_URL="postgresql://comanda:comanda@localhost:5432/comanda?schema=public"` |
| `apps/api/src/prisma/prisma.service.ts` | Create | `extends PrismaClient`, `onModuleInit` → `$connect`, `onModuleDestroy` → `$disconnect` |
| `apps/api/src/prisma/prisma.module.ts` | Create | `@Global() @Module({ providers:[PrismaService], exports:[PrismaService] })` |
| `apps/api/src/catalogo/categorias/categorias.{module,controller,service}.ts` | Create | CRUD `/categorias` |
| `apps/api/src/catalogo/categorias/dto/{create,update}-categoria.dto.ts` | Create | class-validator DTOs |
| `apps/api/src/catalogo/platos/platos.{module,controller,service}.ts` | Create | CRUD `/platos` |
| `apps/api/src/catalogo/platos/dto/{create,update}-plato.dto.ts` | Create | class-validator DTOs |
| `apps/api/src/app.module.ts` | Modify | `imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, HealthModule, CategoriasModule, PlatosModule]` |
| `apps/api/src/main.ts` | Modify | `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))` |
| `packages/shared/src/index.ts` | Modify | Contracts + fetch wrappers (below) |
| `apps/web/app/catalogo/page.tsx` | Create | Admin CRUD screen |
| `openspec/config.yaml` | Modify | `apply.tdd: true`, `test_command: "pnpm --filter api test"`, `verify.test_command` idem |

## Interfaces / Contracts

```prisma
model Categoria {
  id         String   @id @default(uuid())
  nombre     String
  orgId      String?
  sucursalId String?
  platos     Plato[]
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model Plato {
  id          String    @id @default(uuid())
  nombre      String
  precio      Int       // centavos
  disponible  Boolean   @default(true)
  categoriaId String
  categoria   Categoria @relation(fields: [categoriaId], references: [id])
  orgId       String?
  sucursalId  String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}
```

DTOs: `CreateCategoriaDto { @IsString @IsNotEmpty nombre }`; `CreatePlatoDto { nombre: @IsString @IsNotEmpty; precio: @IsInt @Min(0); categoriaId: @IsUUID; disponible?: @IsOptional @IsBoolean }`; both `Update*Dto` are the create DTO with every field `@IsOptional()` (hand-written — no `@nestjs/mapped-types` dependency).

```ts
// packages/shared/src/index.ts — added exports
export interface Categoria { id: string; nombre: string; orgId: string | null; sucursalId: string | null; createdAt: string; updatedAt: string; }
export interface Plato { id: string; nombre: string; precio: number /* centavos */; disponible: boolean; categoriaId: string; orgId: string | null; sucursalId: string | null; createdAt: string; updatedAt: string; }

export type CreateCategoriaInput = { nombre: string };
export type UpdateCategoriaInput = Partial<CreateCategoriaInput>;
export type CreatePlatoInput = { nombre: string; precio: number; categoriaId: string; disponible?: boolean };
export type UpdatePlatoInput = Partial<CreatePlatoInput>;

export function listCategorias(baseUrl: string): Promise<Categoria[]>;
export function createCategoria(baseUrl: string, input: CreateCategoriaInput): Promise<Categoria>;
export function updateCategoria(baseUrl: string, id: string, input: UpdateCategoriaInput): Promise<Categoria>;
export function deleteCategoria(baseUrl: string, id: string): Promise<void>;
export function listPlatos(baseUrl: string): Promise<Plato[]>;
export function createPlato(baseUrl: string, input: CreatePlatoInput): Promise<Plato>;
export function updatePlato(baseUrl: string, id: string, input: UpdatePlatoInput): Promise<Plato>;
export function deletePlato(baseUrl: string, id: string): Promise<void>;

export function centavosToPesos(centavos: number): string; // 1550 -> "15.50"
export function pesosToCentavos(pesos: string): number;    // "15.50" -> 1550
```

All wrappers take `baseUrl` first (the `pingApi` convention), use `fetch` with `Content-Type: application/json`, and `throw new Error` when `!res.ok`.

### `apps/web/app/catalogo/page.tsx`

Single `"use client"` component, no UI library, native `<form>`/`<table>`. State:

```ts
categorias: Categoria[]        // for the <select> and the categorías table
platos: Plato[]
form: { nombre: string; precioPesos: string; categoriaId: string; disponible: boolean }
editandoPlatoId: string | null // null = create mode, otherwise update
nuevaCategoria: string
error: string | null
cargando: boolean
```

`useEffect` on mount → `Promise.all([listCategorias, listPlatos])`. Submit → `pesosToCentavos(form.precioPesos)` then `createPlato`/`updatePlato`, then update local arrays (no refetch). Toggle `disponible` → `updatePlato(url, id, { disponible: !p.disponible })`. Delete → `deletePlato` + filter. Prices rendered via `centavosToPesos`. `API_URL` from `process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"`, matching `app/page.tsx`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Gate | Runner works | `app.smoke.spec.ts` passes before any domain test exists |
| Unit (shared) | `pesosToCentavos` / `centavosToPesos` round-trip, decimals, zero | Plain Jest in `packages/shared` (or exercised from api) — covers the "cents read as pesos" risk |
| Unit (api) | `CategoriasService` / `PlatosService` CRUD | `@nestjs/testing` module with `PrismaService` mocked |
| Integration | ValidationPipe rejects bad payloads with 400; `precio` persists as Int | `Test.createTestingModule` + supertest against a real dev Postgres |
| Manual | `/catalogo` list/create/edit/delete/toggle | Browser against `pnpm dev` |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The one trust boundary is the HTTP request body, handled by the global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` (unknown fields rejected, not silently dropped).

## Migration / Rollout

One additive Prisma migration creating two new tables; no existing table is touched and no prior data exists, so `prisma migrate reset` is lossless. No feature flags, no phased rollout. Requires `docker compose up -d` before `migrate dev`.

## Open Questions

- [ ] None blocking. `orgId`/`sucursalId` stay nullable and unwritten until an auth/tenancy iteration adds the writer and the filters.
