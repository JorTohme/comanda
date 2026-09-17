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

---

# Lineamientos de diseño — App operativa (Mozo + Cocina)

> Línea elegida: **"Organic"** (cream/arena + terracota + sage). Aplica a `apps/operativa` (PWA táctil, offline-first): celular para mozos, tablet fija para cocina — densidad y tamaños de tap target propios, distintos de la consola web.

## Tipografía

- **Display** (números, títulos cortos: nombre de mesa, precio, hora, contadores, texto de botón): `Caprasimo`, peso 400 único.
- **Cuerpo** (todo el resto): `Figtree`, pesos 600–900. El peso 400 casi no se usa — es una herramienta de trabajo, no de lectura.
- Cargar vía Google Fonts.

## Paleta y tokens

| Token | Valor | Uso |
|---|---|---|
| `--color-bg` | `#f5ead8` | Fondo de página |
| `--color-surface` | `#ebddc5` | Tarjetas, superficies |
| `--color-text` | `#201e1d` | Texto principal |
| `--color-accent` (terracota) | `#c67139` | Acciones primarias |
| `--color-accent-2` (sage) | `#7a8a5e` | Estado "listo", acentos secundarios |

Rampas tonales (OKLCH, misma escala de luminosidad entre roles): `--color-neutral-100..900`, `--color-accent-100..900`, `--color-accent-2-100..900` — valores completos en el historial de este cambio, no re-derivar a mano.

**Estados semánticos** (agregar como tokens nuevos, no están en la rampa base):

| Token | Hex | Uso |
|---|---|---|
| `state-abierto` | `#a19786` | Pedido armándose, no enviado |
| `state-cocina` / `state-cocina-ink` | `#c9951a` / `#2e2201` | Enviado a cocina, sin empezar |
| `state-prep` | `#c67139` (= accent) | En preparación |
| `state-listo` | `#728157` | Listo, esperando retiro |
| `state-entregado` | contorno neutral-400 | Cerrado, opacidad 65% |
| `state-alerta` | `#b1402f` | Demorado (>12′) |

## Espaciado, radios, sombras

- Espaciado: `--space-1` 4.4px · `-2` 8.8 · `-3` 13.2 · `-4` 17.6 · `-6` 26.4 · `-8` 35.2.
- Radios: `--radius-sm` 8px · `--radius-md` 16px · `--radius-lg` 28px. Todo lo que se toca (botones, inputs, tags) es píldora (`999px`).
- Sombras: `--shadow-sm/md/lg`, ink-tinted (`color-mix` con `#2e2b25`), nunca negro puro.

## Directivas que sobreviven a cualquier pantalla

1. **Estado = color + forma, nunca solo texto.** Cada estado (de pedido y de mesa) tiene un color fijo e igual en todas las vistas.
2. **Tap targets mínimo 44px; los de acción real, 52–60px.** Botones que avanzan un estado ocupan el ancho completo de su tarjeta.
3. **Sin texto chico en cocina.** En tablet, mínimo absoluto 16px (solo metadata); platos a 23px+, nombre de mesa a 27px+.
4. **Alto contraste sobre color.** Tinta a opacidad plena sobre rellenos — nunca alpha ni `color-mix` para "suavizar" texto.
5. **Una acción primaria por tarjeta.** Acciones secundarias van outline.
6. **Sin relleno decorativo.** Nada de iconografía decorativa, gradientes, ni métricas que el personal no necesita durante el servicio.
7. **Iconos:** Lucide, `stroke-width: 2.75`. Sin imágenes ni ilustraciones — la interfaz es tipográfica y de color.

## Tabla de estados (referencia central para cualquier implementación futura)

| Estado del pedido | Color | Lectura |
|---|---|---|
| Abierto | `#a19786` | Borde/chip gris arena |
| Enviado a cocina | `#c9951a` | Borde/chip ámbar; columna NUEVOS en KDS |
| En preparación | `#c67139` | Borde/chip terracota; columna central en KDS |
| Listo | `#728157` | Borde/chip sage; columna derecha en KDS |
| Entregado | contorno neutral | Opacidad 65%, sin acción |

| Estado de mesa | Lectura |
|---|---|
| Libre | Relleno neutral-100, borde punteado 2px neutral-400 |
| Ocupada (sin pedido enviado) | Relleno `#f7e9c4`, borde 2px `#c9951a` |
| Pedido en curso | Relleno terracota pleno, tinta crema |
| Algo listo para levantar | Mismo relleno + anillo exterior sage `box-shadow: 0 0 0 3px #728157` |

## Pendiente de decisión

- Fondo del KDS (tablet cocina): oscuro vs. claro — mismo sistema de tokens, dos variantes de superficie. Sin resolver todavía.

> Nota: esta sección resume tokens y reglas, no la implementación pantalla por pantalla — eso se define cuando se aborde la iteración de diseño de `apps/operativa`.
