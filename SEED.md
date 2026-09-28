# Datos de referencia (seed)

Datos de desarrollo/demo con nombres realistas, generados por `apps/api/prisma/seed.mjs`.
El seed solo reemplaza la organización con el ID fijo `5dbff8f2-89ed-4c65-b39d-f6c029346ee1`;
no busca ni adopta organizaciones por nombre. Una organización existente con ese ID pero con
otra identidad de usuarios se conserva y hace que el seed falle. Todo el reemplazo ocurre en
una transacción, por lo que un error restaura los datos demo anteriores.

## Cómo correrlo

Con una base **local y descartable** de nombre terminado en `_demo` (recomendado) o `_test`,
Postgres levantado y las migraciones aplicadas. Se requieren las dos variables de protección;
el seed rechaza producción, flags ausentes, hosts remotos y bases con otro nombre antes de
crear un cliente Prisma:

```bash
NODE_ENV=development ALLOW_DEMO_SEED=true DATABASE_URL=postgresql://comanda:comanda@localhost:5432/comanda_demo pnpm --filter api run seed
```

En PowerShell:

```powershell
$env:NODE_ENV = "development"
$env:ALLOW_DEMO_SEED = "true"
$env:DATABASE_URL = "postgresql://comanda:comanda@localhost:5432/comanda_demo"
pnpm --filter api run seed
```

No apuntes el seed a una base compartida o con datos reales. Aunque una base `_test` pasa la
validación, usala solo si es descartable: el ID demo fijo se reemplaza en cada ejecución.
Las organizaciones antiguas llamadas “Asador Don Mario” con otro ID no se modifican ni se
adoptan automáticamente.

## Organización

**Asador Don Mario** — 3 sucursales: **Belgrano**, **Palermo**, **Recoleta**.

## Usuarios

Todos con la misma contraseña: **`Comanda2026!`**

| Rol | Sucursal | Nombre | Email |
|---|---|---|---|
| admin | Belgrano (home, ve las 3 vía el switcher) | Mario Fernández | `admin@donmario.test` |
| caja | Belgrano | Lucía Gómez | `caja.belgrano@donmario.test` |
| mozo | Belgrano | Tomás Ibáñez | `mozo.belgrano@donmario.test` |
| cocina | Belgrano | Valentina Rossi | `cocina.belgrano@donmario.test` |
| caja | Palermo | Camila Torres | `caja.palermo@donmario.test` |
| mozo | Palermo | Nicolás Medina | `mozo.palermo@donmario.test` |
| cocina | Palermo | Sofía Acosta | `cocina.palermo@donmario.test` |
| caja | Recoleta | Martina López | `caja.recoleta@donmario.test` |
| mozo | Recoleta | Franco Díaz | `mozo.recoleta@donmario.test` |
| cocina | Recoleta | Agustín Romero | `cocina.recoleta@donmario.test` |

El admin solo puede iniciar sesión en `apps/web` (Consola). Mozo y cocina entran por
`apps/operativa`. Caja y admin también pueden usar `apps/web` para caja/catálogo/reportes.

## Catálogo (igual en cada sucursal, cargado independiente)

6 categorías × 3–5 platos = 24 platos por sucursal (72 en total):

- **Entradas**: Empanadas de carne, Empanadas de jamón y queso, Provoleta, Rabas
- **Parrilla**: Bife de chorizo, Asado de tira, Vacío, Pollo al disco
- **Pastas**: Ñoquis con salsa, Sorrentinos de jamón y queso, Ravioles de verdura, Tallarines con tuco
- **Ensaladas**: Ensalada César, Ensalada mixta, Ensalada caprese
- **Postres**: Flan casero, Tiramisú, Helado (2 bochas), Panqueque con dulce de leche
- **Bebidas**: Agua mineral, Coca-Cola, Cerveza Quilmes, Vino de la casa (copa), Café

## Salón

10 mesas por sucursal (capacidad 2 a 8), ubicadas en grilla en el plano.

## Actividad

Por cada sucursal:

- **Historial**: 7 días hacia atrás, un turno de caja cerrado por día con 12–20 pedidos
  cobrados cada uno (hora concentrada en almuerzo/cena) — alimenta Reportes con datos reales.
- **Hoy**: un turno de caja abierto, con pedidos en distintos estados del pipeline (abierto,
  enviado a cocina, en preparación, listo, entregado) más tres ya cobrados en el turno actual.
- Mix de tipo de servicio: mesa, barra, takeaway y delivery (mitad por plataforma —PedidosYa/
  Rappi—, mitad delivery propio con dirección).

Cada pedido cobrado incluye su recibo `Cobro`, método y fecha; los pagos digitales tienen un
identificador de proveedor ficticio exclusivo del demo y no contactan Mercado Pago. Los cierres
históricos separan venta digital de efectivo: `totalCalculado` incluye apertura y efectivo,
`totalDigital` contiene recibos digitales y `totalVentas` suma ambos métodos.
