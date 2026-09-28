# Autenticación y continuidad local

Esta guía documenta el acceso por invitación y los límites de sesión que deben respetarse al modificar módulos de negocio.

## Provisionamiento

1. La primera persona administradora se provisiona con el comando operativo `pnpm --filter api invite-admin -- --org "Restaurant" --branch "Central" --email owner@example.com`; no existe registro público.
2. Una persona administradora inicia sesión en la consola y crea invitaciones desde **Equipo** (`/equipo`). El enlace se genera manualmente y debe compartirse con la persona invitada; la aplicación no envía emails.
3. Las invitaciones del equipo solo permiten los roles `caja`, `mozo` y `cocina`, y solo una sucursal de la organización autenticada. Vencen a las 72 horas.
4. La persona invitada abre `/invitacion`, define su nombre y contraseña, y activa el enlace una sola vez. El email, rol, organización y sucursal provienen de la invitación, no del formulario.

El enlace de activación es una credencial temporal: compartilo únicamente con su destinatario y no lo registres en logs, analítica ni almacenamiento persistente. Si la consola no llega a mostrar el enlace, la invitación no puede recuperarse desde la interfaz y habrá que crear otra.

La aceptación de navegador crea invitaciones en una base `comanda_test` descartable, activa el enlace en `/invitacion` y verifica la autorización de la ruta `/equipo`. El test de fallback simula una falla del portapapeles y confirma que el enlace permanece visible para copiarlo manualmente; otro test libera una respuesta demorada después del cierre de sesión y comprueba que no se muestre al actor siguiente. Las trazas de Playwright se conservan solo cuando falla la ejecución y no deben publicarse con credenciales o datos reales.

## Sesiones y sucursales

- La consola persiste la sesión del navegador en `localStorage` y envía el token de acceso como `Authorization: Bearer <token>`.
- `POST /auth/refresh` rota el token y conserva la sucursal vinculada al token vigente; no acepta una sucursal elegida por el cliente.
- Solo una persona administradora puede cambiar la sucursal activa mediante `POST /auth/switch-sucursal`. El endpoint valida que la sucursal pertenezca a la misma organización.
- Los cambios de sesión se notifican entre componentes y pestañas. Los datos o respuestas pendientes de otra identidad, organización o sucursal deben descartarse.
- La navegación de la consola mejora la experiencia, pero no es autorización: los endpoints deben aplicar sus propios roles y límites de tenant.

## Límites de tenant

Todo service de negocio recibe `TenantContext` y lo aplica tanto a los lookups por ID como a las relaciones (`Plato → Categoria`, `Pedido → Mesa/Plato`). Un ID solo nunca autoriza acceso. Para invitar personal, el servidor obtiene `orgId` del actor autenticado y comprueba que la sucursal solicitada pertenezca a esa organización.
