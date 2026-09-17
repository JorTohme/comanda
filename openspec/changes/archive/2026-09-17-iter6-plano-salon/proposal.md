# Proposal: Iter 6 — Plano 2D del salón

## Intent

`sistema-gestion-gastronomico.md` §7.8 lo nombra como el diferencial central contra Fudo (§1: "Mapeo 2D del salón incluido desde el día uno") y `openspec/specs/salon/spec.md` lo lista explícitamente como fuera de alcance hasta ahora ("spatial/plano fields — pos_x/pos_y/rotacion/forma/ancho/alto"). El bloqueo real (no había pasada de diseño visual para aplicar esto con criterio) ya se resolvió. El admin arma el plano desde la consola web (`/salon`); salón (misma pantalla) y mozos (`apps/operativa`) lo ven en esa disposición real en vez de una grilla genérica.

## Scope

### In Scope

- `Mesa` gana `posX`/`posY` (porcentaje 0–100 del contenedor, nullable — sin posición hasta que el admin la ubique), `rotacion` (grados, default 0), `forma` (`rect` | `circle`, default `rect`), `ancho`/`alto` (px, default 70) — exactamente los campos que `salon/spec.md` marcaba como fuera de alcance.
- `PATCH /mesas/:id` (ya existe) acepta estos campos — mismo endpoint, sin uno nuevo. Emite `mesa.actualizada` gratis (ya viene de Iter 4).
- `apps/web` `/salon`: el editor. Arrastrar una mesa (Pointer Events, sin librería de canvas — mismo criterio que el doc) reposiciona vía `PATCH`; un click sin arrastre sigue ciclando `estado` como hoy. Forma/ancho/alto/rotación se editan con el form de "Editar mesa" que ya existe (inputs, no handles de resize/rotate — eso es un modo de interacción aparte que no vale sumar todavía).
- `apps/operativa` `MozoView`: la sección "Mesas" pasa de grilla a plano posicionado, de solo lectura (sin drag).
- `packages/shared`: `posicionPorDefecto(index)` — función pura para ubicar mesas sin `posX`/`posY` en un layout de arranque (grilla determinística), reutilizada por ambos clientes para que el plano no aparezca vacío antes de que el admin ubique nada.

### Out of Scope

- Handles de resize/rotate arrastrables — tamaño y rotación se editan por formulario, no por gesto.
- `apps/web` `/caja` — sigue sin realtime ni vista de mesas (ya excluido en Iter 4).
- Múltiples plantas/zonas nombradas (Salón/Terraza/Barra del handoff de diseño original) — una sola superficie por sucursal.
- Colisión/snapping entre mesas — el admin puede superponerlas, no se valida.
- Multi-sucursal (ya fuera de alcance en todo el proyecto — single-tenant en el deploy).

## Capabilities

### Modified Capabilities

- `salon`: MODIFIED delta que revierte explícitamente la exclusión de campos espaciales que el propio spec dejó anotada.

## Approach

1. Migración additiva: 6 columnas nuevas en `Mesa`, todas con default salvo `posX`/`posY`.
2. `CreateMesaDto`/`UpdateMesaDto` ganan los campos opcionales; `MesasService` no cambia su lógica (Prisma ya persiste lo que el DTO valida).
3. `packages/shared`: tipos + `posicionPorDefecto`.
4. `apps/web` `/salon`: contenedor con `aspect-ratio` fijo, mesas absolutas en `%`, drag vs. click por umbral de desplazamiento.
5. `apps/operativa` `MozoView`: mismo renderizado, sin handlers de drag.

## Affected Areas

| Area | Impacto | Descripción |
|---|---|---|
| `apps/api/prisma/schema.prisma` | Modificado | 6 columnas en `Mesa` |
| `apps/api/src/salon/mesas/dto/{create,update}-mesa.dto.ts` | Modificado | campos opcionales nuevos |
| `apps/api/src/salon/mesas/mesas.service.spec.ts` | Modificado | test de persistencia de los campos nuevos |
| `packages/shared/src/index.ts` | Modificado | `Mesa`/`CreateMesaInput`/`UpdateMesaInput` + `posicionPorDefecto` |
| `apps/web/app/salon/page.tsx` | Modificado | plano arrastrable |
| `apps/operativa/src/MozoView.tsx` | Modificado | plano de solo lectura |
| `apps/operativa/src/styles.css` | Modificado | clases del plano (reutilizables desde el `.celda-mesa` ya existente) |

## Risks

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Confundir un click (ciclar estado) con un drag corto | Media | Umbral de desplazamiento (~4px) antes de tratarlo como drag; por debajo, es click |
| Mesa sin posición se ve superpuesta con otra | Baja (aceptado) | `posicionPorDefecto` es determinística por índice — no colisiona entre sí, solo con mesas ya ubicadas manualmente en esa zona, y no se valida (ver Out of Scope) |
| `PATCH /mesas/:id` sigue permitiendo rol `mozo`, no solo `admin` | Baja (preexistente, no introducido por esta iteración) | Fuera de alcance — el guard actual ya era `@Roles(admin, mozo)` antes de este cambio; ajustarlo es una decisión de producto aparte |

## Rollback Plan

- `git revert` remueve las columnas del schema (down-migration lossless, son nullable/con default), los campos del DTO, y el JSX de ambos clientes vuelve a la grilla/lista anterior.

## Dependencies

- Iter 4 (tiempo real) — el drag reutiliza el evento `mesa.actualizada` ya emitido por `MesasService.update`.
- Pase de diseño de `apps/web`/`apps/operativa` (recién hecho) — sin eso, no había con qué renderizar el plano con criterio visual.

## Success Criteria

- [ ] `pnpm --filter api test` verde, con test de persistencia de los campos nuevos.
- [ ] Arrastrar una mesa en `/salon` (web) persiste su posición y la refleja en `apps/operativa` sin recargar (vía el socket de Iter 4).
- [ ] Un click sin arrastre en `/salon` sigue ciclando el estado de la mesa, exactamente como antes.
- [ ] Una mesa recién creada (sin posición) aparece en un lugar determinístico, no superpuesta con otra mesa sin posición.
- [ ] `pnpm build` pasa en modo estricto.
