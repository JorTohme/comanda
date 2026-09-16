import { z } from "zod";

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
export const mesaSchema = tenantSchema.extend({ id: z.string().uuid(), nombre: z.string(), capacidad: z.number().int(), estado: estadoMesaSchema, createdAt: timestampSchema, updatedAt: timestampSchema });
export type Mesa = z.infer<typeof mesaSchema>;
export const tipoServicioSchema = z.enum(["mesa", "barra"]);
export type TipoServicio = z.infer<typeof tipoServicioSchema>;
export const estadoPedidoSchema = z.enum(["abierto", "enviado_a_cocina", "en_preparacion", "listo", "entregado", "cobrado", "cerrado"]);
export type EstadoPedido = z.infer<typeof estadoPedidoSchema>;
export const itemPedidoSchema = z.object({ id: z.string().uuid(), pedidoId: z.string().uuid(), platoId: z.string().uuid(), nombre: z.string(), precioUnitario: z.number().int(), cantidad: z.number().int().positive() });
export type ItemPedido = z.infer<typeof itemPedidoSchema>;
export const pedidoSchema = tenantSchema.extend({ id: z.string().uuid(), tipoServicio: tipoServicioSchema, mesaId: z.string().uuid().nullable(), estado: estadoPedidoSchema, items: z.array(itemPedidoSchema), createdAt: timestampSchema, updatedAt: timestampSchema });
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

export type CreateCategoriaInput = { nombre: string };
export type UpdateCategoriaInput = Partial<CreateCategoriaInput>;
export type CreatePlatoInput = { nombre: string; precio: number; categoriaId: string; disponible?: boolean };
export type UpdatePlatoInput = Partial<CreatePlatoInput>;
export type CreateMesaInput = { nombre: string; capacidad: number; estado?: EstadoMesa };
export type UpdateMesaInput = Partial<CreateMesaInput>;
export type CreatePedidoInput = { tipoServicio: TipoServicio; mesaId?: string; items: { platoId: string; cantidad: number }[] };
export type AbrirTurnoInput = { montoInicial: number };
export type CerrarTurnoInput = { montoDeclarado: number };
export type CreateMovimientoInput = { tipo: TipoMovimientoCaja; monto: number; descripcion: string };
export interface ApiOptions { accessToken?: string; }

export const SIGUIENTE_ESTADO_PEDIDO: Record<EstadoPedido, EstadoPedido | null> = {
  abierto: "enviado_a_cocina", enviado_a_cocina: "en_preparacion", en_preparacion: "listo", listo: "entregado", entregado: "cobrado", cobrado: "cerrado", cerrado: null,
};

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

function accessToken(options?: ApiOptions): string | undefined {
  if (options?.accessToken) return options.accessToken;
  const storage = (globalThis as { localStorage?: { getItem(key: string): string | null } }).localStorage;
  return storage?.getItem("comanda.accessToken") ?? undefined;
}

