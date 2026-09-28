jest.mock("./schema", () => ({ getDb: jest.fn() }));
jest.mock("@comanda/shared", () => ({
  ...jest.requireActual("../../../../packages/shared/src/index"),
  listMesas: jest.fn(),
  listPlatos: jest.fn(),
  listPedidos: jest.fn(),
  readSession: jest.fn(),
  getSessionGeneration: jest.fn(),
}));

import {
  getSessionGeneration,
  listMesas,
  listPedidos,
  listPlatos,
  readSession,
  SessionChangedError,
  type AuthSession,
  type Mesa,
  type Pedido,
  type Plato,
  type TenantContext,
} from "@comanda/shared";
import { getDb } from "./schema";
import { applyPedidoEvent, applyRealtimeEvent, syncAuthoritativeSnapshot } from "./reconcile";
import { withTenantWriteLock } from "./sync";

const tenant: TenantContext = {
  orgId: "00000000-0000-0000-0000-000000000001",
  sucursalId: "00000000-0000-0000-0000-000000000002",
};
const otherTenant: TenantContext = { ...tenant, sucursalId: "00000000-0000-0000-0000-000000000009" };
const apiUrl = "http://api.test";
const timestamp = "2026-09-28T12:00:00.000Z";
const session: AuthSession = {
  accessToken: "token", refreshToken: "refresh",
  user: { id: "00000000-0000-0000-0000-000000000010", nombre: "Mozo", email: "mozo@example.test", rol: "mozo", ...tenant },
};

function mesa(id: string, context = tenant): Mesa {
  return { id, ...context, nombre: "Mesa", capacidad: 4, estado: "libre", createdAt: timestamp, updatedAt: timestamp };
}
function plato(id: string, context = tenant): Plato {
  return { id, ...context, nombre: "Empanada", precio: 1000, disponible: true, categoriaId: "00000000-0000-0000-0000-000000000099", createdAt: timestamp, updatedAt: timestamp };
}
function pedido(id: string, context = tenant, version = 1, clientRequestId: string | null = null): Pedido {
  return {
    id, ...context, tipoServicio: "barra", mesaId: null, plataforma: null, direccionEnvio: null,
    estado: "abierto", version, cobro: null, items: [], clientRequestId, createdAt: timestamp, updatedAt: timestamp,
  };
}

function documentFor(row: Record<string, unknown>, rows: Record<string, unknown>[], removedIds: string[]) {
  const doc = {
    toJSON: () => ({ ...row }),
    remove: jest.fn(async () => {
      removedIds.push(String(row.id));
      const index = rows.indexOf(row);
      if (index >= 0) rows.splice(index, 1);
    }),
  };
  return doc;
}

