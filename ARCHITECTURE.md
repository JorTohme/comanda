# Arquitectura de implementación — guía de iteraciones

> Este documento es el **"cómo construirlo"**. El **"por qué/qué"** — contexto, objetivos, decisiones de diseño, modelo de dominio, puntos de dolor — vive en [`sistema-gestion-gastronomico.md`](./sistema-gestion-gastronomico.md). No se repite acá: se referencia por sección (`doc §N`).
>
> Documento vivo: se actualiza a medida que cada iteración cierra (ver checklist al final).

---

## 1. Layout del monorepo

```
comanda/
├── apps/
│   ├── api/            # NestJS — monolito modular (doc §4.2)
│   ├── web/             # Next.js — consola (Admin + Caja)
│   └── operativa/        # PWA React+Vite — Mozos + KDS
├── packages/
│   └── shared/            # tipos, schemas Zod, cliente API — único contrato entre los 3 apps
├── docker-compose.yml     # Postgres + Redis (dev) — api se suma cuando tenga DB que consumir
├── turbo.json
├── pnpm-workspace.yaml
├── sistema-gestion-gastronomico.md
├── ARCHITECTURE.md
└── index.html
```

### Por qué cada tecnología

Algunas ya venían cerradas en `sistema-gestion-gastronomico.md` (marcadas `doc §N` — el link tiene el detalle completo, acá va el resumen); otras se cierran recién acá porque el doc las había dejado abiertas o directamente no las tocaba.

| Pieza | Tecnología | Por qué |
|---|---|---|
| Package manager | **pnpm** | Instala por symlinks — sin duplicar dependencias entre 3 apps + 1 package compartido, más rápido que npm/yarn en un monorepo chico. |
| Orquestación monorepo | **Turborepo** | 3 apps + 1 package no justifica la complejidad de configuración de Nx (generators, plugins). Turborepo da cache + pipeline y nada más. |
| Backend | **NestJS** (doc §3) | La inyección de dependencias y los límites de módulo son nativos del framework — es lo que hace "monolito modular" (doc §3) algo que el código fuerza, no solo una intención de diseño. |
| Consola web | **Next.js** (doc §6) | SSR para reportes + estado en vivo por WS (doc §4.2) en un solo proyecto, sin separar backend-for-frontend. |
| App operativa | **Vite + React** (doc §6) | Dev server rápido y Workbox (Service Worker) se integra directo — clave para offline-first (doc §7.1). CRA, la alternativa clásica, está deprecado. |
| ORM | **Prisma** | Mejor ergonomía que TypeORM para scoping multi-tenant por query (`org_id`/`sucursal_id` en cada tabla, doc §4.2). |
| Base de datos | **PostgreSQL** (doc §3) | Aislamiento por fila + transacciones ACID, necesarias para que el arqueo de caja (doc §7.5) sea determinístico. |
| Tiempo real / cache / locks | **Redis** (doc §3) | Pub/sub para escalar Socket.io entre instancias, y locks por mesa para editar concurrente (doc §7.2). |
| WebSocket | **Socket.io** (doc §3) | Self-hosted, sin atarse a un BaaS de terceros (doc §3). |
| Infra local | **Docker Compose** | Mismo mecanismo que el deploy real (VPS + Docker Compose, doc §3) — no hay sorpresas entre dev y prod. |
| CI | **GitHub Actions** | Gratis para repos educativos, cero infra propia que mantener — coherente con el contexto "académico + portfolio" (doc §3). |
| Tests | **Colocados** (`*.spec.ts`) | Convención nativa de Nest; el test de un archivo está al lado, no en un árbol paralelo que hay que navegar. |
| Commits | **Conventional Commits** | Historial legible = rastro de correcciones para la carpeta única de proyecto que pide la cátedra (ver `PAUTAS-CATEDRA.md`). |
| Contrato entre apps | **`packages/shared`** (doc §5) | Un solo lugar de tipos/schemas evita que `web`, `operativa` y `api` se desincronicen. |
| Idioma del dominio | **Español** (doc §4.3) | Mismo lenguaje ubicuo que el doc de diseño — el código y la conversación de negocio usan las mismas palabras. |

