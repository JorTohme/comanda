import { ApiError, createPedido, getSessionGeneration, pedidoSchema, readSession, SessionChangedError, subscribeSession, type AuthSession, type CreatePedidoInput, type Pedido, type TenantContext } from "@comanda/shared";
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
    items: input.items.map((item) => {
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
  const clientRequestId = crypto.randomUUID();
  const db = await getDb(tenant.orgId, tenant.sucursalId);
  const platos = (await db.collections.platos.find().exec()).map((doc: { toJSON(): { id: string; nombre: string; precio: number } }) => doc.toJSON());
  const optimista = pedidoOptimista(clientRequestId, input, platos, tenant);

  await withTenantWriteLock(tenant, async () => {
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
  });

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
    if (authoritative && documentData<Record<string, unknown>>(authoritative).id !== command.id) {
      const saved = documentData<Record<string, unknown>>(authoritative);
      if (saved.orgId === tenant.orgId && saved.sucursalId === tenant.sucursalId && pedidoSchema.safeParse(saved).success) {
        const optimisticOrder = await db.collections.pedidos.findOne({ selector: { id: command.id } }).exec();
        if (optimisticOrder) await optimisticOrder.remove();
        await document.remove();
      }
      continue;
    }
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

export function commandsWithoutProjection(commands: OutboxEntry[], pedidos: Pick<Pedido, "clientRequestId">[]): OutboxEntry[] {
  const projectedIds = new Set(pedidos.flatMap((pedido) => typeof pedido.clientRequestId === "string" ? [pedido.clientRequestId] : []));
  return commands.filter((command) => !projectedIds.has(command.id));
}

const outboxOperationQueues = new Map<string, Promise<void>>();
const tenantWriteQueues = new Map<string, Promise<void>>();

export async function withTenantWriteLock<T>(tenant: TenantContext, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const key = `${tenant.orgId}:${tenant.sucursalId}`;
  const previous = tenantWriteQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => { release = resolve; });
  tenantWriteQueues.set(key, turn);
  await previous;
  try {
    const navigator = globalThis.navigator as Navigator & { locks?: LockManager };
    const lockName = `comanda.tenant-write:${tenant.orgId}:${tenant.sucursalId}`;
    if (!navigator?.locks) return await operation();
    return await navigator.locks.request(lockName, signal ? { mode: "exclusive", signal } : { mode: "exclusive" }, () => operation());
  } finally {
    release();
    if (tenantWriteQueues.get(key) === turn) tenantWriteQueues.delete(key);
  }
}

async function withOutboxLock(tenant: TenantContext, operation: () => Promise<void>, signal?: AbortSignal): Promise<void> {
  const key = `${tenant.orgId}:${tenant.sucursalId}`;
  const previous = outboxOperationQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => { release = resolve; });
  outboxOperationQueues.set(key, turn);
  await previous;
  try {
    const navigator = globalThis.navigator as Navigator & { locks?: LockManager };
    const lockName = `comanda.outbox:${tenant.orgId}:${tenant.sucursalId}`;
    if (!navigator?.locks) return await operation();
    return await navigator.locks.request<void>(lockName, signal ? { mode: "exclusive", signal } : { mode: "exclusive" }, async () => { await operation(); });
  } finally {
    release();
    if (outboxOperationQueues.get(key) === turn) outboxOperationQueues.delete(key);
  }
}

export function retryCommand(id: string, tenant: TenantContext): Promise<void> {
  return withOutboxLock(tenant, async () => {
    await withTenantWriteLock(tenant, async () => {
      const db = await getDb(tenant.orgId, tenant.sucursalId);
      const entry = await db.collections.outbox.findOne({ selector: { id } }).exec();
      if (!entry) return;
      const command = documentData<OutboxEntry>(entry);
      if (command.id !== id || command.orgId !== tenant.orgId || command.sucursalId !== tenant.sucursalId || command.status !== "failed" || command.errorCode === "legacy_recovery_required") return;
      await entry.incrementalPatch({ status: "pending", retryAt: 0, errorCode: null, errorMessage: null });
    });
  });
}

export function discardCommand(id: string, tenant: TenantContext): Promise<void> {
  return withOutboxLock(tenant, async () => {
    await withTenantWriteLock(tenant, async () => {
    const db = await getDb(tenant.orgId, tenant.sucursalId);
    const entry = await db.collections.outbox.findOne({ selector: { id } }).exec();
    if (!entry) return;
    const command = documentData<OutboxEntry>(entry);
    if (command.id !== id || command.orgId !== tenant.orgId || command.sucursalId !== tenant.sucursalId || command.errorCode === "legacy_recovery_required") return;

    const authoritative = await db.collections.pedidos.findOne({ selector: { clientRequestId: id } }).exec();
    if (authoritative) {
      const saved = documentData<Record<string, unknown>>(authoritative);
      if (saved.orgId !== tenant.orgId || saved.sucursalId !== tenant.sucursalId) return;
      if (saved.id !== id) {
        await entry.remove();
        return;
      }
    }

    const optimistic = await db.collections.pedidos.findOne({ selector: { id } }).exec();
    if (optimistic) {
      const order = documentData<Record<string, unknown>>(optimistic);
      if (order.id === id && order.clientRequestId === id && order.orgId === tenant.orgId && order.sucursalId === tenant.sucursalId) {
        await optimistic.remove();
      }
    }
    await entry.remove();
    });
  });
}