describe("authoritative snapshot reconciliation", () => {
  let rows: Record<"mesas" | "platos" | "pedidos" | "outbox", Record<string, unknown>[]>;
  let upserts: Record<string, jest.Mock>;
  let removes: string[];
  let generation: number;
  let currentSession: AuthSession | null;
  let db: Record<string, any>;

  function setupDatabase(initial: Partial<typeof rows> = {}) {
    rows = { mesas: [], platos: [], pedidos: [], outbox: [], ...initial };
    removes = [];
    upserts = {};
    const collections = Object.fromEntries(Object.entries(rows).map(([name, collectionRows]) => {
      const collection = {
        find: jest.fn(() => ({ exec: async () => collectionRows.map((row) => documentFor(row, collectionRows, removes)) })),
        findOne: jest.fn(({ selector }: { selector: Record<string, unknown> }) => ({
          exec: async () => {
            const row = collectionRows.find((item) => Object.entries(selector).every(([key, value]) => item[key] === value));
            return row ? documentFor(row, collectionRows, removes) : null;
          },
        })),
        upsert: jest.fn(async (value: Record<string, unknown>) => {
          const existing = collectionRows.findIndex((row) => row.id === value.id);
          if (existing >= 0) collectionRows[existing] = value;
          else collectionRows.push(value);
          return value;
        }),
      };
      upserts[name] = collection.upsert;
      return [name, collection];
    }));
    db = { collections };
    jest.mocked(getDb).mockResolvedValue(db as never);
  }

  function setSnapshot(next: { mesas?: Mesa[]; platos?: Plato[]; pedidos?: Pedido[] } = {}) {
    jest.mocked(listMesas).mockResolvedValue((next.mesas ?? []).map((row) => ({ ...row })) as never);
    jest.mocked(listPlatos).mockResolvedValue((next.platos ?? []).map((row) => ({ ...row })) as never);
    jest.mocked(listPedidos).mockResolvedValue((next.pedidos ?? []).map((row) => ({ ...row })) as never);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    generation = 1;
    currentSession = session;
    jest.mocked(getSessionGeneration).mockImplementation(() => generation);
    jest.mocked(readSession).mockImplementation(() => currentSession);
    setupDatabase();
    setSnapshot();
  });

  it("prunes deleted server rows but preserves every pending optimistic projection", async () => {
    const stale = pedido("00000000-0000-0000-0000-000000000020");
    const optimistic = pedido("00000000-0000-0000-0000-000000000021", tenant, 0, "00000000-0000-0000-0000-000000000021");
    const pending = { id: optimistic.id, ...tenant, status: "pending" };
    const failed = { id: "00000000-0000-0000-0000-000000000022", ...tenant, status: "failed" };
    const failedOptimistic = pedido(failed.id, tenant, 0, failed.id);
    const staleMesa = mesa("00000000-0000-0000-0000-000000000030");
    const stalePlato = plato("00000000-0000-0000-0000-000000000040");
    setupDatabase({ pedidos: [stale, optimistic, failedOptimistic], outbox: [pending, failed], mesas: [staleMesa], platos: [stalePlato] });
    setSnapshot({ pedidos: [pedido("00000000-0000-0000-0000-000000000025")], mesas: [mesa("00000000-0000-0000-0000-000000000035")], platos: [plato("00000000-0000-0000-0000-000000000045")] });

    await syncAuthoritativeSnapshot(apiUrl, tenant);

    expect(removes).toContain(stale.id);
    expect(removes).toContain(staleMesa.id);
    expect(removes).toContain(stalePlato.id);
    expect(removes).not.toContain(optimistic.id);
    expect(removes).not.toContain(failedOptimistic.id);
    expect(rows.pedidos).toEqual(expect.arrayContaining([expect.objectContaining({ id: optimistic.id }), expect.objectContaining({ id: failedOptimistic.id })]));
  });

  it("completes a pending command after the snapshot confirms its client request ID", async () => {
    const commandId = "00000000-0000-0000-0000-000000000027";
    const optimistic = pedido(commandId, tenant, 0, commandId);
    const authoritative = pedido("00000000-0000-0000-0000-000000000028", tenant, 1, commandId);
    setupDatabase({ pedidos: [optimistic], outbox: [{ id: commandId, ...tenant, status: "pending" }] });
    setSnapshot({ pedidos: [authoritative] });

    await syncAuthoritativeSnapshot(apiUrl, tenant);

    expect(rows.pedidos).toEqual([authoritative]);
    expect(rows.outbox).toEqual([]);
  });

  it("waits for an enqueue write section before pruning the same tenant", async () => {
    const stale = pedido("00000000-0000-0000-0000-000000000026");
    setupDatabase({ pedidos: [stale] });
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const enqueue = withTenantWriteLock(tenant, async () => { started(); await held; });
    await entered;
    const snapshot = syncAuthoritativeSnapshot(apiUrl, tenant);
    await Promise.resolve();
    expect(removes).toEqual([]);
    release();
    await Promise.all([enqueue, snapshot]);
    expect(removes).toContain(stale.id);
  });

  it("ignores an older Pedido event version", async () => {
    const current = pedido("00000000-0000-0000-0000-000000000050", tenant, 4);
    setupDatabase({ pedidos: [current] });
    await applyPedidoEvent(pedido(current.id, tenant, 3), tenant);
    expect(upserts.pedidos).not.toHaveBeenCalled();
  });

  it("rejects a wrong-tenant event before applying it", async () => {
    const payload = plato("00000000-0000-0000-0000-000000000060", otherTenant);
    await expect(applyRealtimeEvent("plato.actualizado", payload, tenant)).resolves.toBe("ignored");
    expect(upserts.platos).not.toHaveBeenCalled();
  });

  it("rejects an event payload that fails its shared schema", async () => {
    await expect(applyRealtimeEvent("plato.actualizado", { ...plato("00000000-0000-0000-0000-000000000061"), disponible: "yes" }, tenant)).resolves.toBe("ignored");
    expect(upserts.platos).not.toHaveBeenCalled();
  });

  it("applies a newer availability event so Mozo sees the changed dish", async () => {
    const oldDish = plato("00000000-0000-0000-0000-000000000062");
    setupDatabase({ platos: [oldDish] });
    const changed = { ...oldDish, disponible: false, updatedAt: "2026-09-28T12:01:00.000Z" };
    await expect(applyRealtimeEvent("plato.actualizado", changed, tenant)).resolves.toBe("applied");
    expect(upserts.platos).toHaveBeenCalledWith(changed);
  });

  it("invalidates equal catalog timestamps and ignores older catalog events", async () => {
    const current = plato("00000000-0000-0000-0000-000000000063");
    setupDatabase({ platos: [current] });
    await expect(applyRealtimeEvent("plato.actualizado", current, tenant)).resolves.toBe("invalidate");
    const old = { ...current, updatedAt: "2026-09-28T11:59:00.000Z" };
    await expect(applyRealtimeEvent("plato.actualizado", old, tenant)).resolves.toBe("stale");
    expect(upserts.platos).not.toHaveBeenCalled();
  });

  it("discards a snapshot response after the session generation and branch change", async () => {
    let resolveMesas!: (value: Mesa[]) => void;
    jest.mocked(listMesas).mockReturnValueOnce(new Promise((resolve) => { resolveMesas = resolve; }) as never);
    jest.mocked(listPlatos).mockResolvedValueOnce([plato("00000000-0000-0000-0000-000000000070")] as never);
    jest.mocked(listPedidos).mockResolvedValueOnce([pedido("00000000-0000-0000-0000-000000000071")] as never);
    const pending = syncAuthoritativeSnapshot(apiUrl, tenant);
    currentSession = { ...session, user: { ...session.user, sucursalId: otherTenant.sucursalId } };
    generation++;
    resolveMesas([mesa("00000000-0000-0000-0000-000000000072")]);
    await expect(pending).rejects.toBeInstanceOf(SessionChangedError);
    expect(upserts.mesas).not.toHaveBeenCalled();
    expect(upserts.pedidos).not.toHaveBeenCalled();
  });

  it("runs one follow-up snapshot when a delete event arrives during the fetch", async () => {
    const deleted = mesa("00000000-0000-0000-0000-000000000080");
    let resolveMesas!: (value: Mesa[]) => void;
    jest.mocked(listMesas).mockResolvedValue([mesa("00000000-0000-0000-0000-000000000081")] as never);
    jest.mocked(listPlatos).mockResolvedValue([plato("00000000-0000-0000-0000-000000000082")] as never);
    jest.mocked(listPedidos).mockResolvedValue([] as never);
    jest.mocked(listMesas)
      .mockReturnValueOnce(new Promise((resolve) => { resolveMesas = resolve; }) as never)
      .mockResolvedValueOnce([] as never);
    setupDatabase({ mesas: [deleted] });

    const snapshot = syncAuthoritativeSnapshot(apiUrl, tenant);
    await applyRealtimeEvent("mesa.eliminada", { id: deleted.id, ...tenant }, tenant);
    resolveMesas([deleted]);
    await snapshot;

    expect(listMesas).toHaveBeenCalledTimes(2);
    expect(rows.mesas.some((row) => row.id === deleted.id)).toBe(false);
  });

  it("invalidates an equal-version Pedido event for an authoritative snapshot", async () => {
    const current = pedido("00000000-0000-0000-0000-000000000090", tenant, 5);
    setupDatabase({ pedidos: [current] });
    await expect(applyPedidoEvent(pedido(current.id, tenant, 5), tenant)).resolves.toBe("invalidate");
    expect(upserts.pedidos).not.toHaveBeenCalled();
  });

  it.each(["partial", "wrong tenant"])("does not prune data for a %s snapshot", async (failure) => {
    const stale = pedido("00000000-0000-0000-0000-000000000100");
    setupDatabase({ pedidos: [stale] });
    if (failure === "partial") jest.mocked(listPlatos).mockRejectedValueOnce(new Error("network"));
    else jest.mocked(listMesas).mockResolvedValueOnce([mesa("00000000-0000-0000-0000-000000000101", otherTenant)] as never);
    await expect(syncAuthoritativeSnapshot(apiUrl, tenant)).rejects.toThrow();
    expect(removes).not.toContain(stale.id);
    expect(upserts.pedidos).not.toHaveBeenCalled();
  });
});
