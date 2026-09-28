jest.mock("./schema", () => ({ getDb: jest.fn() }));
jest.mock("@comanda/shared", () => ({
  createPedido: jest.fn(),
  pedidoSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) },
}));

import { createPedido } from "@comanda/shared";
import { getDb } from "./schema";
import { crearPedidoOffline, getPendingCommandCount, restorePendingOrders } from "./sync";

const tenant = { orgId: "00000000-0000-0000-0000-000000000001", sucursalId: "00000000-0000-0000-0000-000000000002" };
const input = { tipoServicio: "mesa" as const, mesaId: "00000000-0000-0000-0000-000000000003", items: [{ platoId: "00000000-0000-0000-0000-000000000004", cantidad: 2 }] };

describe("durable offline order creation", () => {
  let orderRows: Record<string, unknown>[];
  let outboxRows: Record<string, unknown>[];
  let writeOrder: jest.Mock;
  let writeOutbox: jest.Mock;
  let failOrderWrite = false;
  let db: Record<string, unknown>;

  beforeEach(() => {
    orderRows = [];
    outboxRows = [];
    const upsert = (rows: Record<string, unknown>[], row: Record<string, unknown>, kind: string) => {
      if (kind === "outbox") outboxRows.push(row);
      else orderRows.push(row);
      return Promise.resolve(row);
    };
    writeOrder = jest.fn((row: Record<string, unknown>) => upsert(orderRows, row, "pedido"));
    writeOrder.mockImplementation((row: Record<string, unknown>) => {
      if (failOrderWrite) {
        failOrderWrite = false;
        return Promise.reject(new Error("disk write failed"));
      }
      return upsert(orderRows, row, "pedido");
    });
    writeOutbox = jest.fn((row: Record<string, unknown>) => upsert(outboxRows, row, "outbox"));
    const docs = [{ toJSON: () => ({ id: input.items[0].platoId, nombre: "Empanada", precio: 1000 }) }];
    db = { collections: {
      platos: { find: () => ({ exec: async () => docs }) },
      pedidos: {
        upsert: writeOrder,
        findOne: (selector: string | { selector?: { id?: string; clientRequestId?: string } }) => ({
          exec: async () => {
            const id = typeof selector === "string" ? selector : selector.selector?.id ?? selector.selector?.clientRequestId;
            const row = orderRows.find((candidate) => candidate.id === id || candidate.clientRequestId === id);
            return row ? { toJSON: () => row } : null;
          },
          remove: jest.fn(),
        }),
      },
      outbox: { upsert: writeOutbox, find: () => ({ exec: async () => outboxRows.map((row) => ({
        get: (key: string) => row[key],
        toJSON: () => row,
      })) }) },
    } };
    jest.mocked(getDb).mockResolvedValue(db as never);
    jest.mocked(createPedido).mockRejectedValue(new TypeError("offline"));
  });

  afterEach(() => jest.clearAllMocks());

  it("persists the tenant-scoped command before its optimistic Pedido projection", async () => {
    await crearPedidoOffline(input, tenant, "http://api.test");

    expect(outboxRows).toHaveLength(1);
    expect(orderRows).toHaveLength(1);
    const command = outboxRows[0];
    const optimistic = orderRows[0];
    expect(command).toEqual(expect.objectContaining({
      orgId: tenant.orgId,
      sucursalId: tenant.sucursalId,
      status: "pending",
      attempts: 0,
      retryAt: 0,
      errorCode: null,
      errorMessage: null,
    }));
    expect(JSON.parse(command.input as string)).toMatchObject({ ...input, clientRequestId: command.id });
    expect(JSON.parse(command.optimistic as string)).toEqual(optimistic);
    expect(optimistic).toMatchObject({ version: 0, cobro: null, clientRequestId: command.id, ...tenant });
    expect(optimistic).not.toHaveProperty("pagos");
    expect(writeOrder.mock.invocationCallOrder[0]).toBeGreaterThan(writeOutbox.mock.invocationCallOrder[0]);
  });

  it("rebuilds the optimistic Pedido after a crash between command and projection writes", async () => {
    failOrderWrite = true;
    await expect(crearPedidoOffline(input, tenant, "http://api.test")).rejects.toThrow("disk write failed");
    expect(outboxRows).toHaveLength(1);
    expect(orderRows).toHaveLength(0);

    await restorePendingOrders(tenant);

    expect(orderRows).toEqual([JSON.parse(outboxRows[0].optimistic as string)]);
  });

  it("counts both pending and failed commands in the active tenant only", async () => {
    outboxRows.push(
      { id: "pending", orgId: tenant.orgId, sucursalId: tenant.sucursalId, status: "pending" },
      { id: "failed", orgId: tenant.orgId, sucursalId: tenant.sucursalId, status: "failed", errorCode: "legacy_recovery_required" },
      { id: "other-tenant", orgId: tenant.orgId, sucursalId: "00000000-0000-0000-0000-000000000009", status: "pending" },
    );

    await expect(getPendingCommandCount(tenant)).resolves.toBe(2);
  });
});