type FlushOptions = { signal?: AbortSignal };
type ReconnectSource = { on(event: "connect", listener: () => void): unknown; off(event: "connect", listener: () => void): unknown };
const inFlightFlushes = new Map<string, Promise<void>>();
const requestTimeoutMs = 15_000;

function sameTenant(session: AuthSession | null, tenant: TenantContext): session is AuthSession {
  return Boolean(session && session.user.orgId === tenant.orgId && session.user.sucursalId === tenant.sucursalId);
}

function sessionUnchanged(session: AuthSession, generation: number, tenant: TenantContext): boolean {
  const current = readSession();
  return getSessionGeneration() === generation && sameTenant(current, tenant) && current.user.id === session.user.id;
}

function abortError(error: unknown): boolean {
  return error instanceof SessionChangedError || Boolean(error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "AbortError");
}

function namedError(error: unknown, name: string): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && (error as { name?: string }).name === name);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Error inesperado al sincronizar el pedido.";
}

function retryDelay(attempts: number, retryAfterMs?: number): number {
  const backoff = Math.min(60_000, 2_000 * 2 ** Math.min(attempts - 1, 5));
  return Math.max(backoff, retryAfterMs ?? 0);
}

async function postWithTimeout(apiUrl: string, input: CreatePedidoInput, signal?: AbortSignal): Promise<Pedido> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeoutMs);
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abort, { once: true });
  try {
    return await createPedido(apiUrl, input, { signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new DOMException("La solicitud de sincronización superó el tiempo límite.", "TimeoutError");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

async function patchCommand(entry: { incrementalPatch(patch: Record<string, unknown>): Promise<unknown> }, patch: Record<string, unknown>): Promise<void> {
  await entry.incrementalPatch(patch);
}

function validOptimistic(command: OutboxEntry, tenant: TenantContext): boolean {
  try {
    const input = JSON.parse(command.input) as CreatePedidoInput;
    const optimistic = pedidoSchema.safeParse(JSON.parse(command.optimistic));
    return Boolean(
      command.id && command.orgId === tenant.orgId && command.sucursalId === tenant.sucursalId &&
      input.clientRequestId === command.id && optimistic.success && optimistic.data.id === command.id &&
      optimistic.data.clientRequestId === command.id && optimistic.data.orgId === tenant.orgId &&
      optimistic.data.sucursalId === tenant.sucursalId,
    );
  } catch {
    return false;
  }
}

async function recordDeliveryError(entry: { incrementalPatch(patch: Record<string, unknown>): Promise<unknown> }, command: OutboxEntry, error: unknown): Promise<void> {
  if (error instanceof ApiError && error.status === 401) {
    await patchCommand(entry, { status: "pending", retryAt: Number.MAX_SAFE_INTEGER, errorCode: "auth_required", errorMessage: errorText(error) });
    return;
  }
  if (error instanceof ApiError && ([408, 429].includes(error.status) || error.status >= 500) || error instanceof TypeError || namedError(error, "TimeoutError")) {
    const attempts = Math.max(0, command.attempts) + 1;
    const retryAfter = error instanceof ApiError ? error.retryAfterMs : undefined;
    await patchCommand(entry, { status: "pending", attempts, retryAt: Date.now() + retryDelay(attempts, retryAfter), errorCode: error instanceof ApiError ? `http_${error.status}` : "network_error", errorMessage: errorText(error) });
    return;
  }
  if (error instanceof ApiError && error.status >= 400 && error.status < 500 || namedError(error, "ZodError") || error instanceof SyntaxError) {
    const code = error instanceof ApiError ? `http_${error.status}` : "invalid_response";
    await patchCommand(entry, { status: "failed", retryAt: 0, errorCode: code, errorMessage: errorText(error) });
    return;
  }
  throw error;
}

async function drainOutbox(apiUrl: string, tenant: TenantContext, options: FlushOptions): Promise<void> {
  const session = readSession();
  if (!sameTenant(session, tenant) || options.signal?.aborted) return;
  const generation = getSessionGeneration();
  const db = await getDb(tenant.orgId, tenant.sucursalId);
  const entries = await db.collections.outbox.find().exec();
  if (entries.some((entry) => {
    const command = documentData<OutboxEntry>(entry);
    return command.status === "pending" && command.orgId === tenant.orgId && command.sucursalId === tenant.sucursalId && command.errorCode === "auth_required";
  })) return;

  for (const entry of entries) {
    if (options.signal?.aborted || !sessionUnchanged(session, generation, tenant)) return;
    const command = documentData<OutboxEntry>(entry);
    if (command.status !== "pending" || command.orgId !== tenant.orgId || command.sucursalId !== tenant.sucursalId || command.retryAt > Date.now()) continue;
    if (!validOptimistic(command, tenant)) {
      await patchCommand(entry, { status: "failed", retryAt: 0, errorCode: "invalid_command", errorMessage: "El comando local no coincide con el pedido o la sucursal guardada." });
      continue;
    }

    const input = JSON.parse(command.input) as CreatePedidoInput;
    let pedidoReal: Pedido;
    try {
      pedidoReal = await postWithTimeout(apiUrl, input, options.signal);
    } catch (error) {
      if (options.signal?.aborted || abortError(error) || !sessionUnchanged(session, generation, tenant)) return;
      await recordDeliveryError(entry, command, error);
      // Authentication is a session-wide condition, not a command-local failure.
      // Stop this drain so later commands wait until the session is refreshed.
      if (error instanceof ApiError && error.status === 401) return;
      continue;
    }

    if (options.signal?.aborted || !sessionUnchanged(session, generation, tenant)) return;
    const validated = pedidoSchema.safeParse(pedidoReal);
    if (!validated.success || validated.data.orgId !== tenant.orgId || validated.data.sucursalId !== tenant.sucursalId || validated.data.clientRequestId !== command.id || validated.data.id === command.id) {
      await patchCommand(entry, { status: "failed", retryAt: 0, errorCode: "invalid_response", errorMessage: "La respuesta del servidor no confirma este pedido y sucursal." });
      continue;
    }

    // Keep the durable command until the authoritative projection is stored and the optimistic row is removed.
    await withTenantWriteLock(tenant, async () => {
      if (options.signal?.aborted || !sessionUnchanged(session, generation, tenant)) return;
      await db.collections.pedidos.upsert(validated.data);
      const optimisticOrder = await db.collections.pedidos.findOne({ selector: { id: command.id } }).exec();
      if (optimisticOrder) await optimisticOrder.remove();
      await entry.remove();
    }, options.signal);
  }
}

export async function flushOutbox(apiUrl: string, tenant: TenantContext, options: FlushOptions = {}): Promise<void> {
  const key = `${new URL(apiUrl).origin}:${tenant.orgId}:${tenant.sucursalId}`;
  const existing = inFlightFlushes.get(key);
  if (existing) return existing;
  const pending = withOutboxLock(tenant, () => drainOutbox(apiUrl, tenant, options), options.signal).finally(() => {
      if (inFlightFlushes.get(key) === pending) inFlightFlushes.delete(key);
    });
  inFlightFlushes.set(key, pending);
  return pending;
}

async function resumeAuthenticationSuspended(tenant: TenantContext): Promise<void> {
  const session = readSession();
  if (!sameTenant(session, tenant)) return;
  const db = await getDb(tenant.orgId, tenant.sucursalId);
  const entries = await db.collections.outbox.find().exec();
  for (const entry of entries) {
    const command = documentData<OutboxEntry>(entry);
    if (command.status === "pending" && command.orgId === tenant.orgId && command.sucursalId === tenant.sucursalId && command.errorCode === "auth_required") {
      await patchCommand(entry, { retryAt: 0, errorCode: null, errorMessage: null });
    }
  }
}

export function setupAutoSync(apiUrl: string, tenant: TenantContext, onError?: (err: unknown) => void, socket?: ReconnectSource): () => void {
  let disposed = false;
  let controller = new AbortController();
  const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
  const trigger = () => {
    if (disposed || !visible() || !sameTenant(readSession(), tenant)) return;
    void flushOutbox(apiUrl, tenant, { signal: controller.signal }).catch((error: unknown) => {
      if (!abortError(error)) onError?.(error);
    });
  };
  const onSession = () => {
    controller.abort();
    controller = new AbortController();
    void resumeAuthenticationSuspended(tenant).then(trigger).catch((error: unknown) => onError?.(error));
  };
  const onVisibility = () => { if (visible()) trigger(); };
  const events = typeof window === "undefined" ? null : window;
  const visibilityTarget = typeof document === "undefined" ? null : document;
  events?.addEventListener("online", trigger);
  events?.addEventListener("focus", trigger);
  visibilityTarget?.addEventListener("visibilitychange", onVisibility);
  const timer = setInterval(trigger, 5_000);
  socket?.on("connect", trigger);
  const unsubscribe = subscribeSession(onSession);
  trigger();
  return () => {
    disposed = true;
    controller.abort();
    clearInterval(timer);
    events?.removeEventListener("online", trigger);
    events?.removeEventListener("focus", trigger);
    visibilityTarget?.removeEventListener("visibilitychange", onVisibility);
    socket?.off("connect", trigger);
    unsubscribe();
  };
}
