# Tasks: Iter 6 — Plano 2D del salón

Implementación directa, sin ceremonia de sdd-apply. Strict TDD Mode para la persistencia de los campos nuevos (lógica real); el drag/render en el cliente se verifica manualmente con DevTools.

## 1. Backend: campos espaciales en Mesa (test-first)

- [x] 1.1–1.7 completos — migración generada a mano vía `prisma migrate diff` (mismo camino que Iter 5) y aplicada; DTOs con los 6 campos opcionales; test de persistencia agregado (pasó directo — `MesasService.update` ya era passthrough genérico, protección de regresión real igual); 142 tests verdes

_Satisfies: salon spec (MODIFIED) "Spatial position on the 2D floor plan"._

## 2. packages/shared

- [x] 2.1–2.4 completos — `Mesa`/`CreateMesaInput`/`UpdateMesaInput` con los 6 campos, `posicionPorDefecto`, 3 tests nuevos, build y test verdes (12 tests)

## 3. apps/web — editor arrastrable en /salon

- [x] 3.1–3.4 completos — plano con Pointer Events, umbral de 4px para distinguir click de drag, form extendido con forma/ancho/alto/rotación, botón "Eliminar mesa" movido al form de edición

## 4. apps/operativa — plano de solo lectura en MozoView

- [x] 4.1–4.2 completos — `.plano-salon`/`.mesa-plano` en `styles.css`, RxDB schema de `mesas` actualizado con los 6 campos nuevos

## 5. Verificación

- [x] `pnpm --filter api test` (142) y `pnpm build` (monorepo completo) — verdes
- [x] Verificación end-to-end automatizada (script descartable): crear mesa → defaults correctos (`posX: null`, `forma: "rect"`, `ancho: 70`); `PATCH` con `posX/posY/forma` → persiste y responde con los valores; socket conectado recibe `mesa.actualizada` con los mismos valores; `forma` inválida → 400
- [ ] 5.2 Arrastrar una mesa en `/salon` con el mouse real, soltar, confirmar visualmente que no salta ni se traba
- [ ] 5.3 Con Mozo logueado en paralelo, la mesa se reubica sin recargar
- [ ] 5.4 Un click sin arrastre en `/salon` sigue ciclando `estado` (probado por código, falta el ojo humano)
- [ ] 5.5 Crear una mesa nueva sin posición y ver que aparece en un lugar razonable del plano, no superpuesta
