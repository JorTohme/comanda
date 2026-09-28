jest.mock("./schema", () => ({ getDb: jest.fn() }));
jest.mock("@comanda/shared", () => ({
  createPedido: jest.fn(),
  pedidoSchema: { safeParse: jest.fn((data: unknown) => ({ success: true, data })) },
  ApiError: class MockApiError extends Error {
    constructor(public status: number, message: string, public retryAfterMs?: number) { super(message); }
  },
  SessionChangedError: class MockSessionChangedError extends Error {},
  getSessionGeneration: jest.fn(),
  readSession: jest.fn(),
  subscribeSession: jest.fn(() => () => {}),
}));

import { ApiError, createPedido, getSessionGeneration, pedidoSchema, readSession, SessionChangedError, subscribeSession, type AuthSession } from "@comanda/shared";
import { getDb } from "./schema";
import { commandsWithoutProjection, crearPedidoOffline, discardCommand, flushOutbox, getPendingCommandCount, restorePendingOrders, retryCommand, setupAutoSync } from "./sync";

const tenant = { orgId: "00000000-0000-0000-0000-000000000001", sucursalId: "00000000-0000-0000-0000-000000000002" };
const otherTenant = { ...tenant, sucursalId: "00000000-0000-0000-0000-000000000009" };
const session: AuthSession = { accessToken: "access", refreshToken: "refresh", user: { id: "00000000-0000-0000-0000-000000000010", nombre: "Mozo", email: "mozo@example.test", rol: "mozo", ...tenant } };
const input = { tipoServicio: "mesa" as const, mesaId: "00000000-0000-0000-0000-000000000003", items: [{ platoId: "00000000-0000-0000-0000-000000000004", cantidad: 2 }] };
const apiUrl = "http://api.test";

function serverOrder(id = "00000000-0000-0000-0000-000000000020", clientRequestId = "request-1", context = tenant) {
  return { id, clientRequestId, orgId: context.orgId, sucursalId: context.sucursalId, tipoServicio: "mesa", mesaId: input.mesaId, plataforma: null, direccionEnvio: null, estado: "abierto", version: 1, cobro: null, items: [], createdAt: "2026-09-27T00:00:00.000Z", updatedAt: "2026-09-27T00:00:00.000Z" };
}

