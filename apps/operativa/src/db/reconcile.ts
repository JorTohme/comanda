import {
  getSessionGeneration,
  listMesas,
  listPedidos,
  listPlatos,
  mesaSchema,
  pedidoSchema,
  platoSchema,
  readSession,
  realtimeEventSchemas,
  SessionChangedError,
  type AuthSession,
  type Mesa,
  type Pedido,
  type Plato,
  type RealtimeEventName,
  type TenantContext,
} from "@comanda/shared";
import { getDb } from "./schema";
import { withTenantWriteLock } from "./sync";

type StoredDocument = { toJSON?: () => unknown; remove: () => Promise<unknown> };
type Entity = Mesa | Plato | Pedido;
type Snapshot = { mesas: Mesa[]; platos: Plato[]; pedidos: Pedido[] };
type SnapshotState = { promise: Promise<void>; dirty: boolean };
type SocketLike = { on(event: string, listener: (payload: unknown) => void): unknown; off(event: string, listener: (payload: unknown) => void): unknown };

const inFlightSnapshots = new Map<string, SnapshotState>();

function tenantKey(tenant: TenantContext): string { return `${tenant.orgId}:${tenant.sucursalId}`; }
function sameTenant(session: AuthSession | null, tenant: TenantContext): session is AuthSession {
  return Boolean(session && session.user.orgId === tenant.orgId && session.user.sucursalId === tenant.sucursalId);
}
function documentData<T>(document: StoredDocument): T { return document.toJSON ? document.toJSON() as T : document as unknown as T; }
function rowTenant(row: { orgId: string; sucursalId: string }, tenant: TenantContext): boolean {
  return row.orgId === tenant.orgId && row.sucursalId === tenant.sucursalId;
}
function assertSnapshotTenant(snapshot: Snapshot, tenant: TenantContext): void {
  for (const rows of [snapshot.mesas, snapshot.platos, snapshot.pedidos]) {
    if (rows.some((row) => !rowTenant(row, tenant))) throw new Error("La respuesta contiene registros de otra sucursal.");
  }
}
function assertSession(session: AuthSession | null, generation: number, tenant: TenantContext): asserts session is AuthSession {
  if (!sameTenant(session, tenant) || getSessionGeneration() !== generation) throw new SessionChangedError();
}

async function fetchSnapshot(apiUrl: string, tenant: TenantContext, signal?: AbortSignal): Promise<Snapshot> {
  const session = readSession();
  if (!sameTenant(session, tenant)) throw new SessionChangedError();
  const generation = getSessionGeneration();
  const [mesas, platos, pedidos] = await Promise.all([
    listMesas(apiUrl, { signal }), listPlatos(apiUrl, undefined, { signal }), listPedidos(apiUrl, { signal }),
  ]);
  assertSession(readSession(), generation, tenant);
  const snapshot = {
    mesas: mesas.map((row) => mesaSchema.parse(row)),
    platos: platos.map((row) => platoSchema.parse(row)),
    pedidos: pedidos.map((row) => pedidoSchema.parse(row)),
  };
  assertSnapshotTenant(snapshot, tenant);
  return snapshot;
}

function pendingProjectionIds(commands: Record<string, unknown>[], tenant: TenantContext): Set<string> {
  return new Set(commands.flatMap((command) =>
    command.orgId === tenant.orgId && command.sucursalId === tenant.sucursalId &&
    (command.status === "pending" || command.status === "failed") && typeof command.id === "string" ? [command.id] : []));
}

