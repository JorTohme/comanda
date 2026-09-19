import { createPedido, type CreatePedidoInput, type Pedido } from "@comanda/shared";
import { getDb } from "./schema";

interface Tenant {
  orgId: string;
  sucursalId: string;
}

function pedidoOptimista(
  clientRequestId: string,
  input: CreatePedidoInput,
  platos: { id: string; nombre: string; precio: number }[],
  tenant: Tenant,
): Pedido {
  const platoById = new Map(platos.map((plato) => [plato.id, plato]));
  const now = new Date().toISOString();
  return {
    id: clientRequestId,
    tipoServicio: input.tipoServicio,
    mesaId: input.mesaId ?? null,
    plataforma: input.plataforma ?? null,
    direccionEnvio: input.direccionEnvio ?? null,
    estado: "abierto",
    clientRequestId,
    items: input.items.map((item, index) => {
      const plato = platoById.get(item.platoId);
      return {
        id: `${clientRequestId}-item-${index}`,
        pedidoId: clientRequestId,
        platoId: item.platoId,
        nombre: plato?.nombre ?? "",
        precioUnitario: plato?.precio ?? 0,
        cantidad: item.cantidad,
      };
    }),
    orgId: tenant.orgId,
    sucursalId: tenant.sucursalId,
    createdAt: now,
    updatedAt: now,
  };
}

export async function crearPedidoOffline(input: CreatePedidoInput, tenant: Tenant, apiUrl: string): Promise<void> {
  const db = await getDb(tenant.orgId, tenant.sucursalId);
  const clientRequestId = crypto.randomUUID();
  const platos = (await db.collections.platos.find().exec()).map((doc: { toJSON(): { id: string; nombre: string; precio: number } }) => doc.toJSON());
  const optimista = pedidoOptimista(clientRequestId, input, platos, tenant);

  await db.collections.pedidos.upsert(optimista);
  await db.collections.outbox.upsert({
    id: clientRequestId,
    input: JSON.stringify({ ...input, clientRequestId }),
    createdAt: optimista.createdAt,
  });

  await flushOutbox(apiUrl, tenant);
}

export async function flushOutbox(apiUrl: string, tenant: Tenant): Promise<void> {
  const db = await getDb(tenant.orgId, tenant.sucursalId);
  const entradas = await db.collections.outbox.find().exec();

  for (const entrada of entradas) {
    const clientRequestId = entrada.get("id") as string;
    const input = JSON.parse(entrada.get("input") as string) as CreatePedidoInput;

    try {
      const pedidoReal = await createPedido(apiUrl, input);
      await db.collections.pedidos.findOne(clientRequestId).remove();
      await db.collections.pedidos.upsert(pedidoReal);
      await entrada.remove();
    } catch (err) {
      if (err instanceof TypeError) continue; // network failure — leave queued for the next attempt

      // real HTTP/validation error: won't resolve by retrying — clean up and surface it
      await db.collections.pedidos.findOne(clientRequestId).remove();
      await entrada.remove();
      throw err;
    }
  }
}

export function setupAutoSync(apiUrl: string, tenant: Tenant, onError?: (err: unknown) => void): () => void {
  const handler = () => {
    flushOutbox(apiUrl, tenant).catch((err: unknown) => onError?.(err));
  };
  window.addEventListener("online", handler);
  handler();
  return () => window.removeEventListener("online", handler);
}
