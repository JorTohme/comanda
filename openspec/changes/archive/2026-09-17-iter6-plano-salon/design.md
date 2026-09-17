# Design: Iter 6 — Plano 2D del salón

## Technical Approach

Posición en **porcentaje del contenedor (0–100)**, no píxeles — así el mismo par `(posX, posY)` se ve en la misma disposición relativa en un canvas de escritorio (`/salon`, web) y uno angosto de celular (`MozoView`, operativa), sin coordinar tamaños de contenedor entre las dos apps. Cada app define su propio contenedor con `aspect-ratio` fijo y `position: relative`; cada mesa es un `div` con `position: absolute; left: X%; top: Y%`, tamaño en píxeles (`ancho`/`alto`, no escala con el contenedor — una mesa no se vuelve ilegible en mobile) y `transform: rotate(deg)`.

Nada de librería de canvas ni de drag-and-drop: Pointer Events nativos (`onPointerDown/Move/Up`) sobre cada mesa. El mismo gesto que hoy cicla el `estado` (click) tiene que convivir con el gesto nuevo (arrastrar) — se resuelven con un umbral de desplazamiento: si el puntero se movió menos de ~4px entre down y up, es un click; si se movió más, es un drag y no dispara el ciclo de estado.

## Architecture Decisions

| Decisión | Elección | Rechazado | Razón |
|---|---|---|---|
| **Sistema de coordenadas** | Porcentaje 0–100 del contenedor | Píxeles absolutos | Los dos consumidores (`/salon` de escritorio, `MozoView` de celular) tienen contenedores de ancho muy distinto. Porcentaje hace que la disposición relativa se preserve sin que ninguna app necesite conocer el tamaño de contenedor de la otra |
| **Drag** | Pointer Events nativos + umbral de desplazamiento para distinguir click de drag | HTML5 Drag and Drop API | El doc de arquitectura pide explícitamente "posicionamiento absoluto + eventos de puntero", no HTML5 DnD (que además tiene su propio modelo de ghost-image/dataTransfer, pensado para arrastrar *entre* contenedores, no para reposicionar libremente dentro de uno) |
| **Tamaño y rotación** | Se editan en el form "Editar mesa" que ya existe (inputs numéricos) | Handles de resize/rotate arrastrables sobre el plano | Un segundo modo de interacción (agarrar una esquina para rotar, un borde para re-dimensionar) es una superficie de UI considerablemente más grande que reposicionar — el form ya existe y ya resuelve "cambiar un atributo de la mesa", no hace falta un gesto nuevo para esto todavía |
| **Mesa sin posición** | `posicionPorDefecto(index)` en `packages/shared` — grilla determinística por índice, calculada en el cliente, nunca persistida hasta que el admin la arrastra | Asignar una posición al crear la Mesa (server-side) | Persistir una posición "inventada" en el servidor ensucia el dato — `posX`/`posY` en `null` significa honestamente "nadie la ubicó todavía". El cliente decide dónde mostrarla mientras tanto, y el primer drag es lo que la vuelve real |
| **Click vs. drag** | Umbral de ~4px de desplazamiento entre `pointerdown` y `pointerup` | Un modificador explícito (ej. mantené para arrastrar) | Un umbral chico es invisible para el usuario en el uso normal (un click real casi no mueve el puntero) y no exige aprender un gesto especial — mismo patrón que usan editores de canvas simples |
| **Persistencia del drag** | Un solo `PATCH /mesas/:id` al soltar (`pointerup`), no uno por frame de movimiento | `PATCH` en cada `pointermove` | Un request por movimiento satura la red y la base sin necesidad — la posición visual se actualiza localmente (estado de React) durante el arrastre, y solo se confirma contra el servidor al soltar |

## Data Flow

```
Admin arrastra mesa en /salon (web)
    │ pointerdown → pointermove (estado local, sin red) → pointerup
    │ desplazamiento > 4px ⇒ PATCH /mesas/:id { posX, posY }
    ▼
MesasService.update ──→ Prisma (persiste) ──→ RealtimeGateway.emitToSucursal("mesa.actualizada")
    │
    ├──→ otras pestañas de /salon (ya suscriptas, Iter 4)
    └──→ apps/operativa MozoView (ya suscripto, Iter 4) — reposiciona sin recargar
```

