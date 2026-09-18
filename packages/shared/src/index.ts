import { z } from "zod";
import { io, type Socket } from "socket.io-client";

export const healthStatusSchema = z.object({ status: z.enum(["ok", "error"]) });
export type HealthStatus = z.infer<typeof healthStatusSchema>;

const tenantSchema = z.object({ orgId: z.string().uuid(), sucursalId: z.string().uuid() });
const timestampSchema = z.string().datetime();
export const categoriaSchema = tenantSchema.extend({ id: z.string().uuid(), nombre: z.string(), createdAt: timestampSchema, updatedAt: timestampSchema });
export type Categoria = z.infer<typeof categoriaSchema>;
export const platoSchema = tenantSchema.extend({ id: z.string().uuid(), nombre: z.string(), precio: z.number().int(), disponible: z.boolean(), categoriaId: z.string().uuid(), createdAt: timestampSchema, updatedAt: timestampSchema });
export type Plato = z.infer<typeof platoSchema>;
export const estadoMesaSchema = z.enum(["libre", "ocupada", "pedido_en_curso"]);
export type EstadoMesa = z.infer<typeof estadoMesaSchema>;
export const formaMesaSchema = z.enum(["rect", "circle"]);
export type FormaMesa = z.infer<typeof formaMesaSchema>;
export const mesaSchema = tenantSchema.extend({
  id: z.string().uuid(),
  nombre: z.string(),
  capacidad: z.number().int(),
  estado: estadoMesaSchema,
  posX: z.number().nullable().optional(),
  posY: z.number().nullable().optional(),
  rotacion: z.number().nullable().optional(),
  forma: formaMesaSchema.nullable().optional(),
  ancho: z.number().nullable().optional(),
  alto: z.number().nullable().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Mesa = z.infer<typeof mesaSchema>;
export const tipoServicioSchema = z.enum(["mesa", "barra", "takeaway", "delivery"]);
export type TipoServicio = z.infer<typeof tipoServicioSchema>;
export const estadoPedidoSchema = z.enum(["abierto", "enviado_a_cocina", "en_preparacion", "listo", "en_camino", "entregado", "cobrado", "cerrado"]);
export type EstadoPedido = z.infer<typeof estadoPedidoSchema>;
export const itemPedidoSchema = z.object({ id: z.string().uuid(), pedidoId: z.string().uuid(), platoId: z.string().uuid(), nombre: z.string(), precioUnitario: z.number().int(), cantidad: z.number().int().positive() });
export type ItemPedido = z.infer<typeof itemPedidoSchema>;
export const pedidoSchema = tenantSchema.extend({ id: z.string().uuid(), tipoServicio: tipoServicioSchema, mesaId: z.string().uuid().nullable(), plataforma: z.string().nullable(), direccionEnvio: z.string().nullable(), estado: estadoPedidoSchema, items: z.array(itemPedidoSchema), clientRequestId: z.string().nullable().optional(), createdAt: timestampSchema, updatedAt: timestampSchema });
export type Pedido = z.infer<typeof pedidoSchema>;
export const estadoTurnoCajaSchema = z.enum(["abierto", "cerrado"]);
export type EstadoTurnoCaja = z.infer<typeof estadoTurnoCajaSchema>;
export const tipoMovimientoCajaSchema = z.enum(["ingreso", "egreso"]);
export type TipoMovimientoCaja = z.infer<typeof tipoMovimientoCajaSchema>;
export const movimientoCajaSchema = z.object({ id: z.string().uuid(), turnoCajaId: z.string().uuid(), tipo: tipoMovimientoCajaSchema, monto: z.number().int(), descripcion: z.string(), createdAt: timestampSchema });
export type MovimientoCaja = z.infer<typeof movimientoCajaSchema>;
export const turnoCajaSchema = tenantSchema.extend({ id: z.string().uuid(), estado: estadoTurnoCajaSchema, montoInicial: z.number().int(), abiertoPorId: z.string().uuid(), abiertoEn: timestampSchema, cerradoPorId: z.string().uuid().nullable(), cerradoEn: timestampSchema.nullable(), montoDeclarado: z.number().int().nullable(), totalCalculado: z.number().int().nullable(), diferencia: z.number().int().nullable(), createdAt: timestampSchema, updatedAt: timestampSchema });
export type TurnoCaja = z.infer<typeof turnoCajaSchema>;
export const turnoCajaDetalleSchema = turnoCajaSchema.extend({ movimientos: z.array(movimientoCajaSchema), pedidos: z.array(pedidoSchema), totalCalculado: z.number().int() });
export type TurnoCajaDetalle = z.infer<typeof turnoCajaDetalleSchema>;
export const estadoPagoSchema = z.enum(["pendiente", "aprobado", "rechazado"]);
export type EstadoPago = z.infer<typeof estadoPagoSchema>;
export const pagoSchema = tenantSchema.extend({
  id: z.string().uuid(),
  pedidoId: z.string().uuid(),
  mpPaymentId: z.string().nullable(),
  mpPreferenceId: z.string(),
  mpInitPoint: z.string(),
  estado: estadoPagoSchema,
  monto: z.number().int(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Pago = z.infer<typeof pagoSchema>;

export const sucursalSchema = z.object({
  id: z.string().uuid(),
  nombre: z.string(),
  organizacionId: z.string().uuid(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Sucursal = z.infer<typeof sucursalSchema>;

export type CreateCategoriaInput = { nombre: string };
export type UpdateCategoriaInput = Partial<CreateCategoriaInput>;
export type CreatePlatoInput = { nombre: string; precio: number; categoriaId: string; disponible?: boolean };
export type UpdatePlatoInput = Partial<CreatePlatoInput>;
export type CreateMesaInput = {
  nombre: string;
  capacidad: number;
  estado?: EstadoMesa;
  posX?: number;
  posY?: number;
  rotacion?: number;
  forma?: FormaMesa;
  ancho?: number;
  alto?: number;
};
export type UpdateMesaInput = Partial<CreateMesaInput>;

export function posicionPorDefecto(index: number): { x: number; y: number } {
  const columnas = 5;
  const paso = 100 / columnas;
  return {
    x: (index % columnas) * paso + paso / 2,
    y: Math.floor(index / columnas) * 18 + 12,
  };
}
export type CreatePedidoInput = { tipoServicio: TipoServicio; mesaId?: string; plataforma?: string; direccionEnvio?: string; items: { platoId: string; cantidad: number }[]; clientRequestId?: string };
export type AbrirTurnoInput = { montoInicial: number };
export type CerrarTurnoInput = { montoDeclarado: number };
export type CreateMovimientoInput = { tipo: TipoMovimientoCaja; monto: number; descripcion: string };
export type CreateSucursalInput = { nombre: string };
export interface ApiOptions { accessToken?: string; }

// Static "what's next" chain for the client-side UX hint. Does not know about self-delivery
// branching (listo -> en_camino) — the backend is the source of truth for valid transitions.
// See siguienteEstadoPedido() for the pedido-aware version used by the caja UI.
export const SIGUIENTE_ESTADO_PEDIDO: Record<EstadoPedido, EstadoPedido | null> = {
  abierto: "enviado_a_cocina", enviado_a_cocina: "en_preparacion", en_preparacion: "listo", listo: "entregado", en_camino: "entregado", entregado: "cobrado", cobrado: "cerrado", cerrado: null,
};

export function siguienteEstadoPedido(pedido: Pick<Pedido, "estado" | "tipoServicio" | "direccionEnvio">): EstadoPedido | null {
  const esAutoDelivery = pedido.tipoServicio === "delivery" && pedido.direccionEnvio != null;
  if (pedido.estado === "listo" && esAutoDelivery) return "en_camino";
  return SIGUIENTE_ESTADO_PEDIDO[pedido.estado];
}

export function centavosToPesos(centavos: number): string {
  const negative = centavos < 0;
  const abs = Math.trunc(Math.abs(centavos));
  return `${negative ? "-" : ""}${Math.trunc(abs / 100)}.${(abs % 100).toString().padStart(2, "0")}`;
}

export function pesosToCentavos(pesos: string): number {
  const trimmed = pesos.trim();
  const negative = trimmed.startsWith("-");
  const [enteroRaw, decimalRaw = ""] = (negative ? trimmed.slice(1) : trimmed).split(".");
  const total = (enteroRaw === "" ? 0 : Number.parseInt(enteroRaw, 10)) * 100 + Number.parseInt((decimalRaw + "00").slice(0, 2), 10);
  return negative ? -total : total;
}

function readLocalStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } | undefined {
  return (globalThis as { localStorage?: ReturnType<typeof readLocalStorage> }).localStorage;
}

function accessToken(options?: ApiOptions): string | undefined {
  if (options?.accessToken) return options.accessToken;
  return readLocalStorage()?.getItem("comanda.accessToken") ?? undefined;
}

function storedRefreshToken(): string | undefined {
  return readLocalStorage()?.getItem("comanda.refreshToken") ?? undefined;
}

function headers(options?: ApiOptions, json = false): Record<string, string> {
  const token = accessToken(options);
  return { ...(json ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function parseJsonOrThrow<T>(res: Response, schema: z.ZodType<T>, method: string, url: string): Promise<T> {
  if (!res.ok) throw new Error(`Request failed: ${method} ${url} (${res.status})`);
  const text = await res.text();
  return schema.parse(text === "" ? null : JSON.parse(text));
}

async function throwIfNotOk(res: Response, method: string, url: string): Promise<void> {
  if (!res.ok) throw new Error(`Request failed: ${method} ${url} (${res.status})`);
}

let sessionExpiredHandler: (() => void) | undefined;

export function setSessionExpiredHandler(handler: () => void): void {
  sessionExpiredHandler = handler;
}

function clearSessionAndNotify(): void {
  const storage = readLocalStorage();
  storage?.removeItem("comanda.accessToken");
  storage?.removeItem("comanda.refreshToken");
  storage?.removeItem("comanda.user");
  sessionExpiredHandler?.();
}

// Reads the sucursalId hint out of a JWT payload without verifying its signature — only ever
// used to pick a refresh hint, never for authentication. The tokens this app issues carry only
// ASCII (uuids, an enum, numeric timestamps), so a plain atob is enough.
function decodeJwtPayload(token: string): { sucursalId?: string } | null {
  try {
    const body = token.split(".")[1];
    if (!body) return null;
    return JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

// Single-retry 401 interceptor: relies on the module-level stored tokens, so it only
// engages when the caller didn't bring their own accessToken (those manage their own lifecycle).
async function apiFetch(url: string, init: RequestInit, options?: ApiOptions): Promise<Response> {
  const res = await fetch(url, { ...init, headers: headers(options, Boolean(init.body)) });
  if (res.status !== 401 || options?.accessToken) return res;

  const refresh = storedRefreshToken();
  if (!refresh) {
    clearSessionAndNotify();
    return res;
  }

  try {
    const expiringToken = accessToken(options);
    const hint = expiringToken ? decodeJwtPayload(expiringToken)?.sucursalId : undefined;
    const session = await refreshSession(new URL(url).origin, refresh, hint);
    const storage = readLocalStorage();
    storage?.setItem("comanda.accessToken", session.accessToken);
    storage?.setItem("comanda.refreshToken", session.refreshToken);
    storage?.setItem("comanda.user", JSON.stringify(session.user));
    const retry = await fetch(url, { ...init, headers: headers(options, Boolean(init.body)) });
    if (retry.status === 401) clearSessionAndNotify();
    return retry;
  } catch (err) {
    clearSessionAndNotify();
    throw err;
  }
}

export async function pingApi(baseUrl: string): Promise<HealthStatus> { const url = `${baseUrl}/health`; return parseJsonOrThrow(await fetch(url), healthStatusSchema, "GET", url); }
export async function listCategorias(baseUrl: string, options?: ApiOptions): Promise<Categoria[]> { const url = `${baseUrl}/categorias`; return parseJsonOrThrow(await apiFetch(url, {}, options), z.array(categoriaSchema), "GET", url); }
export async function createCategoria(baseUrl: string, input: CreateCategoriaInput, options?: ApiOptions): Promise<Categoria> { const url = `${baseUrl}/categorias`; return parseJsonOrThrow(await apiFetch(url, { method: "POST", body: JSON.stringify(input) }, options), categoriaSchema, "POST", url); }
export async function updateCategoria(baseUrl: string, id: string, input: UpdateCategoriaInput, options?: ApiOptions): Promise<Categoria> { const url = `${baseUrl}/categorias/${id}`; return parseJsonOrThrow(await apiFetch(url, { method: "PATCH", body: JSON.stringify(input) }, options), categoriaSchema, "PATCH", url); }
export async function deleteCategoria(baseUrl: string, id: string, options?: ApiOptions): Promise<void> { const url = `${baseUrl}/categorias/${id}`; return throwIfNotOk(await apiFetch(url, { method: "DELETE" }, options), "DELETE", url); }
export async function listPlatos(baseUrl: string, categoriaId?: string, options?: ApiOptions): Promise<Plato[]> { const url = categoriaId ? `${baseUrl}/platos?categoriaId=${encodeURIComponent(categoriaId)}` : `${baseUrl}/platos`; return parseJsonOrThrow(await apiFetch(url, {}, options), z.array(platoSchema), "GET", url); }
export async function createPlato(baseUrl: string, input: CreatePlatoInput, options?: ApiOptions): Promise<Plato> { const url = `${baseUrl}/platos`; return parseJsonOrThrow(await apiFetch(url, { method: "POST", body: JSON.stringify(input) }, options), platoSchema, "POST", url); }
export async function updatePlato(baseUrl: string, id: string, input: UpdatePlatoInput, options?: ApiOptions): Promise<Plato> { const url = `${baseUrl}/platos/${id}`; return parseJsonOrThrow(await apiFetch(url, { method: "PATCH", body: JSON.stringify(input) }, options), platoSchema, "PATCH", url); }
export async function deletePlato(baseUrl: string, id: string, options?: ApiOptions): Promise<void> { const url = `${baseUrl}/platos/${id}`; return throwIfNotOk(await apiFetch(url, { method: "DELETE" }, options), "DELETE", url); }
export async function listMesas(baseUrl: string, options?: ApiOptions): Promise<Mesa[]> { const url = `${baseUrl}/mesas`; return parseJsonOrThrow(await apiFetch(url, {}, options), z.array(mesaSchema), "GET", url); }
export async function createMesa(baseUrl: string, input: CreateMesaInput, options?: ApiOptions): Promise<Mesa> { const url = `${baseUrl}/mesas`; return parseJsonOrThrow(await apiFetch(url, { method: "POST", body: JSON.stringify(input) }, options), mesaSchema, "POST", url); }
export async function updateMesa(baseUrl: string, id: string, input: UpdateMesaInput, options?: ApiOptions): Promise<Mesa> { const url = `${baseUrl}/mesas/${id}`; return parseJsonOrThrow(await apiFetch(url, { method: "PATCH", body: JSON.stringify(input) }, options), mesaSchema, "PATCH", url); }
export async function deleteMesa(baseUrl: string, id: string, options?: ApiOptions): Promise<void> { const url = `${baseUrl}/mesas/${id}`; return throwIfNotOk(await apiFetch(url, { method: "DELETE" }, options), "DELETE", url); }
export async function listPedidos(baseUrl: string, options?: ApiOptions): Promise<Pedido[]> { const url = `${baseUrl}/pedidos`; return parseJsonOrThrow(await apiFetch(url, {}, options), z.array(pedidoSchema), "GET", url); }
export async function createPedido(baseUrl: string, input: CreatePedidoInput, options?: ApiOptions): Promise<Pedido> { const url = `${baseUrl}/pedidos`; return parseJsonOrThrow(await apiFetch(url, { method: "POST", body: JSON.stringify(input) }, options), pedidoSchema, "POST", url); }
export async function avanzarEstadoPedido(baseUrl: string, id: string, estado: EstadoPedido, options?: ApiOptions): Promise<Pedido> { const url = `${baseUrl}/pedidos/${id}/estado`; return parseJsonOrThrow(await apiFetch(url, { method: "PATCH", body: JSON.stringify({ estado }) }, options), pedidoSchema, "PATCH", url); }
export async function abrirTurno(baseUrl: string, input: AbrirTurnoInput, options?: ApiOptions): Promise<TurnoCaja> { const url = `${baseUrl}/caja/turnos`; return parseJsonOrThrow(await apiFetch(url, { method: "POST", body: JSON.stringify(input) }, options), turnoCajaSchema, "POST", url); }
export async function obtenerTurnoActual(baseUrl: string, options?: ApiOptions): Promise<TurnoCajaDetalle | null> { const url = `${baseUrl}/caja/turnos/actual`; return parseJsonOrThrow(await apiFetch(url, {}, options), turnoCajaDetalleSchema.nullable(), "GET", url); }
export async function listTurnos(baseUrl: string, options?: ApiOptions): Promise<TurnoCaja[]> { const url = `${baseUrl}/caja/turnos`; return parseJsonOrThrow(await apiFetch(url, {}, options), z.array(turnoCajaSchema), "GET", url); }
export async function obtenerTurno(baseUrl: string, id: string, options?: ApiOptions): Promise<TurnoCajaDetalle> { const url = `${baseUrl}/caja/turnos/${id}`; return parseJsonOrThrow(await apiFetch(url, {}, options), turnoCajaDetalleSchema, "GET", url); }
export async function registrarMovimiento(baseUrl: string, turnoId: string, input: CreateMovimientoInput, options?: ApiOptions): Promise<MovimientoCaja> { const url = `${baseUrl}/caja/turnos/${turnoId}/movimientos`; return parseJsonOrThrow(await apiFetch(url, { method: "POST", body: JSON.stringify(input) }, options), movimientoCajaSchema, "POST", url); }
export async function cerrarTurno(baseUrl: string, id: string, input: CerrarTurnoInput, options?: ApiOptions): Promise<TurnoCaja> { const url = `${baseUrl}/caja/turnos/${id}/cerrar`; return parseJsonOrThrow(await apiFetch(url, { method: "PATCH", body: JSON.stringify(input) }, options), turnoCajaSchema, "PATCH", url); }
export async function listSucursales(baseUrl: string, options?: ApiOptions): Promise<Sucursal[]> { const url = `${baseUrl}/sucursales`; return parseJsonOrThrow(await apiFetch(url, {}, options), z.array(sucursalSchema), "GET", url); }
export async function crearSucursal(baseUrl: string, input: CreateSucursalInput, options?: ApiOptions): Promise<Sucursal> { const url = `${baseUrl}/sucursales`; return parseJsonOrThrow(await apiFetch(url, { method: "POST", body: JSON.stringify(input) }, options), sucursalSchema, "POST", url); }

const preferenciaPagoSchema = z.object({ initPoint: z.string(), preferenceId: z.string() });
export async function crearPreferenciaPago(baseUrl: string, pedidoId: string, options?: ApiOptions): Promise<{ initPoint: string; preferenceId: string }> { const url = `${baseUrl}/pagos/preferencia`; return parseJsonOrThrow(await apiFetch(url, { method: "POST", body: JSON.stringify({ pedidoId }) }, options), preferenciaPagoSchema, "POST", url); }

export const ventaDiariaSchema = z.object({ fecha: z.string(), total: z.number().int() });
export type VentaDiaria = z.infer<typeof ventaDiariaSchema>;
export const platoRankingSchema = z.object({ platoId: z.string().uuid(), nombre: z.string(), cantidad: z.number().int() });
export type PlatoRanking = z.infer<typeof platoRankingSchema>;
export const horaPicoSchema = z.object({ hora: z.number().int(), pedidos: z.number().int() });
export type HoraPico = z.infer<typeof horaPicoSchema>;
export const reportesSchema = z.object({
  ventasPorDia: z.array(ventaDiariaSchema),
  platosMasPedidos: z.array(platoRankingSchema),
  horasPico: z.array(horaPicoSchema),
});
export type Reportes = z.infer<typeof reportesSchema>;
export async function obtenerReportes(baseUrl: string, desde: string, hasta: string, options?: ApiOptions): Promise<Reportes> {
  const url = `${baseUrl}/reportes?desde=${desde}&hasta=${hasta}`;
  return parseJsonOrThrow(await apiFetch(url, {}, options), reportesSchema, "GET", url);
}

export const reportesConsolidadoSchema = z.array(
  reportesSchema.extend({ sucursalId: z.string().uuid(), sucursalNombre: z.string() }),
);
export type ReportesConsolidado = z.infer<typeof reportesConsolidadoSchema>;
export async function obtenerReportesConsolidado(baseUrl: string, desde: string, hasta: string, options?: ApiOptions): Promise<ReportesConsolidado> {
  const url = `${baseUrl}/reportes/consolidado?desde=${desde}&hasta=${hasta}`;
  return parseJsonOrThrow(await apiFetch(url, {}, options), reportesConsolidadoSchema, "GET", url);
}

export const rolUsuarioSchema = z.enum(["admin", "caja", "mozo", "cocina"]);
export type RolUsuario = z.infer<typeof rolUsuarioSchema>;
export const authSessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  user: tenantSchema.extend({ id: z.string().uuid(), nombre: z.string(), email: z.string().email(), rol: rolUsuarioSchema }),
});
export type AuthSession = z.infer<typeof authSessionSchema>;
export async function login(baseUrl: string, input: { email: string; password: string }): Promise<AuthSession> {
  const url = `${baseUrl}/auth/login`;
  return parseJsonOrThrow(await fetch(url, { method: "POST", headers: headers(undefined, true), body: JSON.stringify(input) }), authSessionSchema, "POST", url);
}
export async function register(baseUrl: string, input: { organizacionNombre: string; sucursalNombre: string; nombre: string; email: string; password: string; rol?: RolUsuario }): Promise<AuthSession> {
  const url = `${baseUrl}/auth/register`;
  return parseJsonOrThrow(await fetch(url, { method: "POST", headers: headers(undefined, true), body: JSON.stringify(input) }), authSessionSchema, "POST", url);
}
export async function refreshSession(baseUrl: string, refreshToken: string, sucursalIdHint?: string): Promise<AuthSession> {
  const url = `${baseUrl}/auth/refresh`;
  return parseJsonOrThrow(await fetch(url, { method: "POST", headers: headers(undefined, true), body: JSON.stringify({ refreshToken, sucursalIdHint }) }), authSessionSchema, "POST", url);
}
export async function logout(baseUrl: string, refreshToken: string): Promise<void> {
  const url = `${baseUrl}/auth/logout`;
  return throwIfNotOk(await fetch(url, { method: "POST", headers: headers(undefined, true), body: JSON.stringify({ refreshToken }) }), "POST", url);
}
// Only admins call this; the caller must be authenticated (unlike login/register/refresh/logout).
export async function switchSucursal(baseUrl: string, sucursalId: string, options?: ApiOptions): Promise<AuthSession> {
  const url = `${baseUrl}/auth/switch-sucursal`;
  return parseJsonOrThrow(await apiFetch(url, { method: "POST", body: JSON.stringify({ sucursalId }) }, options), authSessionSchema, "POST", url);
}

export type { Socket };
export function connectRealtime(baseUrl: string, accessToken: string): Socket {
  return io(baseUrl, { auth: { token: accessToken }, transports: ["websocket"] });
}
