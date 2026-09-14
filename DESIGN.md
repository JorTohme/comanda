# Lineamientos de diseño — Consola web (Admin + Caja)

> Línea elegida: **Cálido hospitalidad** (de 3 direcciones exploradas — ver `openspec/changes/iter1-catalogo/` para el contexto de la decisión). Aplica a las pantallas de gestión (Catálogo, Salón, Caja); la app operativa (mozos/KDS) puede requerir su propia densidad por ser táctil/offline-first, a evaluar cuando llegue esa iteración.

## Por qué esta dirección

Frente a "verde documental" (continuidad con `index.html`) y "azul operativo" (denso, tipo SaaS genérico), se eligió la más distintiva de marca para un producto de hospitalidad — el trade-off aceptado es que ocupa más espacio vertical por ítem que una tabla plana.

## Tipografía

- **Display** (títulos, nombres de sección): `Lora` (serif), pesos 500/600/700.
- **Cuerpo** (texto, controles, precios): `Work Sans`, pesos 400/500/600.
- Cargar vía Google Fonts (`fonts.googleapis.com` + `fonts.gstatic.com`), con fallback `serif` / `system-ui, sans-serif` respectivamente.

## Paleta

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#FBF3EA` | Fondo de página (crema cálido) |
| `--surface` | `#FFFFFF` | Tarjetas, superficies elevadas |
| `--ink` | `#2B2118` | Texto principal (marrón oscuro cálido, no negro puro) |
| `--muted` | `#8A7A68` | Texto secundario |
| `--hairline` | `#EDE0D0` | Bordes, separadores |
| `--accent` | `#C1552C` | Terracota — acciones primarias, precios, títulos de sección |
| `--accent-hover` | `#A0431F` | Hover de acento |
| `--secondary` | `#A98600` | Mostaza/oliva — eyebrows, detalles secundarios |
| `--success` | `#16A34A` | Estado "disponible" |
| `--warning` | `#A16207` | Estado "agotado" / atención |

Evitar negro puro y blanco frío — todo el sistema es cálido (crema/terracota), nunca gris azulado.

## Forma y espaciado

- Radio de tarjetas: **16px**. Botones y pills: **999px** (full round).
- Sombra sutil en tarjetas: `0 1px 2px rgba(43,33,24,0.06)` — nunca sombras duras ni gradientes.
- Separadores de sección: línea fina `1px solid var(--hairline)` junto al título, no cajas con borde lateral de color (evitar el patrón "card con borde izquierdo de acento").

## Patrón de layout para pantallas de gestión (Catálogo, Salón, Caja)

- **Agrupar por categoría/sección**, no tabla plana: cada categoría es un bloque con encabezado serif + línea fina, y una grilla de tarjetas (`grid-template-columns: repeat(3, minmax(0,1fr))`, gap 14px) — como un editor de carta de menú, no una hoja de cálculo.
- Cada tarjeta: nombre (serif, 15px, 600), precio destacado en acento, badge de estado con punto de color (`● Disponible` verde / `● Agotado` mostaza), ícono de editar en la esquina.
- Header de pantalla: eyebrow en mayúsculas + `h1` serif + botón primario pill (terracota) a la derecha, sin fila de filtros técnica (no toolbar tipo SaaS).

## Íconos

- SVG inline, trazo (`stroke`), grosor 2-2.2px, grilla 14-16px. **Nunca emoji.**

## Referencia visual

Ver artifact `Catálogo — Direcciones de Diseño` (dirección C, "Cálido hospitalidad") para el mockup completo de la pantalla de Catálogo aplicando estos lineamientos.
