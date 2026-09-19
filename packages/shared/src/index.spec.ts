import {
  categoriaSchema,
  centavosToPesos,
  createCategoria,
  listCategorias,
  pesosToCentavos,
  posicionPorDefecto,
  setSessionExpiredHandler,
  switchSucursal,
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
    rol: "admin",
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
    const storage = fakeStorage({ "comanda.accessToken": "old-token", "comanda.refreshToken": "old-refresh" });
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
    expect(storage.setItem).toHaveBeenCalledWith("comanda.accessToken", "new-access-token");
    expect(storage.setItem).toHaveBeenCalledWith("comanda.refreshToken", "new-refresh-token");
  });

  it("clears storage and notifies the session-expired handler when the refresh call itself fails", async () => {
    const storage = fakeStorage({ "comanda.accessToken": "old-token", "comanda.refreshToken": "old-refresh" });
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
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("refreshes without sending a client-controlled sucursal hint", async () => {
    const expiringToken = "old-access-token";
    const storage = fakeStorage({ "comanda.accessToken": expiringToken, "comanda.refreshToken": "old-refresh" });
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
    const userCall = storage.setItem.mock.calls.find(([key]) => key === "comanda.user");
    expect(userCall && JSON.parse(userCall[1])).toEqual(NEW_SESSION.user);
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
