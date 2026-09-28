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

### Semántica monetaria y cierre de caja

- `Cobro` es la evidencia de una venta cobrada; un `Pedido` entregado o sus ítems no prueban un pago.
- El efectivo esperado es `montoInicial + Cobros efectivo + ingresos - egresos`. Los Cobros digitales se muestran aparte; `totalVentas` suma Cobros en cualquier medio y nunca movimientos ni apertura.
- Cierre, cobros y movimientos se serializan con lock de la fila `Sucursal`, siempre antes de tocar los registros hijos. El cierre persiste un snapshot inmutable; reintentar con el mismo monto declarado devuelve ese snapshot y cambiarlo produce conflicto.
- Un turno cerrado previo a esta semántica queda marcado `legacy_mixta`; se conserva su total histórico sin reinterpretarlo. La UI lo rotula **Total histórico mixto**. Ningún medio ni fecha de cobro desconocidos se deducen de timestamps del Pedido.
- `cobrosDigitalesSinTurno` cuenta Cobros Mercado Pago de la sucursal sin turno; `pedidosLegacySinCobro` cuenta, para un turno, Pedidos vinculados por `turnoCajaId` que aún no tienen Cobro.
- Un turno abierto heredado `legacy_mixta` bloquea escrituras monetarias hasta su conciliación explícita bajo el procedimiento de rollout.

Mapeado 1:1 al roadmap de doc §8, partido en slices chicos y mergeables — cada iteración cierra a `main` antes de arrancar la siguiente.

### MVP

- [x] **Iter 0 — Scaffold.** Monorepo + los 3 apps vacíos conectados end-to-end (health check `web → api` y `operativa → api`). Docker Compose (Postgres + Redis). CI mínimo (lint + build).
- [x] **Iter 1 — Catálogo.** Platos, categorías, disponibilidad (backend + CRUD admin).
- [x] **Iter 2 — Salón.** Mesas CRUD + estado de ocupación, grilla simple. **El plano 2D queda afuera** — es Fase 2 (doc §7.8, §8).
- [x] **Iter 3 — Pedidos.** Agregado + máquina de estados (`abierto → enviado_a_cocina → en_preparacion → listo → entregado → cobrado → cerrado`, doc §4.3). Carga desde mozo, online-only en esta pasada.
- [ ] **Iter 4 — Tiempo real.** Gateway Socket.io + Redis pub/sub. Eventos de dominio: `PedidoEnviadoACocina`, `PedidoListo`, `PlatoNoDisponible`, `MesaCerrada` (doc §7.3).
- [ ] **Iter 5 — Offline-first.** Service Worker + RxDB/IndexedDB + módulo `sync` (pull/push). Es el núcleo distribuido real del proyecto (doc §1) — iteración propia, no se mezcla con Iter 3 porque es lo más difícil de la lista.
- [x] **Iter 6 — Caja.** Turnos, cierre básico, arqueo determinístico sobre log append-only (doc §7.5). **Adelantada antes que Iter 4/5** — ambas son infraestructura para `apps/operativa`, que todavía no tiene ninguna pantalla propia; Caja es autocontenida y sigue el mismo patrón de módulo ya probado en Catálogo/Salón/Pedidos.

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

## Autenticación y aislamiento por tenant

La API protege todas las rutas excepto `GET /health` y `POST /auth/*` con el guard global de JWT. El token lleva `sub`, `orgId`, `sucursalId` y `rol`; los controllers pasan ese contexto a los services. Cada listado, búsqueda, actualización, borrado y lookup relacional se scopea por ambos IDs. Por eso, una categoría, mesa o plato ajeno se comporta como inexistente y no puede conectarse a datos locales.

### Bootstrap local

1. Configurá `DATABASE_URL` y un `JWT_SECRET` de alta entropía (el fallback de desarrollo es sólo para trabajo local).
2. Aplicá las migraciones con `pnpm --filter api exec prisma migrate dev`.
3. Creá la organización, su primera sucursal y una invitación de administrador con `pnpm --filter api invite-admin -- --org <nombre> --branch <nombre> --email <email>`. El comando imprime un enlace de activación de un solo uso; la persona invitada define su nombre y contraseña en `/invitacion`. No existe un registro público.
4. Después de activar la cuenta, el acceso se inicia por `POST /auth/login`. El cliente compartido persiste la sesión validada y adjunta su access token como `Authorization: Bearer ...`.

### Sesión de navegador y realtime

`packages/shared` es el único dueño de la sesión del navegador para `web` y `operativa`. Persiste el objeto validado completo bajo `comanda.session`; los frontends no escriben tokens o datos de usuario por separado. Si la clave canónica todavía no existe, la primera lectura intenta migrar `comanda.accessToken`, `comanda.refreshToken` y `comanda.user` sólo cuando las tres claves forman una sesión válida. La migración escribe primero la sesión canónica y luego elimina las claves anteriores; datos incompletos o inválidos no se consideran una sesión autenticada. Si ya existe la clave canónica, esa es la fuente de verdad.

El cliente coordina renovaciones dentro de una pestaña con una promesa compartida (*singleflight*) por origen y refresh token. En navegadores que implementan Web Locks, usa el lock de origen `comanda.session.refresh`; dentro del lock vuelve a leer la sesión para reutilizar un refresh token más nuevo en vez de consumir uno ya rotado. Sin Web Locks, sólo queda garantizada la coordinación dentro de esa pestaña. Los cambios de sesión se notifican a los componentes del mismo documento y a otras pestañas mediante `storage`. Los errores transitorios de red/servidor conservan la sesión; una respuesta de refresh `401`/`403` la invalida. Los callbacks de red pendientes se descartan si entretanto cambió la generación o la identidad (usuario, organización o sucursal) de la sesión.

Cada conexión o reconexión Socket.io obtiene sus credenciales de la sesión vigente mediante un callback de `auth`; no captura el token de la sesión con la que se montó originalmente la pantalla. Al cerrar sesión o cambiar la identidad/tenant, el componente que posee el socket lo desconecta. En el servidor, el gateway verifica `exp`, rechaza tokens sin vencimiento válido y programa la desconexión del socket cuando vence el access token; si el cliente se desconecta antes, limpia ese temporizador.

`admin`, `caja`, `mozo` y `cocina` viajan en el token. La API valida la identidad y el tenant, y aplica la autorización real en guards y servicios —incluidas las transiciones de pedidos—; ocultar botones, rutas o formularios por rol sólo mejora la interfaz y nunca reemplaza el control del backend. `CurrentUser` proyecta únicamente `{orgId, sucursalId}` para consultas de negocio; los handlers que necesitan actuar según el rol reciben el actor autenticado por separado.

### Migración de datos y contratos

La migración de tenancy crea `Organizacion`, `Sucursal` y `Usuario`; primero asigna los registros anteriores a una organización y sucursal iniciales deterministas, y luego vuelve obligatorias las columnas junto con sus foreign keys e índices. El paquete compartido valida el JSON de la API con Zod en el borde del cliente. Usá `ApiOptions` sólo desde clientes no-browser; las llamadas del navegador usan el token de la sesión iniciada.

CI ejecuta lint, build y tests. No elimines la etapa de tests: el scoping por tenant es una frontera de corrección, no un detalle de UI.
