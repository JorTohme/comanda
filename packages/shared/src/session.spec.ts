import {
  SessionChangedError,
  clearSession,
  ensureFreshSession,
  getSessionGeneration,
  readSession,
  saveSession,
  subscribeSession,
} from "./session";

const user = {
  id: "00000000-0000-0000-0000-000000000001",
  nombre: "Ana",
  email: "ana@test.com",
  rol: "admin" as const,
  orgId: "00000000-0000-0000-0000-000000000011",
  sucursalId: "00000000-0000-0000-0000-000000000012",
};
const original = { accessToken: "old-access", refreshToken: "old-refresh", user };
const replacement = { accessToken: "new-access", refreshToken: "new-refresh", user };
const baseUrl = "http://api.test";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: jest.fn((key: string) => data.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => { data.set(key, value); }),
    removeItem: jest.fn((key: string) => { data.delete(key); }),
  };
}

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body === undefined ? "" : JSON.stringify(body),
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("shared browser session", () => {
  let storage: ReturnType<typeof fakeStorage>;
  const oldStorage = (globalThis as { localStorage?: unknown }).localStorage;
  const oldNavigator = (globalThis as { navigator?: unknown }).navigator;
  const oldWindow = (globalThis as { window?: unknown }).window;
  const oldFetch = global.fetch;

  beforeEach(() => {
    storage = fakeStorage();
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    (globalThis as { navigator?: unknown }).navigator = {};
  });

  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = oldStorage;
    (globalThis as { navigator?: unknown }).navigator = oldNavigator;
    (globalThis as { window?: unknown }).window = oldWindow;
    global.fetch = oldFetch;
    jest.restoreAllMocks();
  });

  it("writes one validated document and notifies subscribers", () => {
    const onChange = jest.fn();
    const unsubscribe = subscribeSession(onChange);
    const before = getSessionGeneration();

    saveSession(original);

    expect(JSON.parse(storage.getItem("comanda.session")!)).toEqual(original);
    expect(storage.getItem("comanda.accessToken")).toBeNull();
    expect(readSession()).toEqual(original);
    expect(getSessionGeneration()).toBe(before + 1);
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    clearSession();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid session before storing it", () => {
    expect(() => saveSession({ ...original, user: { ...user, orgId: "not-a-uuid" } })).toThrow();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("migrates complete legacy keys once", () => {
    const storage = fakeStorage({
      "comanda.accessToken": original.accessToken,
      "comanda.refreshToken": original.refreshToken,
      "comanda.user": JSON.stringify(user),
    });
    (globalThis as { localStorage?: unknown }).localStorage = storage;

    expect(readSession()).toEqual(original);
    expect(JSON.parse(storage.getItem("comanda.session")!)).toEqual(original);
    expect(storage.getItem("comanda.accessToken")).toBeNull();
    expect(storage.getItem("comanda.refreshToken")).toBeNull();
    expect(storage.getItem("comanda.user")).toBeNull();
    expect(readSession()).toEqual(original);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it("does not trust partial legacy credentials or access browser storage on the server", () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage({
      "comanda.accessToken": original.accessToken,
      "comanda.refreshToken": original.refreshToken,
    });
    expect(readSession()).toBeNull();
    (globalThis as { localStorage?: unknown }).localStorage = undefined;
    expect(readSession()).toBeNull();
  });

  it("shares one refresh request between concurrent callers", async () => {
    saveSession(original);
    const pendingResponse = deferredResponse();
    const fetchMock = jest.fn().mockReturnValue(pendingResponse.promise);
    global.fetch = fetchMock as unknown as typeof fetch;

    const calls = [ensureFreshSession(baseUrl, original.accessToken), ensureFreshSession(baseUrl, original.accessToken)];
    pendingResponse.resolve(response(200, replacement));

    expect(await Promise.all(calls)).toEqual([replacement, replacement]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/auth/refresh");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refreshToken: original.refreshToken });
  });

  it("does not resurrect a logged-out session after refresh completes", async () => {
    saveSession(original);
    const pendingResponse = deferredResponse();
    global.fetch = jest.fn().mockReturnValue(pendingResponse.promise) as unknown as typeof fetch;
    const pending = ensureFreshSession(baseUrl, original.accessToken);
    clearSession();
    pendingResponse.resolve(response(200, replacement));

    await expect(pending).rejects.toBeInstanceOf(SessionChangedError);
    expect(readSession()).toBeNull();
  });

  it("does not overwrite a branch switch that occurs during refresh", async () => {
    saveSession(original);
    const pendingResponse = deferredResponse();
    global.fetch = jest.fn().mockReturnValue(pendingResponse.promise) as unknown as typeof fetch;
    const pending = ensureFreshSession(baseUrl, original.accessToken);
    const switched = { ...replacement, user: { ...user, sucursalId: "00000000-0000-0000-0000-000000000099" } };
    saveSession(switched);
    pendingResponse.resolve(response(200, replacement));

    await expect(pending).rejects.toBeInstanceOf(SessionChangedError);
    expect(readSession()).toEqual(switched);
  });

  it("preserves stored credentials after a transient provider failure", async () => {
    saveSession(original);
    global.fetch = jest.fn().mockResolvedValue(response(503)) as unknown as typeof fetch;

    await expect(ensureFreshSession(baseUrl, original.accessToken)).rejects.toMatchObject({ status: 503 });
    expect(readSession()).toEqual(original);
  });

  it("clears only the unchanged session after confirmed invalid refresh", async () => {
    saveSession(original);
    global.fetch = jest.fn().mockResolvedValue(response(401)) as unknown as typeof fetch;

    await expect(ensureFreshSession(baseUrl, original.accessToken)).rejects.toMatchObject({ status: 401 });
    expect(readSession()).toBeNull();
  });

  it("rereads the stored token inside the Web Lock before sending refresh", async () => {
    saveSession(original);
    const request = jest.fn(async (_name: string, callback: () => Promise<unknown>) => {
      saveSession(replacement);
      return callback();
    });
    (globalThis as { navigator?: unknown }).navigator = { locks: { request } };
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(ensureFreshSession(baseUrl, original.accessToken)).resolves.toEqual(replacement);
    expect(request).toHaveBeenCalledWith("comanda.session.refresh", expect.any(Function));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
