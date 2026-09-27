const mockIo = jest.fn();
jest.mock("socket.io-client", () => ({ io: (...args: unknown[]) => mockIo(...args) }));

import {
  categoriaSchema,
  centavosToPesos,
  clearSession,
  createCategoria,
  listCategorias,
  acceptInvitation,
  pesosToCentavos,
  posicionPorDefecto,
  saveSession,
  SessionChangedError,
  setSessionExpiredHandler,
  switchSucursal,
  canActOnPedido,
  connectRealtime,
  updateDisponibilidadPlato,
  updateEstadoMesa,
} from "./index";

describe("centavosToPesos", () => {
  it("formats whole pesos with two decimals", () => {
    expect(centavosToPesos(1550)).toBe("15.50");
  });

  it("formats zero", () => {
    expect(centavosToPesos(0)).toBe("0.00");
  });

  it("pads single-digit centavos", () => {
    expect(centavosToPesos(105)).toBe("1.05");
  });
});

describe("pesosToCentavos", () => {
  it("parses a two-decimal string", () => {
    expect(pesosToCentavos("15.50")).toBe(1550);
  });

  it("parses zero", () => {
    expect(pesosToCentavos("0.00")).toBe(0);
  });

  it("parses a one-decimal string as if trailing-zero padded", () => {
    expect(pesosToCentavos("15.5")).toBe(1550);
  });

  it("parses a whole-number string with no decimal point", () => {
    expect(pesosToCentavos("20")).toBe(2000);
  });
});

describe("round-trip", () => {
  it("survives centavos -> pesos -> centavos without float drift", () => {
    for (const centavos of [0, 1, 5, 99, 100, 1550, 999999]) {
      expect(pesosToCentavos(centavosToPesos(centavos))).toBe(centavos);
    }
  });
});