async function applySnapshot(snapshot: Snapshot, tenant: TenantContext, generation: number, signal?: AbortSignal): Promise<void> {
  await withTenantWriteLock(tenant, async () => {
    assertSession(readSession(), generation, tenant);
    if (signal?.aborted) throw new DOMException("Snapshot aborted", "AbortError");
    const state = inFlightSnapshots.get(tenantKey(tenant));
    if (state?.dirty) return;
    const db = await getDb(tenant.orgId, tenant.sucursalId);
    const [mesaDocs, platoDocs, pedidoDocs, outboxDocs] = await Promise.all([
      db.collections.mesas.find().exec(), db.collections.platos.find().exec(),
      db.collections.pedidos.find().exec(), db.collections.outbox.find().exec(),
    ]) as [StoredDocument[], StoredDocument[], StoredDocument[], StoredDocument[]];
    const pending = pendingProjectionIds(outboxDocs.map((doc) => documentData<Record<string, unknown>>(doc)), tenant);
    for (const row of snapshot.mesas) await db.collections.mesas.upsert(row);
    for (const row of snapshot.platos) await db.collections.platos.upsert(row);
    for (const row of snapshot.pedidos) await db.collections.pedidos.upsert(row);
    for (const outboxDoc of outboxDocs) {
      const command = documentData<Record<string, unknown>>(outboxDoc);
      if (command.orgId !== tenant.orgId || command.sucursalId !== tenant.sucursalId ||
        (command.status !== "pending" && command.status !== "failed") || typeof command.id !== "string") continue;
      const acknowledged = snapshot.pedidos.find((row) => row.clientRequestId === command.id && row.id !== command.id);
      if (!acknowledged) continue;
      const optimisticDoc = await db.collections.pedidos.findOne({ selector: { id: command.id } }).exec() as StoredDocument | null;
      if (optimisticDoc) {
        const optimistic = documentData<Pedido>(optimisticDoc);
        if (optimistic.id === command.id && optimistic.clientRequestId === command.id && rowTenant(optimistic, tenant)) await optimisticDoc.remove();
      }
      // The authoritative Pedido has been persisted above; clearing its acknowledged command is crash recovery.
      await outboxDoc.remove();
    }
    const prune = async <T extends Entity>(docs: StoredDocument[], rows: T[], collection: { name: string }) => {
      const ids = new Set(rows.map((row) => row.id));
      for (const doc of docs) {
        const row = documentData<T>(doc);
        if (!rowTenant(row, tenant) || ids.has(row.id)) continue;
        if (collection.name === "pedidos" && ((row as Pedido).version === 0 || pending.has(row.id) || pending.has((row as Pedido).clientRequestId ?? ""))) continue;
        await doc.remove();
      }
    };
    await prune(mesaDocs, snapshot.mesas, { name: "mesas" });
    await prune(platoDocs, snapshot.platos, { name: "platos" });
    await prune(pedidoDocs, snapshot.pedidos, { name: "pedidos" });
  }, signal);
}

export function syncAuthoritativeSnapshot(apiUrl: string, tenant: TenantContext, options: { signal?: AbortSignal } = {}): Promise<void> {
  const key = tenantKey(tenant);
  const current = inFlightSnapshots.get(key);
  if (current) {
    current.dirty = true;
    return current.promise;
  }
  const session = readSession();
  if (!sameTenant(session, tenant)) return Promise.reject(new SessionChangedError());
  const generation = getSessionGeneration();
  const state: SnapshotState = { dirty: false, promise: Promise.resolve() };
  const run = async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      state.dirty = false;
      const snapshot = await fetchSnapshot(apiUrl, tenant, options.signal);
      assertSession(readSession(), generation, tenant);
      try {
        await applySnapshot(snapshot, tenant, generation, options.signal);
      } catch (error) {
        if (attempt === 0 && !options.signal?.aborted && !(error instanceof SessionChangedError)) {
          state.dirty = true;
          continue;
        }
        throw error;
      }
      if (!state.dirty || options.signal?.aborted) return;
    }
  };
  state.promise = run().finally(() => { if (inFlightSnapshots.get(key) === state) inFlightSnapshots.delete(key); });
  inFlightSnapshots.set(key, state);
  return state.promise;
}

export async function applyPedidoEvent(raw: unknown, tenant: TenantContext): Promise<"applied" | "stale" | "invalidate" | "ignored"> {
  const parsed = pedidoSchema.safeParse(raw);
  if (!parsed.success || !rowTenant(parsed.data, tenant)) return "ignored";
  const event = parsed.data;
  const state = inFlightSnapshots.get(tenantKey(tenant));
  if (state) state.dirty = true;
  return withTenantWriteLock(tenant, async () => {
    const db = await getDb(tenant.orgId, tenant.sucursalId);
    const current = await db.collections.pedidos.findOne({ selector: { id: event.id } }).exec() as StoredDocument | null;
    if (current) {
      const saved = documentData<Pedido>(current);
      if (!rowTenant(saved, tenant)) return "ignored";
      if (saved.version > event.version) return "stale";
      if (saved.version === event.version) return "invalidate";
    }
    await db.collections.pedidos.upsert(event);
    return "applied";
  });
}