---

## 2. Convención de módulos NestJS

Un patrón, no repetido por módulo:

```
apps/api/src/{modulo}/
├── {modulo}.module.ts
├── {modulo}.controller.ts
├── {modulo}.service.ts
├── entities/
└── dto/
```

Módulos = los bounded contexts ya definidos en doc §4.2: `auth`, `tenancy`, `catalogo`, `salon`, `pedidos`, `caja`, `sync`, `pagos`, `reportes`.

**Idioma del dominio: español.** Entidades, campos y nombres de módulo siguen el mismo lenguaje ubicuo que el doc de diseño — `Pedido`, `Mesa`, `ItemPedido`, `TurnoCaja`, `tipo_servicio`, `pos_x`/`pos_y` (doc §4.3, §7.8). Código de infraestructura (config, guards, decorators, nombres de carpeta) se mantiene en inglés, como es estándar en el ecosistema NestJS/TypeScript.

---

## 3. Convenciones de código

- **TypeScript estricto** en los 3 apps y en `shared`.
- **Commits convencionales** (`feat:`, `fix:`, `refactor:`, ...).
- **Tests colocados**: `{archivo}.spec.ts` al lado del código, no un árbol `test/` separado.
- **`packages/shared`** es el único punto de contrato entre frontends y backend: tipos generados, schemas Zod por agregado, cliente API. Evita que `web`, `operativa` y `api` se desincronicen (doc §5, nota "cómo se arma sin duplicar trabajo").

---

## 4. Orden de iteraciones

Mapeado 1:1 al roadmap de doc §8, partido en slices chicos y mergeables — cada iteración cierra a `main` antes de arrancar la siguiente.

### MVP

- [x] **Iter 0 — Scaffold.** Monorepo + los 3 apps vacíos conectados end-to-end (health check `web → api` y `operativa → api`). Docker Compose (Postgres + Redis). CI mínimo (lint + build).
- [x] **Iter 1 — Catálogo.** Platos, categorías, disponibilidad (backend + CRUD admin).
- [x] **Iter 2 — Salón.** Mesas CRUD + estado de ocupación, grilla simple. **El plano 2D queda afuera** — es Fase 2 (doc §7.8, §8).
- [ ] **Iter 3 — Pedidos.** Agregado + máquina de estados (`abierto → enviado_a_cocina → en_preparacion → listo → entregado → cobrado → cerrado`, doc §4.3). Carga desde mozo, online-only en esta pasada.
- [ ] **Iter 4 — Tiempo real.** Gateway Socket.io + Redis pub/sub. Eventos de dominio: `PedidoEnviadoACocina`, `PedidoListo`, `PlatoNoDisponible`, `MesaCerrada` (doc §7.3).
- [ ] **Iter 5 — Offline-first.** Service Worker + RxDB/IndexedDB + módulo `sync` (pull/push). Es el núcleo distribuido real del proyecto (doc §1) — iteración propia, no se mezcla con Iter 3 porque es lo más difícil de la lista.
- [ ] **Iter 6 — Caja.** Turnos, cierre básico, arqueo determinístico sobre log append-only (doc §7.5).

→ Cierra MVP (doc §8).

### Fase 2 (orden libre)

- [ ] Pagos — ACL Mercado Pago + webhooks idempotentes (doc §7.4).
- [ ] Takeaway y delivery.
- [ ] Dashboard de reportes y estadísticas.
- [ ] Editor de plano 2D del salón (doc §7.8).

### Fase 3

- [ ] Consolidación multi-sucursal.
- [ ] BI avanzado y proyecciones.
- [ ] Endurecimiento del escalado horizontal.

---

## 5. Cómo usar esta guía

Cada iteración es un slice chico, mergeado antes de arrancar la siguiente — no se avanza a la próxima con la anterior a medio terminar. Al cerrar una iteración, tildar su checkbox acá mismo, así el archivo queda como fuente de verdad de "dónde estamos" entre sesiones (sin depender de leer todo el historial de git para saber qué falta).
