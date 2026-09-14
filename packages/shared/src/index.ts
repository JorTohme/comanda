export interface HealthStatus {
  status: "ok" | "error";
}

/**
 * Fetches GET {baseUrl}/health and returns the parsed status.
 * Shared by web and operativa so neither hand-rolls its own health fetch.
 */
export async function pingApi(baseUrl: string): Promise<HealthStatus> {
  const res = await fetch(`${baseUrl}/health`);
  if (!res.ok) {
    return { status: "error" };
  }
  return (await res.json()) as HealthStatus;
}

export interface Categoria {
  id: string;
  nombre: string;
  orgId: string | null;
  sucursalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Plato {
  id: string;
  nombre: string;
  precio: number; // centavos
  disponible: boolean;
  categoriaId: string;
  orgId: string | null;
  sucursalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateCategoriaInput = { nombre: string };
export type UpdateCategoriaInput = Partial<CreateCategoriaInput>;
export type CreatePlatoInput = { nombre: string; precio: number; categoriaId: string; disponible?: boolean };
export type UpdatePlatoInput = Partial<CreatePlatoInput>;

/**
 * Formats an integer number of centavos as a two-decimal peso string.
 * Pure integer arithmetic — never routes through float multiplication/division,
 * so it can't introduce the rounding drift float conversion would.
 * 1550 -> "15.50"
 */
export function centavosToPesos(centavos: number): string {
  const negative = centavos < 0;
  const abs = Math.trunc(Math.abs(centavos));
  const pesos = Math.trunc(abs / 100);
  const decimales = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${pesos}.${decimales}`;
}

/**
 * Parses a peso string (e.g. from a form input) into an integer number of centavos.
 * String-based, no float multiplication, so "15.1" can't drift to 1509.999...
 * "15.50" -> 1550
 */
export function pesosToCentavos(pesos: string): number {
  const trimmed = pesos.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [enteroRaw, decimalRaw = ""] = unsigned.split(".");
  const entero = enteroRaw === "" ? 0 : Number.parseInt(enteroRaw, 10);
  const decimales = Number.parseInt((decimalRaw + "00").slice(0, 2), 10);
  const total = entero * 100 + decimales;
  return negative ? -total : total;
}

async function parseJsonOrThrow<T>(res: Response, method: string, url: string): Promise<T> {
  if (!res.ok) {
    throw new Error(`Request failed: ${method} ${url} (${res.status})`);
  }
  return (await res.json()) as T;
}

async function throwIfNotOk(res: Response, method: string, url: string): Promise<void> {
  if (!res.ok) {
    throw new Error(`Request failed: ${method} ${url} (${res.status})`);
  }
}

export async function listCategorias(baseUrl: string): Promise<Categoria[]> {
  const url = `${baseUrl}/categorias`;
  const res = await fetch(url);
  return parseJsonOrThrow<Categoria[]>(res, "GET", url);
}

export async function createCategoria(baseUrl: string, input: CreateCategoriaInput): Promise<Categoria> {
  const url = `${baseUrl}/categorias`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<Categoria>(res, "POST", url);
}

export async function updateCategoria(
  baseUrl: string,
  id: string,
  input: UpdateCategoriaInput,
): Promise<Categoria> {
  const url = `${baseUrl}/categorias/${id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<Categoria>(res, "PATCH", url);
}

export async function deleteCategoria(baseUrl: string, id: string): Promise<void> {
  const url = `${baseUrl}/categorias/${id}`;
  const res = await fetch(url, { method: "DELETE" });
  return throwIfNotOk(res, "DELETE", url);
}

export async function listPlatos(baseUrl: string, categoriaId?: string): Promise<Plato[]> {
  const url = categoriaId
    ? `${baseUrl}/platos?categoriaId=${encodeURIComponent(categoriaId)}`
    : `${baseUrl}/platos`;
  const res = await fetch(url);
  return parseJsonOrThrow<Plato[]>(res, "GET", url);
}

export async function createPlato(baseUrl: string, input: CreatePlatoInput): Promise<Plato> {
  const url = `${baseUrl}/platos`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<Plato>(res, "POST", url);
}

export async function updatePlato(baseUrl: string, id: string, input: UpdatePlatoInput): Promise<Plato> {
  const url = `${baseUrl}/platos/${id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<Plato>(res, "PATCH", url);
}

export async function deletePlato(baseUrl: string, id: string): Promise<void> {
  const url = `${baseUrl}/platos/${id}`;
  const res = await fetch(url, { method: "DELETE" });
  return throwIfNotOk(res, "DELETE", url);
}