describe("durable offline order creation and delivery", () => {
  let orderRows: Record<string, unknown>[];
  let outboxRows: Record<string, unknown>[];
  let outboxDocs: Map<string, Record<string, any>>;
  let writeOrder: jest.Mock;
  let writeOutbox: jest.Mock;
  let failOrderWrite = false;
  let db: Record<string, any>;
  let generation: number;
  let currentSession: AuthSession | null;

  function addCommand(id: string, changes: Record<string, unknown> = {}) {
    const row = { id, orgId: tenant.orgId, sucursalId: tenant.sucursalId, input: JSON.stringify({ ...input, clientRequestId: id }), optimistic: JSON.stringify({ id, clientRequestId: id, ...tenant }), status: "pending", createdAt: "2026-09-27T00:00:00.000Z", attempts: 0, retryAt: 0, errorCode: null, errorMessage: null, legacyRaw: "", ...changes };
    outboxRows.push(row);
    const doc = makeDocument(row, outboxRows);
    outboxDocs.set(id, doc);
    return { row, doc };
  }

  function makeDocument(row: Record<string, any>, collection: Record<string, unknown>[]) {
    const doc: Record<string, any> = {
      toJSON: () => ({ ...row }),
      incrementalPatch: jest.fn(async (patch: Record<string, unknown>) => { Object.assign(row, patch); return doc; }),
      remove: jest.fn(async () => {
        const index = collection.indexOf(row);
        if (index >= 0) collection.splice(index, 1);
      }),
    };
    return doc;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    orderRows = [];
    outboxRows = [];
    outboxDocs = new Map();
    failOrderWrite = false;
    generation = 1;
    currentSession = session;
    jest.mocked(getSessionGeneration).mockImplementation(() => generation);
    jest.mocked(readSession).mockImplementation(() => currentSession);
    jest.mocked(pedidoSchema.safeParse).mockImplementation((data: unknown) => ({ success: true, data } as never));
    const upsertOrder = jest.fn(async (row: Record<string, unknown>) => {
      if (failOrderWrite) {
        failOrderWrite = false;
        throw new Error("quota");
      }
      const index = orderRows.findIndex((existing) => existing.id === row.id);
      if (index >= 0) orderRows[index] = row;
      else orderRows.push(row);
    });
    writeOrder = upsertOrder;
    writeOutbox = jest.fn(async (row: Record<string, unknown>) => {
      const existing = outboxRows.find((candidate) => candidate.id === row.id);
      if (existing) Object.assign(existing, row);
      else outboxRows.push(row);
      if (!outboxDocs.has(String(row.id))) outboxDocs.set(String(row.id), makeDocument(outboxRows.find((candidate) => candidate.id === row.id)!, outboxRows));
    });
    const docs = [{ toJSON: () => ({ id: input.items[0].platoId, nombre: "Empanada", precio: 1000 }) }];
    db = { collections: {
      platos: { find: () => ({ exec: async () => docs }) },
      pedidos: {
        upsert: upsertOrder,
        findOne: (selector: string | { selector?: { id?: string; clientRequestId?: string } }) => {
          const id = typeof selector === "string" ? selector : selector.selector?.id ?? selector.selector?.clientRequestId;
          const find = () => orderRows.find((candidate) => candidate.id === id || candidate.clientRequestId === id);
          return {
            exec: async () => { const row = find(); return row ? makeDocument(row, orderRows) : null; },
            remove: async () => { const row = find(); if (row) orderRows.splice(orderRows.indexOf(row), 1); },
          };
        },
      },
      outbox: {
        upsert: writeOutbox,
        find: () => ({ exec: async () => outboxRows.map((row) => outboxDocs.get(String(row.id)) ?? makeDocument(row, outboxRows)) }),
        findOne: ({ selector }: { selector: { id: string } }) => ({ exec: async () => outboxRows.some((row) => row.id === selector.id) ? outboxDocs.get(selector.id) ?? null : null }),
      },
    } };
    jest.mocked(getDb).mockResolvedValue(db as never);
    jest.mocked(createPedido).mockRejectedValue(new TypeError("offline"));
  });

  it("persists the tenant-scoped command before its optimistic Pedido projection", async () => {
    await crearPedidoOffline(input, tenant, apiUrl);
    expect(outboxRows).toHaveLength(1);
    expect(orderRows).toHaveLength(1);
    const command = outboxRows[0];
    const optimistic = orderRows[0];
    expect(command).toEqual(expect.objectContaining({ ...tenant, status: "pending", attempts: 1, errorCode: "network_error" }));
    expect(JSON.parse(command.input as string)).toMatchObject({ ...input, clientRequestId: command.id });
    expect(JSON.parse(command.optimistic as string)).toEqual(optimistic);
    expect(optimistic).toMatchObject({ version: 0, cobro: null, clientRequestId: command.id, ...tenant });
    expect(optimistic).not.toHaveProperty("pagos");
    expect(writeOrder.mock.invocationCallOrder[0]).toBeGreaterThan(writeOutbox.mock.invocationCallOrder[0]);
  });

  it("rebuilds the optimistic Pedido after a crash between command and projection writes", async () => {
    failOrderWrite = true;
    await expect(crearPedidoOffline(input, tenant, apiUrl)).rejects.toThrow("quota");
    expect(outboxRows).toHaveLength(1);
    expect(orderRows).toHaveLength(0);
    await restorePendingOrders(tenant);
    expect(orderRows).toEqual([JSON.parse(outboxRows[0].optimistic as string)]);
  });

  it("counts both pending and failed commands in the active tenant only", async () => {
    addCommand("pending");
    addCommand("failed", { status: "failed", errorCode: "http_422" });
    addCommand("other-tenant", { ...otherTenant });
    await expect(getPendingCommandCount(tenant)).resolves.toBe(2);
  });

  it("retries a failed command without changing its durable payload or idempotency key", async () => {
    const originalInput = JSON.stringify({ ...input, clientRequestId: "request-1" });
    const { row, doc } = addCommand("request-1", { status: "failed", attempts: 4, retryAt: 123, errorCode: "http_422", errorMessage: "Unavailable dish" });
    row.input = originalInput;
    await retryCommand("request-1", tenant);
    expect(doc.incrementalPatch).toHaveBeenCalledWith({ status: "pending", retryAt: 0, errorCode: null, errorMessage: null });
    expect(row.id).toBe("request-1");
    expect(row.input).toBe(originalInput);
    expect(row.attempts).toBe(4);
  });

  it("keeps durable commands visible when their optimistic projection was not written", () => {
    const orphan = addCommand("orphan-command");
    const projected = addCommand("projected-command");
    const projection = { id: "projected-command", clientRequestId: "projected-command", ...tenant } as never;
    expect(commandsWithoutProjection([orphan.row, projected.row] as never, [projection])).toEqual([orphan.row]);
  });

  it("discards only the matching optimistic projection and its command", async () => {
    const { doc } = addCommand("request-1", { status: "failed" });
    const optimistic = { id: "request-1", clientRequestId: "request-1", ...tenant };
    const other = { id: "other-order", clientRequestId: "other-order", ...tenant };
    orderRows.push(optimistic, other);
    await discardCommand("request-1", tenant);
    expect(doc.remove).toHaveBeenCalledTimes(1);
    expect(orderRows).toEqual([other]);
  });

  it("never removes an authoritative server order when discarding a stale command", async () => {
    const { doc } = addCommand("request-1", { status: "failed" });
    const authoritative = { ...serverOrder("server-order", "request-1"), ...tenant };
    orderRows.push(authoritative);
    await discardCommand("request-1", tenant);
    expect(doc.remove).toHaveBeenCalledTimes(1);
    expect(orderRows).toEqual([authoritative]);
  });

  it("serializes discard behind an in-flight delivery and preserves the resulting server order", async () => {
    const { doc } = addCommand("request-1");
    const optimistic = { id: "request-1", clientRequestId: "request-1", ...tenant };
    orderRows.push(optimistic);
    let acknowledge!: (order: unknown) => void;
    jest.mocked(createPedido).mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve; }) as never);
    const flushing = flushOutbox(apiUrl, tenant);
    for (let attempt = 0; jest.mocked(createPedido).mock.calls.length === 0 && attempt < 10; attempt++) {
      await new Promise((resolveTurn) => setImmediate(resolveTurn));
    }
    expect(createPedido).toHaveBeenCalledTimes(1);
    const discarding = discardCommand("request-1", tenant);
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
    const removalsBeforeAcknowledgement = doc.remove.mock.calls.length;
    const authoritative = serverOrder();
    acknowledge(authoritative as never);
    await Promise.all([flushing, discarding]);
    expect(removalsBeforeAcknowledgement).toBe(0);
    expect(orderRows).toContainEqual(authoritative);
    expect(orderRows).not.toContainEqual(expect.objectContaining({ id: "request-1" }));
    expect(doc.remove).toHaveBeenCalledTimes(1);
  });

  it("uses the tenant Web Lock when discarding a command", async () => {
    addCommand("request-1", { status: "failed" });
    const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const request = jest.fn(async (_name: string, _options: unknown, callback: () => Promise<void>) => callback());
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request } } });
    try {
      await discardCommand("request-1", tenant);
      expect(request).toHaveBeenCalledWith(`comanda.outbox:${tenant.orgId}:${tenant.sucursalId}`, expect.objectContaining({ mode: "exclusive" }), expect.any(Function));
    } finally {
      if (previous) Object.defineProperty(globalThis, "navigator", previous);
      else Reflect.deleteProperty(globalThis, "navigator");
    }
  });

  it("does not retry or discard a command from another tenant", async () => {
    const { row, doc } = addCommand("request-1", { ...otherTenant, status: "failed" });
    await retryCommand("request-1", tenant);
    await discardCommand("request-1", tenant);
    expect(doc.incrementalPatch).not.toHaveBeenCalled();
    expect(doc.remove).not.toHaveBeenCalled();
    expect(row.status).toBe("failed");
  });

  it.each([408, 429, 500, 503])("retains HTTP %s and records bounded retry state", async (status) => {
    const { doc, row } = addCommand("request-1");
    jest.mocked(createPedido).mockRejectedValueOnce(new ApiError(status, "retry", status === 429 ? 12_000 : undefined));
    await flushOutbox(apiUrl, tenant);
    expect(doc.remove).not.toHaveBeenCalled();
    expect(doc.incrementalPatch).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", attempts: 1 }));
    expect(row.retryAt).toBeGreaterThan(Date.now());
    if (status === 429) expect((row.retryAt as number) - Date.now()).toBeGreaterThanOrEqual(11_900);
  });

  it.each([400, 403, 404, 409, 422])("marks deterministic HTTP %s failed without deleting either local record", async (status) => {
    const { doc, row } = addCommand("request-1");
    jest.mocked(createPedido).mockRejectedValueOnce(new ApiError(status, "invalid dish"));
    await flushOutbox(apiUrl, tenant);
    expect(row.status).toBe("failed");
    expect(row.errorCode).toBe(`http_${status}`);
    expect(doc.remove).not.toHaveBeenCalled();
    expect(orderRows).toHaveLength(0);
  });

  it("keeps the command if authoritative local persistence fails", async () => {
    const { doc } = addCommand("request-1");
    jest.mocked(createPedido).mockResolvedValueOnce(serverOrder() as never);
    failOrderWrite = true;
    await expect(flushOutbox(apiUrl, tenant)).rejects.toThrow("quota");
    expect(doc.remove).not.toHaveBeenCalled();
    expect(outboxRows).toHaveLength(1);
  });

  it("retains an invalid successful response for manual recovery", async () => {
    const { doc, row } = addCommand("request-1");
    jest.mocked(createPedido).mockResolvedValueOnce({ id: "bad" } as never);
    jest.mocked(pedidoSchema.safeParse).mockReturnValueOnce({ success: true, data: JSON.parse(row.optimistic as string) } as never);
    jest.mocked(pedidoSchema.safeParse).mockReturnValueOnce({ success: false, error: {} } as never);
    await flushOutbox(apiUrl, tenant);
    expect(row.status).toBe("failed");
    expect(row.errorCode).toBe("invalid_response");
    expect(doc.remove).not.toHaveBeenCalled();
  });

  it.each([
    ["different request key", { ...serverOrder(), clientRequestId: "another-request" }],
    ["different tenant", serverOrder("00000000-0000-0000-0000-000000000021", "request-1", otherTenant)],
  ])("retains a success response with %s", async (_caseName, response) => {
    const { doc, row } = addCommand("request-1");
    jest.mocked(createPedido).mockResolvedValueOnce(response as never);
    await flushOutbox(apiUrl, tenant);
    expect(row.status).toBe("failed");
    expect(row.errorCode).toBe("invalid_response");
    expect(doc.remove).not.toHaveBeenCalled();
    expect(orderRows).toHaveLength(0);
  });

  it("discards a late response after session generation and branch change", async () => {
    const { doc } = addCommand("request-1");
    let resolve!: (order: unknown) => void;
    jest.mocked(createPedido).mockImplementationOnce(() => new Promise((done) => { resolve = done; }) as never);
    const flush = flushOutbox(apiUrl, tenant);
    for (let attempt = 0; !resolve && attempt < 10; attempt++) await new Promise((resolveTurn) => setImmediate(resolveTurn));
    expect(resolve).toBeDefined();
    generation++;
    currentSession = { ...session, user: { ...session.user, ...otherTenant } };
    resolve(serverOrder() as never);
    await flush;
    expect(doc.remove).not.toHaveBeenCalled();
    expect(orderRows).toHaveLength(0);
  });

  it("coalesces concurrent flushes for the same tenant", async () => {
    const { doc } = addCommand("request-1");
    let resolve!: (order: unknown) => void;
    jest.mocked(createPedido).mockImplementationOnce(() => new Promise((done) => { resolve = done; }) as never);
    const first = flushOutbox(apiUrl, tenant);
    const second = flushOutbox(apiUrl, tenant);
    for (let attempt = 0; !resolve && attempt < 10; attempt++) await new Promise((resolveTurn) => setImmediate(resolveTurn));
    expect(resolve).toBeDefined();
    resolve(serverOrder() as never);
    await Promise.all([first, second]);
    expect(createPedido).toHaveBeenCalledTimes(1);
    expect(doc.remove).toHaveBeenCalledTimes(1);
  });

  it("uses the native Web Lock scoped to organization and branch", async () => {
    const { row } = addCommand("request-1");
    const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const request = jest.fn(async (_name: string, _options: unknown, callback: () => Promise<void>) => callback());
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request } } });
    try {
      await flushOutbox(apiUrl, tenant);
      expect(request).toHaveBeenCalledWith(`comanda.outbox:${tenant.orgId}:${tenant.sucursalId}`, expect.objectContaining({ mode: "exclusive" }), expect.any(Function));
      expect(row.attempts).toBe(1);
    } finally {
      if (previous) Object.defineProperty(globalThis, "navigator", previous);
      else Reflect.deleteProperty(globalThis, "navigator");
    }
  });

  it("reuses the same client request identity after a transient failure", async () => {
    const { row, doc } = addCommand("request-1");
    jest.mocked(createPedido).mockRejectedValueOnce(new ApiError(503, "retry"));
    await flushOutbox(apiUrl, tenant);
    const submitted = jest.mocked(createPedido).mock.calls[0][1];
    row.retryAt = 0;
    jest.mocked(createPedido).mockResolvedValueOnce(serverOrder() as never);
    await flushOutbox(apiUrl, tenant);
    expect(jest.mocked(createPedido).mock.calls[1][1]).toEqual(submitted);
    expect(jest.mocked(createPedido).mock.calls[1][1].clientRequestId).toBe("request-1");
    expect(doc.remove).toHaveBeenCalledTimes(1);
  });

  it("times out a hung request and keeps it queued for retry", async () => {
    jest.useFakeTimers();
    const { row, doc } = addCommand("request-1");
    jest.mocked(createPedido).mockImplementationOnce((_url, _input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }) as never);
    try {
      const pending = flushOutbox(apiUrl, tenant);
      await jest.advanceTimersByTimeAsync(15_000);
      await pending;
      expect(row.status).toBe("pending");
      expect(row.errorCode).toBe("network_error");
      expect(row.attempts).toBe(1);
      expect(doc.remove).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("passes an abort signal to each POST and keeps commands when cancelled", async () => {
    const { doc } = addCommand("request-1");
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    jest.mocked(createPedido).mockImplementationOnce((_url, _input, options) => {
      expect(options?.signal).toBeDefined();
      requestSignal = options?.signal;
      return new Promise((_resolve, reject) => requestSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })) as never;
    });
    const pending = flushOutbox(apiUrl, tenant, { signal: controller.signal });
    for (let attempt = 0; !requestSignal && attempt < 10; attempt++) await new Promise((resolveTurn) => setImmediate(resolveTurn));
    controller.abort();
    await pending;
    expect(doc.remove).not.toHaveBeenCalled();
    expect(outboxRows).toHaveLength(1);
  });

  it("keeps commands when the shared client reports a session change", async () => {
    const { doc, row } = addCommand("request-1");
    jest.mocked(createPedido).mockRejectedValueOnce(new SessionChangedError());
    await expect(flushOutbox(apiUrl, tenant)).resolves.toBeUndefined();
    expect(doc.remove).not.toHaveBeenCalled();
    expect(row.status).toBe("pending");
    expect(doc.incrementalPatch).not.toHaveBeenCalled();
  });

  it("suspends unauthorized delivery without deleting the command", async () => {
    const { doc, row } = addCommand("request-1");
    jest.mocked(createPedido).mockRejectedValueOnce(new ApiError(401, "unauthorized"));
    await flushOutbox(apiUrl, tenant);
    expect(row.status).toBe("pending");
    expect(row.errorCode).toBe("auth_required");
    expect(doc.remove).not.toHaveBeenCalled();
    await flushOutbox(apiUrl, tenant);
    expect(createPedido).toHaveBeenCalledTimes(1);
  });

  it("stops the drain after an unauthorized response without sending later commands", async () => {
    const first = addCommand("request-1");
    const second = addCommand("request-2");
    jest.mocked(createPedido).mockRejectedValueOnce(new ApiError(401, "unauthorized"));
    await flushOutbox(apiUrl, tenant);
    expect(createPedido).toHaveBeenCalledTimes(1);
    expect(first.row.errorCode).toBe("auth_required");
    expect(second.row.status).toBe("pending");
    expect(second.doc.incrementalPatch).not.toHaveBeenCalled();
  });

  it("blocks the tenant queue while auth is suspended and resumes after a valid session notification", async () => {
    const { row } = addCommand("request-1", { errorCode: "auth_required", retryAt: Number.MAX_SAFE_INTEGER });
    const later = addCommand("request-2");
    await flushOutbox(apiUrl, tenant);
    expect(createPedido).not.toHaveBeenCalled();
    let notify!: () => void;
    jest.mocked(subscribeSession).mockImplementation((callback) => { notify = callback; return () => {}; });
    const cleanup = setupAutoSync(apiUrl, tenant);
    try {
      expect(createPedido).not.toHaveBeenCalled();
      await new Promise((resolveTurn) => setImmediate(resolveTurn));
      expect(createPedido).not.toHaveBeenCalled();
      notify();
      for (let attempt = 0; jest.mocked(createPedido).mock.calls.length < 2 && attempt < 10; attempt++) {
        await new Promise((resolveTurn) => setImmediate(resolveTurn));
      }
      expect(row.errorCode).toBe("network_error");
      expect(later.row.errorCode).toBe("network_error");
      expect(createPedido).toHaveBeenCalledTimes(2);
    } finally {
      cleanup();
    }
  });

  it("registers and removes foreground, network and socket reconnect triggers and interval", () => {
    jest.useFakeTimers();
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const windowListeners = new Map<string, () => void>();
    const documentListeners = new Map<string, () => void>();
    const fakeWindow = {
      addEventListener: jest.fn((event: string, listener: () => void) => windowListeners.set(event, listener)),
      removeEventListener: jest.fn((event: string) => windowListeners.delete(event)),
    };
    const fakeDocument = {
      visibilityState: "visible",
      addEventListener: jest.fn((event: string, listener: () => void) => documentListeners.set(event, listener)),
      removeEventListener: jest.fn((event: string) => documentListeners.delete(event)),
    };
    const socket = { on: jest.fn(), off: jest.fn() };
    try {
      Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
      Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });
      const cleanup = setupAutoSync(apiUrl, tenant, jest.fn(), socket);
      expect(windowListeners.has("online")).toBe(true);
      expect(windowListeners.has("focus")).toBe(true);
      expect(documentListeners.has("visibilitychange")).toBe(true);
      expect(socket.on).toHaveBeenCalledWith("connect", expect.any(Function));
      expect(jest.getTimerCount()).toBe(1);
      cleanup();
      expect(windowListeners.size).toBe(0);
      expect(documentListeners.size).toBe(0);
      expect(socket.off).toHaveBeenCalledWith("connect", expect.any(Function));
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
      if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
      else Reflect.deleteProperty(globalThis, "document");
    }
  });

  it("checks only due commands on the five-second interval and socket reconnect", async () => {
    jest.useFakeTimers();
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const socketListeners = new Map<string, () => void>();
    const fakeWindow = { addEventListener: jest.fn(), removeEventListener: jest.fn() };
    const fakeDocument = { visibilityState: "visible", addEventListener: jest.fn(), removeEventListener: jest.fn() };
    const socket = {
      on: jest.fn((event: string, listener: () => void) => socketListeners.set(event, listener)),
      off: jest.fn(),
    };
    const { row } = addCommand("request-1");
    try {
      Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
      Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });
      const cleanup = setupAutoSync(apiUrl, tenant, undefined, socket);
      await jest.advanceTimersByTimeAsync(0);
      expect(createPedido).toHaveBeenCalledTimes(1);
      row.retryAt = Date.now() + 10_000;
      await jest.advanceTimersByTimeAsync(5_000);
      expect(createPedido).toHaveBeenCalledTimes(1);
      row.retryAt = 0;
      socketListeners.get("connect")?.();
      await jest.advanceTimersByTimeAsync(0);
      expect(createPedido).toHaveBeenCalledTimes(2);
      cleanup();
    } finally {
      jest.useRealTimers();
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
      if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
      else Reflect.deleteProperty(globalThis, "document");
    }
  });

  it("does not send a command whose durable tenant or request identity is inconsistent", async () => {
    addCommand("request-1", { input: JSON.stringify({ ...input, clientRequestId: "another-request" }) });
    await flushOutbox(apiUrl, tenant);
    expect(createPedido).not.toHaveBeenCalled();
    expect(outboxRows[0].status).toBe("failed");
  });
});
