# Autenticación y continuidad local

Esta guía explica cómo iniciar el primer tenant y qué no se puede romper cuando se modifique un módulo de negocio.

## Inicio rápido

1. Definí `DATABASE_URL` y un `JWT_SECRET` largo y aleatorio.
2. Aplicá las migraciones con `pnpm --filter api exec prisma migrate dev`.
3. Creá la primera organización, sucursal y usuario con `POST /auth/register`.
4. Iniciá sesión en el header de la consola con ese email y contraseña.

## Decisiones que ya están cerradas

| Tema | Decisión |
|---|---|
| Sesión | JWT HS256 de ocho horas en `Authorization: Bearer <token>`. `JWT_SECRET` es obligatoria y no tiene valor por defecto: la app no arranca sin definirla. |
| Contraseñas | `scrypt` nativo con salt aleatorio; no se almacena texto plano. |
| Tenant | El token contiene `orgId` y `sucursalId`; ambos IDs scopean todas las consultas de negocio. |
| Rutas públicas | Sólo `GET /health` y `POST /auth/register` / `POST /auth/login`. |
| Contratos cliente | `@comanda/shared` adjunta el token de `localStorage` y valida respuestas exitosas con Zod. |

## Límites intencionales

- `POST /auth/register` es un bootstrap. Antes de producción necesita reglas de invitación o provisioning: no debe quedar público sin ese flujo.
- `POST /auth/register` crea organización y sucursal nuevas en cada llamada: hoy no hay forma de sumar un segundo usuario (caja, mozo, cocina) a una sucursal ya existente por API. Falta un endpoint tipo `POST /usuarios`, protegido por rol `admin`, que tome `orgId`/`sucursalId` del token en vez de crearlos de cero.
- `admin`, `caja`, `mozo` y `cocina` ya viajan en el token, pero todavía no hay permisos por endpoint. Agregalos sólo cuando exista la matriz de roles.
- Las filas anteriores a la migración se conservan bajo `Organización inicial` / `Sucursal inicial`. No son accesibles hasta provisionar un usuario de esa sucursal de forma administrativa.

## Regla para próximos cambios

Todo service de negocio debe recibir `TenantContext` y aplicarlo tanto a los lookups por ID como a las relaciones (`Plato → Categoria`, `Pedido → Mesa/Plato`). Un ID solo nunca autoriza acceso.