describe("posicionPorDefecto", () => {
  it("stays within 0-100 on both axes for the first 20 indices", () => {
    for (let i = 0; i < 20; i++) {
      const { x, y } = posicionPorDefecto(i);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives different positions for consecutive indices", () => {
    expect(posicionPorDefecto(0)).not.toEqual(posicionPorDefecto(1));
  });

  it("is deterministic for the same index", () => {
    expect(posicionPorDefecto(3)).toEqual(posicionPorDefecto(3));
  });
});

describe("runtime contracts", () => {
  it("rejects a category response that is not tenant-scoped", () => {
    expect(() =>
      categoriaSchema.parse({
        id: "00000000-0000-0000-0000-000000000001",
        nombre: "Bebidas",
        createdAt: "2026-09-15T00:00:00.000Z",
        updatedAt: "2026-09-15T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

function fakeResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
    json: async () => body,
  } as Response;
}

function fakeStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: jest.fn((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
  };
}

const NEW_SESSION = {
  accessToken: "new-access-token",
  refreshToken: "new-refresh-token",
  user: {
    id: "00000000-0000-0000-0000-000000000001",
    nombre: "Ana",
    email: "ana@test.com",
    rol: "admin" as const,
    orgId: "00000000-0000-0000-0000-000000000011",
    sucursalId: "00000000-0000-0000-0000-000000000012",
  },
};

describe("apiFetch 401 retry (via listCategorias)", () => {
  const originalFetch = global.fetch;
  const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

  afterEach(() => {
    global.fetch = originalFetch;
    (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
    setSessionExpiredHandler(() => {});
  });

  it("refreshes the session once on 401, updates storage, and retries the original request", async () => {
    const storage = fakeStorage({ "comanda.accessToken": "old-token", "comanda.refreshToken": "old-refresh", "comanda.user": JSON.stringify(NEW_SESSION.user) });
    (globalThis as { localStorage?: unknown }).localStorage = storage;

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(fakeResponse(401))
      .mockResolvedValueOnce(fakeResponse(200, NEW_SESSION))
      .mockResolvedValueOnce(fakeResponse(200, []));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await listCategorias("http://api.test");

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("http://api.test/auth/refresh");
    expect(JSON.parse(storage.getItem("comanda.session")!)).toEqual(NEW_SESSION);
  });

  it("clears storage and notifies the session-expired handler when the refresh call itself fails", async () => {
    const storage = fakeStorage({ "comanda.accessToken": "old-token", "comanda.refreshToken": "old-refresh", "comanda.user": JSON.stringify(NEW_SESSION.user) });
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    const handler = jest.fn();
    setSessionExpiredHandler(handler);

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(fakeResponse(401))
      .mockResolvedValueOnce(fakeResponse(401));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(listCategorias("http://api.test")).rejects.toThrow();

    expect(storage.removeItem).toHaveBeenCalledWith("comanda.accessToken");
    expect(storage.removeItem).toHaveBeenCalledWith("comanda.refreshToken");
    expect(storage.removeItem).toHaveBeenCalledWith("comanda.session");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("refreshes without sending a client-controlled sucursal hint", async () => {
    const expiringToken = "old-access-token";
    const storage = fakeStorage({ "comanda.accessToken": expiringToken, "comanda.refreshToken": "old-refresh", "comanda.user": JSON.stringify(NEW_SESSION.user) });
    (globalThis as { localStorage?: unknown }).localStorage = storage;

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(fakeResponse(401))
      .mockResolvedValueOnce(fakeResponse(200, NEW_SESSION))
      .mockResolvedValueOnce(fakeResponse(200, []));
    global.fetch = fetchMock as unknown as typeof fetch;

    await listCategorias("http://api.test");

    const [, refreshInit] = fetchMock.mock.calls[1];
    expect(JSON.parse(refreshInit.body as string)).toEqual({
      refreshToken: "old-refresh",
    });
    expect(JSON.parse(storage.getItem("comanda.session")!).user).toEqual(NEW_SESSION.user);
  });

  it("sends Content-Type: application/json on a write request (regression: apiFetch dropped this on the initial call)", async () => {
    const storage = fakeStorage({ "comanda.accessToken": "token", "comanda.refreshToken": "refresh" });
    (globalThis as { localStorage?: unknown }).localStorage = storage;

    const fetchMock = jest.fn().mockResolvedValueOnce(fakeResponse(200, {
      id: "00000000-0000-0000-0000-000000000001",
      nombre: "Bebidas",
      orgId: "00000000-0000-0000-0000-000000000011",
      sucursalId: "00000000-0000-0000-0000-000000000012",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await createCategoria("http://api.test", { nombre: "Bebidas" });

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("reads one canonical session and retries parallel 401s with one refresh", async () => {
    const storage = fakeStorage({ "comanda.session": JSON.stringify({ ...NEW_SESSION, accessToken: "old-token", refreshToken: "old-refresh" }) });
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(fakeResponse(401))
      .mockResolvedValueOnce(fakeResponse(401))
      .mockResolvedValueOnce(fakeResponse(200, NEW_SESSION))
      .mockResolvedValue(fakeResponse(200, []));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await Promise.all([listCategorias("http://api.test"), listCategorias("http://api.test")]);

    expect(result).toEqual([[], []]);
    expect(fetchMock.mock.calls.filter(([url]) => url === "http://api.test/auth/refresh")).toHaveLength(1);
    expect(JSON.parse(storage.getItem("comanda.session")!)).toEqual(NEW_SESSION);
    expect(storage.setItem).not.toHaveBeenCalledWith("comanda.accessToken", expect.any(String));
  });

  it("preserves a canonical session after transient refresh failure", async () => {
    const old = { ...NEW_SESSION, accessToken: "old-token", refreshToken: "old-refresh" };
    const storage = fakeStorage({ "comanda.session": JSON.stringify(old) });
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    const handler = jest.fn();
    setSessionExpiredHandler(handler);
    global.fetch = jest.fn()
      .mockResolvedValueOnce(fakeResponse(401))
      .mockResolvedValueOnce(fakeResponse(503)) as unknown as typeof fetch;

    await expect(listCategorias("http://api.test")).rejects.toMatchObject({ status: 503 });
    expect(storage.getItem("comanda.session")).toBe(JSON.stringify(old));
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes the abort signal to authenticated requests", async () => {
    const storage = fakeStorage({ "comanda.session": JSON.stringify(NEW_SESSION) });
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    const controller = new AbortController();
    const fetchMock = jest.fn().mockResolvedValue(fakeResponse(200, []));
    global.fetch = fetchMock as unknown as typeof fetch;

    await listCategorias("http://api.test", { signal: controller.signal });

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it("does not auto-refresh a caller-supplied token", async () => {
    const storage = fakeStorage({ "comanda.session": JSON.stringify(NEW_SESSION) });
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    const fetchMock = jest.fn().mockResolvedValue(fakeResponse(401));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(listCategorias("http://api.test", { accessToken: "supplied" })).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(storage.getItem("comanda.session")).not.toBeNull();
  });

  it("rejects a late successful response after logout", async () => {
    const storage = fakeStorage({ "comanda.session": JSON.stringify(NEW_SESSION) });
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    let resolve!: (res: Response) => void;
    const fetchMock = jest.fn().mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const pending = listCategorias("http://api.test");
    clearSession();
    resolve(fakeResponse(200, []));

    await expect(pending).rejects.toThrow("Session changed");
  });

  it("rejects an unauthenticated response that arrives after a new login", async () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage();
    let resolve!: (res: Response) => void;
    global.fetch = jest.fn().mockReturnValue(new Promise<Response>((done) => { resolve = done; })) as unknown as typeof fetch;
    const pending = listCategorias("http://api.test");
    saveSession(NEW_SESSION);
    resolve(fakeResponse(200, []));

    await expect(pending).rejects.toBeInstanceOf(SessionChangedError);
  });

  it("exposes a bounded Retry-After delay on HTTP errors", async () => {
    const storage = fakeStorage({ "comanda.session": JSON.stringify(NEW_SESSION) });
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    const throttled = fakeResponse(429);
    Object.assign(throttled, { headers: { get: () => "7200" } });
    global.fetch = jest.fn().mockResolvedValue(throttled) as unknown as typeof fetch;

    await expect(listCategorias("http://api.test")).rejects.toMatchObject({ status: 429, retryAfterMs: 3_600_000 });
  });

});


describe("switchSucursal", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts to /auth/switch-sucursal and parses the returned session", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(fakeResponse(200, NEW_SESSION));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await switchSucursal("http://api.test", NEW_SESSION.user.sucursalId);

    expect(result).toEqual(NEW_SESSION);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/auth/switch-sucursal");
    expect(JSON.parse(init.body as string)).toEqual({ sucursalId: NEW_SESSION.user.sucursalId });
  });
});

describe("acceptInvitation", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts only token, name, and password to the public acceptance endpoint", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(fakeResponse(200, NEW_SESSION));
    global.fetch = fetchMock as unknown as typeof fetch;

    await acceptInvitation("http://api.test", {
      token: "opaque-invitation-token",
      nombre: "María",
      password: "correct-horse-battery-staple",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/auth/invitations/accept");
    expect(JSON.parse(init.body as string)).toEqual({
      token: "opaque-invitation-token",
      nombre: "María",
      password: "correct-horse-battery-staple",
    });
  });
});

describe("client action policy", () => {
  it("allows only roles that can perform the requested order transition", () => {
    expect(canActOnPedido("cocina", "en_preparacion")).toBe(true);
    expect(canActOnPedido("cocina", "cobrado")).toBe(false);
    expect(canActOnPedido("mozo", "entregado")).toBe(true);
    expect(canActOnPedido("mozo", "cerrado")).toBe(false);
    expect(canActOnPedido("caja", "cerrado")).toBe(true);
  });
});

describe("realtime authentication", () => {
  const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
  afterEach(() => {
    clearSession();
    mockIo.mockReset();
    (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
  });

  it("reads the live session when Socket.IO requests handshake auth", async () => {
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 })).replace(/=/g, "");
    const latestSession = { ...NEW_SESSION, accessToken: `header.${payload}.signature` };
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage();
    saveSession(latestSession);
    const socket = { connect: jest.fn(), disconnect: jest.fn(), on: jest.fn() };
    mockIo.mockReturnValue(socket);

    (connectRealtime as unknown as (baseUrl: string) => unknown)("http://api.test");
    const options = mockIo.mock.calls[0][1] as { auth: (done: (value: unknown) => void) => void; autoConnect: boolean };
    const handshake = new Promise<unknown>((resolve) => options.auth(resolve));

    await expect(handshake).resolves.toEqual({ token: latestSession.accessToken });
    expect(options.autoConnect).toBe(false);
    expect(socket.connect).toHaveBeenCalledTimes(1);

    const renewedToken = `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900 })).replace(/=/g, "")}.signature`;
    const renewedSession = { ...latestSession, accessToken: renewedToken, refreshToken: "new-refresh-token" };
    saveSession(renewedSession);
    const disconnected = socket.on.mock.calls.find(([event]) => event === "disconnect")?.[1] as (reason: string) => void;
    disconnected("io server disconnect");
    expect(socket.connect).toHaveBeenCalledTimes(2);
    const reconnectAuth = new Promise<unknown>((resolve) => options.auth(resolve));
    await expect(reconnectAuth).resolves.toEqual({ token: renewedToken });
  });
});

describe("role-specific update endpoints", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it("uses the dedicated availability and occupancy endpoints", async () => {
    const tenant = { orgId: NEW_SESSION.user.orgId, sucursalId: NEW_SESSION.user.sucursalId };
    const base = { createdAt: "2026-09-27T00:00:00.000Z", updatedAt: "2026-09-27T00:00:00.000Z" };
    const plato = { ...base, ...tenant, id: "00000000-0000-0000-0000-000000000021", nombre: "Tarta", precio: 1200, disponible: false, categoriaId: "00000000-0000-0000-0000-000000000022" };
    const mesa = { ...base, ...tenant, id: "00000000-0000-0000-0000-000000000023", nombre: "1", capacidad: 4, estado: "ocupada" as const };
    const fetchMock = jest.fn().mockResolvedValueOnce(fakeResponse(200, plato)).mockResolvedValueOnce(fakeResponse(200, mesa));
    global.fetch = fetchMock as unknown as typeof fetch;

    await updateDisponibilidadPlato("http://api.test", plato.id, false);
    await updateEstadoMesa("http://api.test", mesa.id, "ocupada");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `http://api.test/platos/${plato.id}/disponibilidad`,
      `http://api.test/mesas/${mesa.id}/estado`,
    ]);
  });
});