export type RealtimeApplyResult = "applied" | "stale" | "invalidate" | "ignored";

export async function applyRealtimeEvent(eventName: RealtimeEventName | string, raw: unknown, tenant: TenantContext): Promise<RealtimeApplyResult> {
  if (!Object.prototype.hasOwnProperty.call(realtimeEventSchemas, eventName)) return "ignored";
  const schema = realtimeEventSchemas[eventName as RealtimeEventName];
  const result = schema.safeParse(raw);
  if (!result.success || !rowTenant(result.data as { orgId: string; sucursalId: string }, tenant)) return "ignored";
  const payload = result.data as Record<string, unknown>;
  const state = inFlightSnapshots.get(tenantKey(tenant));
  if (state) state.dirty = true;
  const event = eventName as RealtimeEventName;
  if (event.startsWith("pedido.")) {
    return applyPedidoEvent(payload, tenant);
  }
  if (event === "caja.actualizada") return "applied";
  const collectionName = event.startsWith("mesa.") ? "mesas" : event.startsWith("plato.") ? "platos" : "categorias";
  if (collectionName === "categorias") return "applied";
  return withTenantWriteLock(tenant, async () => {
    const db = await getDb(tenant.orgId, tenant.sucursalId);
    const collection = db.collections[collectionName as "mesas" | "platos"];
    if (event.endsWith(".eliminada")) {
      const document = await collection.findOne({ selector: { id: payload.id } }).exec() as StoredDocument | null;
      if (document) {
        const saved = documentData<Entity>(document);
        if (!rowTenant(saved, tenant)) return "ignored";
        await document.remove();
      }
      return "applied";
    }
    const current = await collection.findOne({ selector: { id: payload.id } }).exec() as StoredDocument | null;
    if (current) {
      const saved = documentData<Entity>(current);
      if (!rowTenant(saved, tenant)) return "ignored";
      const currentUpdatedAt = Date.parse(saved.updatedAt);
      const eventUpdatedAt = Date.parse(String(payload.updatedAt));
      if (currentUpdatedAt > eventUpdatedAt) return "stale";
      if (currentUpdatedAt === eventUpdatedAt) return "invalidate";
    }
    await collection.upsert(payload);
    return "applied";
  });
}

export function setupSnapshotRecovery(
  apiUrl: string, tenant: TenantContext, socket?: SocketLike, onError?: (error: unknown) => void, onInitialComplete?: () => void,
): () => void {
  let disposed = false;
  let initial = true;
  let controller = new AbortController();
  const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
  const trigger = () => {
    if (disposed || !visible() || !sameTenant(readSession(), tenant)) return;
    void syncAuthoritativeSnapshot(apiUrl, tenant, { signal: controller.signal }).catch((error: unknown) => {
      if (!(error instanceof SessionChangedError) && !(error instanceof DOMException && error.name === "AbortError")) onError?.(error);
    }).finally(() => { if (initial && !disposed) { initial = false; onInitialComplete?.(); } });
  };
  const onEvent = (name: RealtimeEventName) => (payload: unknown) => {
    void applyRealtimeEvent(name, payload, tenant).then((result) => { if (result === "invalidate") trigger(); }).catch(onError);
  };
  const eventNames = Object.keys(realtimeEventSchemas) as RealtimeEventName[];
  const handlers = new Map(eventNames.map((name) => [name, onEvent(name)]));
  const onReconnect = () => trigger();
  const onVisibility = () => { if (visible()) trigger(); };
  const events = typeof window === "undefined" ? null : window;
  const visibility = typeof document === "undefined" ? null : document;
  socket?.on("connect", onReconnect);
  for (const [name, handler] of handlers) socket?.on(name, handler);
  events?.addEventListener("online", trigger);
  events?.addEventListener("focus", trigger);
  visibility?.addEventListener("visibilitychange", onVisibility);
  const timer = setInterval(trigger, 15_000);
  trigger();
  return () => {
    disposed = true;
    controller.abort();
    controller = new AbortController();
    clearInterval(timer);
    socket?.off("connect", onReconnect);
    for (const [name, handler] of handlers) socket?.off(name, handler);
    events?.removeEventListener("online", trigger);
    events?.removeEventListener("focus", trigger);
    visibility?.removeEventListener("visibilitychange", onVisibility);
  };
}
