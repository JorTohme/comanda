import { createPedido, pedidoSchema, type CreatePedidoInput, type Pedido, type TenantContext } from "@comanda/shared";
import { getDb, type OutboxEntry } from "./schema";
import { assessLegacyCommand, branchDatabaseName } from "./legacy-recovery";

function pedidoOptimista(
  clientRequestId: string,
  input: CreatePedidoInput,
  platos: { id: string; nombre: string; precio: number }[],
  tenant: TenantContext,
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
    version: 0,
    cobro: null,
    clientRequestId,
    items: input.items.map((item, index) => {
      const plato = platoById.get(item.platoId);
      return {
        id: crypto.randomUUID(),
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

export async function crearPedidoOffline(input: CreatePedidoInput, tenant: TenantContext, apiUrl: string): Promise<void> {
  const db = await getDb(tenant.orgId, tenant.sucursalId);
  const clientRequestId = crypto.randomUUID();
  const platos = (await db.collections.platos.find().exec()).map((doc: { toJSON(): { id: string; nombre: string; precio: number } }) => doc.toJSON());
  const optimista = pedidoOptimista(clientRequestId, input, platos, tenant);

  await db.collections.outbox.upsert({
    id: clientRequestId,
    orgId: tenant.orgId,
    sucursalId: tenant.sucursalId,
    input: JSON.stringify({ ...input, clientRequestId }),
    optimistic: JSON.stringify(optimista),
    status: "pending",
    createdAt: optimista.createdAt,
    attempts: 0,
    retryAt: 0,
    errorCode: null,
    errorMessage: null,
    legacyRaw: "",
  } satisfies OutboxEntry);
  await db.collections.pedidos.upsert(optimista);

  await flushOutbox(apiUrl, tenant);
}

function documentData<T>(document: { toJSON?: () => unknown; get?: (key: string) => unknown }): T {
  if (document.toJSON) return document.toJSON() as T;
  const read = (key: string) => document.get?.(key);
  return { id: read("id"), orgId: read("orgId"), sucursalId: read("sucursalId"), input: read("input"), optimistic: read("optimistic"), status: read("status"), createdAt: read("createdAt"), attempts: read("attempts"), retryAt: read("retryAt"), errorCode: read("errorCode"), errorMessage: read("errorMessage"), legacyRaw: read("legacyRaw") } as unknown as T;
}

export async function restorePendingOrders(tenant: TenantContext): Promise<void> {
  const db = await getDb(tenant.orgId, tenant.sucursalId);
  const commands = await db.collections.outbox.find().exec();

  for (const document of commands) {
    let command = documentData<OutboxEntry>(document);

    let optimisticRaw = command.optimistic;
    if (command.errorCode === "legacy_recovery_required") {
      let legacy: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(command.legacyRaw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        legacy = parsed as Record<string, unknown>;
      } catch {
        continue;
      }
      const legacyOrder = await db.collections.pedidos.findOne({ selector: { id: command.id } }).exec();
      const order = legacyOrder ? documentData<Record<string, unknown>>(legacyOrder) : null;
      const assessment = assessLegacyCommand(branchDatabaseName(tenant), tenant, legacy, order);
      if (assessment.disposition !== "recoverable") continue;
      optimisticRaw = JSON.stringify(assessment.optimistic);
      command = {
        ...command,
        ...tenant,
        input: JSON.stringify(assessment.input),
        optimistic: optimisticRaw,
        status: "pending",
        errorCode: null,
        errorMessage: null,
      };
      await db.collections.outbox.upsert(command);
    }

    if (command.orgId !== tenant.orgId || command.sucursalId !== tenant.sucursalId) continue;

    let optimistic: Pedido;
    try {
      const parsed = pedidoSchema.safeParse(JSON.parse(optimisticRaw));
      if (!parsed.success) throw new Error("Invalid optimistic Pedido");
      optimistic = parsed.data;
    } catch {
      await db.collections.outbox.upsert({ ...command, status: "failed", errorCode: "legacy_recovery_required", errorMessage: "El comando local requiere revisión antes de reconstruir el pedido." });
      continue;
    }
    if (optimistic.id !== command.id || optimistic.clientRequestId !== command.id || optimistic.orgId !== tenant.orgId || optimistic.sucursalId !== tenant.sucursalId) {
      await db.collections.outbox.upsert({ ...command, status: "failed", errorCode: "legacy_recovery_required", errorMessage: "El pedido local no coincide con la sucursal guardada." });
      continue;
    }

    const authoritative = await db.collections.pedidos.findOne({ selector: { clientRequestId: command.id } }).exec();
    if (authoritative && documentData<Record<string, unknown>>(authoritative).id !== command.id) continue;
    const existing = await db.collections.pedidos.findOne({ selector: { id: command.id } }).exec();
    if (existing) {
      const current = documentData<Record<string, unknown>>(existing);
      if (current.orgId !== tenant.orgId || current.sucursalId !== tenant.sucursalId) {
        await db.collections.outbox.upsert({ ...command, status: "failed", errorCode: "legacy_recovery_required", errorMessage: "El pedido local no coincide con la sucursal guardada." });
      }
      continue;
    }
    await db.collections.pedidos.upsert(optimistic);
  }
}

export async function getPendingCommandCount(tenant: TenantContext): Promise<number> {
  const db = await getDb(tenant.orgId, tenant.sucursalId);
  const commands = await db.collections.outbox.find().exec();
  let count = 0;
  for (const document of commands as { toJSON?: () => Record<string, unknown>; get?: (key: string) => unknown }[]) {
    const command = documentData<Record<string, unknown>>(document);
    if (command.orgId === tenant.orgId && command.sucursalId === tenant.sucursalId && (command.status === "pending" || command.status === "failed")) {
      count++;
      continue;
    }
    if (command.errorCode !== "legacy_recovery_required" || command.orgId !== "" || command.sucursalId !== "") continue;
    try {
      const legacy = JSON.parse(String(command.legacyRaw)) as Record<string, unknown>;
      const orderDocument = await db.collections.pedidos.findOne({ selector: { id: command.id } }).exec();
      const order = orderDocument ? documentData<Record<string, unknown>>(orderDocument) : null;
      const assessment = assessLegacyCommand(branchDatabaseName(tenant), tenant, legacy, order);
      if (assessment.disposition === "recoverable" && pedidoSchema.safeParse(assessment.optimistic).success) count++;
    } catch {
      // Preserve unknown/corrupt records for export without assigning them to this tenant.
    }
  }
  return count;
}

export async function flushOutbox(apiUrl: string, tenant: TenantContext): Promise<void> {
  const db = await getDb(tenant.orgId, tenant.sucursalId);
  const entradas = await db.collections.outbox.find().exec();

  for (const entrada of entradas) {
    const command = documentData<OutboxEntry>(entrada);
    if (command.status === "failed" || command.orgId !== tenant.orgId || command.sucursalId !== tenant.sucursalId) continue;
    const clientRequestId = command.id;
    const input = JSON.parse(command.input) as CreatePedidoInput;

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

export function setupAutoSync(apiUrl: string, tenant: TenantContext, onError?: (err: unknown) => void): () => void {
  const handler = () => {
    flushOutbox(apiUrl, tenant).catch((err: unknown) => onError?.(err));
  };
  window.addEventListener("online", handler);
  handler();
  return () => window.removeEventListener("online", handler);
}
