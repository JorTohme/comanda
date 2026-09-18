# Datos de referencia (seed)

Datos de desarrollo/demo con nombres realistas, generados por `apps/api/prisma/seed.mjs`.
Idempotente: correrlo de nuevo borra y recrea solo esta organización — no toca ningún otro
dato de la base.

## Cómo correrlo

Con Postgres levantado y las migraciones aplicadas:

```bash
pnpm --filter api run seed
```

Si tu versión de Node no soporta `--env-file` (necesita 20.6+), exportá `DATABASE_URL`
manualmente antes de correr `node apps/api/prisma/seed.mjs` desde `apps/api/` (el valor
está en `apps/api/.env`).

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
  enviado a cocina, en preparación, listo, entregado) más un par ya cobrados en el turno actual.
- Mix de tipo de servicio: mesa, barra, takeaway y delivery (mitad por plataforma —PedidosYa/
  Rappi—, mitad delivery propio con dirección).