## File Changes

| File | Acción | Descripción |
|---|---|---|
| `apps/api/prisma/schema.prisma` | Modificar | `Mesa`: `posX Float?`, `posY Float?`, `rotacion Float? @default(0)`, `forma String? @default("rect")`, `ancho Float? @default(70)`, `alto Float? @default(70)` |
| `apps/api/prisma/migrations/**` | Crear | migración additiva |
| `apps/api/src/salon/mesas/dto/create-mesa.dto.ts` | Modificar | campos opcionales nuevos, `forma` validado con `@IsIn(["rect","circle"])` |
| `apps/api/src/salon/mesas/dto/update-mesa.dto.ts` | Modificar | ídem |
| `apps/api/src/salon/mesas/mesas.service.spec.ts` | Modificar | test: `update` persiste `posX`/`posY`/`rotacion`/`forma`/`ancho`/`alto` cuando se pasan |
| `packages/shared/src/index.ts` | Modificar | `Mesa` gana los 6 campos (nullable donde corresponde); `CreateMesaInput`/`UpdateMesaInput` ídem; nueva `posicionPorDefecto(index: number): { x: number; y: number }` |
| `apps/web/app/salon/page.tsx` | Modificar | contenedor `aspect-ratio`, mesas absolutas arrastrables, click-vs-drag |
| `apps/operativa/src/MozoView.tsx` | Modificar | contenedor `aspect-ratio`, mesas absolutas de solo lectura |
| `apps/operativa/src/styles.css` | Modificar | `.plano-salon`, `.mesa-plano` (reemplaza/convive con `.grid-mesas`/`.celda-mesa` para la sección Mesas) |

## Interfaces / Contracts

```prisma
model Mesa {
  // ...campos existentes sin cambios...
  posX      Float?
  posY      Float?
  rotacion  Float?  @default(0)
  forma     String? @default("rect")
  ancho     Float?  @default(70)
  alto      Float?  @default(70)
}
```

```ts
// packages/shared/src/index.ts — agregado
export function posicionPorDefecto(index: number): { x: number; y: number } {
  const columnas = 5;
  const paso = 100 / columnas;
  return {
    x: (index % columnas) * paso + paso / 2,
    y: Math.floor(index / columnas) * 18 + 12,
  };
}
```

`Mesa` gana `posX: number | null`, `posY: number | null`, `rotacion: number`, `forma: "rect" | "circle"`, `ancho: number`, `alto: number`. `CreateMesaInput`/`UpdateMesaInput` los agregan como opcionales.

## Testing Strategy

| Capa | Qué testear | Cómo |
|---|---|---|
| Unit (api) — RED first | `MesasService.update` persiste `posX`/`posY`/`rotacion`/`forma`/`ancho`/`alto` cuando el DTO los trae, y emite `mesa.actualizada` con el resultado (ya cubierto genéricamente por el test de Iter 4, se extiende el fixture) | Extiende `mesas.service.spec.ts` existente |
| Unit (shared) | `posicionPorDefecto` da posiciones distintas para índices consecutivos, dentro de 0–100 | `packages/shared/src/index.spec.ts` |
| Manual | Arrastrar una mesa en `/salon`, soltar, confirmar que `GET /mesas` devuelve la nueva posición; abrir `apps/operativa` como mozo en paralelo y confirmar que se reubica sin recargar; click sin arrastre sigue ciclando estado | Browser contra `pnpm dev` |

## Migration / Rollout

Migración additiva, todas las columnas nullable o con default — sin impacto en mesas existentes (quedan con `posX/posY = null`, se ven en la posición por defecto hasta que el admin las ubique).

## Open Questions

- [ ] Ninguna bloqueante.
- [ ] Resize/rotate por gesto (handles arrastrables) queda como candidato de una iteración futura si el form por inputs resulta incómodo en el uso real.