function headers(options?: ApiOptions, json = false): Record<string, string> {
  const token = accessToken(options);
  return { ...(json ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function parseJsonOrThrow<T>(res: Response, schema: z.ZodType<T>, method: string, url: string): Promise<T> {
  if (!res.ok) throw new Error(`Request failed: ${method} ${url} (${res.status})`);
  return schema.parse(await res.json());
}

async function throwIfNotOk(res: Response, method: string, url: string): Promise<void> {
  if (!res.ok) throw new Error(`Request failed: ${method} ${url} (${res.status})`);
}

export async function pingApi(baseUrl: string): Promise<HealthStatus> { const url = `${baseUrl}/health`; return parseJsonOrThrow(await fetch(url), healthStatusSchema, "GET", url); }
export async function listCategorias(baseUrl: string, options?: ApiOptions): Promise<Categoria[]> { const url = `${baseUrl}/categorias`; return parseJsonOrThrow(await fetch(url, { headers: headers(options) }), z.array(categoriaSchema), "GET", url); }
export async function createCategoria(baseUrl: string, input: CreateCategoriaInput, options?: ApiOptions): Promise<Categoria> { const url = `${baseUrl}/categorias`; return parseJsonOrThrow(await fetch(url, { method: "POST", headers: headers(options, true), body: JSON.stringify(input) }), categoriaSchema, "POST", url); }
export async function updateCategoria(baseUrl: string, id: string, input: UpdateCategoriaInput, options?: ApiOptions): Promise<Categoria> { const url = `${baseUrl}/categorias/${id}`; return parseJsonOrThrow(await fetch(url, { method: "PATCH", headers: headers(options, true), body: JSON.stringify(input) }), categoriaSchema, "PATCH", url); }
export async function deleteCategoria(baseUrl: string, id: string, options?: ApiOptions): Promise<void> { const url = `${baseUrl}/categorias/${id}`; return throwIfNotOk(await fetch(url, { method: "DELETE", headers: headers(options) }), "DELETE", url); }
export async function listPlatos(baseUrl: string, categoriaId?: string, options?: ApiOptions): Promise<Plato[]> { const url = categoriaId ? `${baseUrl}/platos?categoriaId=${encodeURIComponent(categoriaId)}` : `${baseUrl}/platos`; return parseJsonOrThrow(await fetch(url, { headers: headers(options) }), z.array(platoSchema), "GET", url); }
export async function createPlato(baseUrl: string, input: CreatePlatoInput, options?: ApiOptions): Promise<Plato> { const url = `${baseUrl}/platos`; return parseJsonOrThrow(await fetch(url, { method: "POST", headers: headers(options, true), body: JSON.stringify(input) }), platoSchema, "POST", url); }
export async function updatePlato(baseUrl: string, id: string, input: UpdatePlatoInput, options?: ApiOptions): Promise<Plato> { const url = `${baseUrl}/platos/${id}`; return parseJsonOrThrow(await fetch(url, { method: "PATCH", headers: headers(options, true), body: JSON.stringify(input) }), platoSchema, "PATCH", url); }
export async function deletePlato(baseUrl: string, id: string, options?: ApiOptions): Promise<void> { const url = `${baseUrl}/platos/${id}`; return throwIfNotOk(await fetch(url, { method: "DELETE", headers: headers(options) }), "DELETE", url); }
export async function listMesas(baseUrl: string, options?: ApiOptions): Promise<Mesa[]> { const url = `${baseUrl}/mesas`; return parseJsonOrThrow(await fetch(url, { headers: headers(options) }), z.array(mesaSchema), "GET", url); }
export async function createMesa(baseUrl: string, input: CreateMesaInput, options?: ApiOptions): Promise<Mesa> { const url = `${baseUrl}/mesas`; return parseJsonOrThrow(await fetch(url, { method: "POST", headers: headers(options, true), body: JSON.stringify(input) }), mesaSchema, "POST", url); }
export async function updateMesa(baseUrl: string, id: string, input: UpdateMesaInput, options?: ApiOptions): Promise<Mesa> { const url = `${baseUrl}/mesas/${id}`; return parseJsonOrThrow(await fetch(url, { method: "PATCH", headers: headers(options, true), body: JSON.stringify(input) }), mesaSchema, "PATCH", url); }
export async function deleteMesa(baseUrl: string, id: string, options?: ApiOptions): Promise<void> { const url = `${baseUrl}/mesas/${id}`; return throwIfNotOk(await fetch(url, { method: "DELETE", headers: headers(options) }), "DELETE", url); }
export async function listPedidos(baseUrl: string, options?: ApiOptions): Promise<Pedido[]> { const url = `${baseUrl}/pedidos`; return parseJsonOrThrow(await fetch(url, { headers: headers(options) }), z.array(pedidoSchema), "GET", url); }
export async function createPedido(baseUrl: string, input: CreatePedidoInput, options?: ApiOptions): Promise<Pedido> { const url = `${baseUrl}/pedidos`; return parseJsonOrThrow(await fetch(url, { method: "POST", headers: headers(options, true), body: JSON.stringify(input) }), pedidoSchema, "POST", url); }
export async function avanzarEstadoPedido(baseUrl: string, id: string, estado: EstadoPedido, options?: ApiOptions): Promise<Pedido> { const url = `${baseUrl}/pedidos/${id}/estado`; return parseJsonOrThrow(await fetch(url, { method: "PATCH", headers: headers(options, true), body: JSON.stringify({ estado }) }), pedidoSchema, "PATCH", url); }
export async function abrirTurno(baseUrl: string, input: AbrirTurnoInput, options?: ApiOptions): Promise<TurnoCaja> { const url = `${baseUrl}/caja/turnos`; return parseJsonOrThrow(await fetch(url, { method: "POST", headers: headers(options, true), body: JSON.stringify(input) }), turnoCajaSchema, "POST", url); }
export async function obtenerTurnoActual(baseUrl: string, options?: ApiOptions): Promise<TurnoCajaDetalle | null> { const url = `${baseUrl}/caja/turnos/actual`; return parseJsonOrThrow(await fetch(url, { headers: headers(options) }), turnoCajaDetalleSchema.nullable(), "GET", url); }
export async function listTurnos(baseUrl: string, options?: ApiOptions): Promise<TurnoCaja[]> { const url = `${baseUrl}/caja/turnos`; return parseJsonOrThrow(await fetch(url, { headers: headers(options) }), z.array(turnoCajaSchema), "GET", url); }
export async function obtenerTurno(baseUrl: string, id: string, options?: ApiOptions): Promise<TurnoCajaDetalle> { const url = `${baseUrl}/caja/turnos/${id}`; return parseJsonOrThrow(await fetch(url, { headers: headers(options) }), turnoCajaDetalleSchema, "GET", url); }
export async function registrarMovimiento(baseUrl: string, turnoId: string, input: CreateMovimientoInput, options?: ApiOptions): Promise<MovimientoCaja> { const url = `${baseUrl}/caja/turnos/${turnoId}/movimientos`; return parseJsonOrThrow(await fetch(url, { method: "POST", headers: headers(options, true), body: JSON.stringify(input) }), movimientoCajaSchema, "POST", url); }
export async function cerrarTurno(baseUrl: string, id: string, input: CerrarTurnoInput, options?: ApiOptions): Promise<TurnoCaja> { const url = `${baseUrl}/caja/turnos/${id}/cerrar`; return parseJsonOrThrow(await fetch(url, { method: "PATCH", headers: headers(options, true), body: JSON.stringify(input) }), turnoCajaSchema, "PATCH", url); }

export const rolUsuarioSchema = z.enum(["admin", "caja", "mozo", "cocina"]);
export type RolUsuario = z.infer<typeof rolUsuarioSchema>;
export const authSessionSchema = z.object({
  accessToken: z.string().min(1),
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
