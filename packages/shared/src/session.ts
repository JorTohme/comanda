import { authSessionSchema, type AuthSession } from "./auth-contract";

const sessionKey = "comanda.session";
const legacyKeys = ["comanda.accessToken", "comanda.refreshToken", "comanda.user"] as const;
const listeners = new Set<() => void>();
const inFlight = new Map<string, Promise<AuthSession>>();
let generation = 0;
let warnedWithoutLocks = false;

type SessionStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function storage(): SessionStorage | undefined {
  return (globalThis as { localStorage?: SessionStorage }).localStorage;
}

function notify(): void {
  generation++;
  listeners.forEach((listener) => listener());
}

function parseSession(raw: string | null): AuthSession | null {
  if (!raw) return null;
  try {
    const parsed = authSessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function getSessionGeneration(): number { return generation; }

export function readSession(): AuthSession | null {
  const store = storage();
  if (!store) return null;
  const canonical = store.getItem(sessionKey);
  if (canonical !== null) return parseSession(canonical);
  const [accessToken, refreshToken, rawUser] = legacyKeys.map((key) => store.getItem(key));
  if (!accessToken || !refreshToken || !rawUser) return null;
  let migrated: AuthSession | null = null;
  try {
    migrated = parseSession(JSON.stringify({ accessToken, refreshToken, user: JSON.parse(rawUser) }));
  } catch { /* Malformed legacy data is not an authenticated session. */ }
  if (!migrated) return null;
  saveSession(migrated);
  return migrated;
}

export function saveSession(session: AuthSession): void {
  const validated = authSessionSchema.parse(session);
  const store = storage();
  if (!store) throw new Error("Browser storage unavailable");
  store.setItem(sessionKey, JSON.stringify(validated));
  legacyKeys.forEach((key) => store.removeItem(key));
  notify();
}

export function clearSession(): void {
  const store = storage();
  if (!store) return;
  store.removeItem(sessionKey);
  legacyKeys.forEach((key) => store.removeItem(key));
  notify();
}

function onStorage(event: { key: string | null }): void {
  if (event.key === sessionKey || event.key === null) notify();
}

export function subscribeSession(handler: () => void): () => void {
  const browserWindow = (globalThis as { window?: { addEventListener(type: string, callback: (event: { key: string | null }) => void): void; removeEventListener(type: string, callback: (event: { key: string | null }) => void): void } }).window;
  if (listeners.size === 0) browserWindow?.addEventListener("storage", onStorage);
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
    if (listeners.size === 0) browserWindow?.removeEventListener("storage", onStorage);
  };
}

export class SessionChangedError extends Error {
  constructor() { super("Session changed while request was pending"); this.name = "SessionChangedError"; }
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly retryAfterMs?: number) {
    super(message);
    this.name = "ApiError";
  }
}

function retryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) ? Math.min(3_600_000, Math.max(0, milliseconds)) : undefined;
}

export function responseError(response: Response, method: string, url: string): ApiError {
  return new ApiError(response.status, `Request failed: ${method} ${url} (${response.status})`, retryAfterMs(response.headers?.get("Retry-After")));
}

function tokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now() + 30_000;
  } catch {
    return true;
  }
}

function sameIdentity(first: AuthSession, second: AuthSession): boolean {
  return first.user.id === second.user.id && first.user.orgId === second.user.orgId && first.user.sucursalId === second.user.sucursalId;
}

function assertUnchanged(expected: AuthSession, expectedGeneration: number): void {
  const current = readSession();
  if (generation !== expectedGeneration || !current || current.refreshToken !== expected.refreshToken || !sameIdentity(current, expected)) {
    throw new SessionChangedError();
  }
}

export function ensureFreshSession(baseUrl: string, failedAccessToken?: string): Promise<AuthSession> {
  const started = readSession();
  if (!started) return Promise.reject(new ApiError(401, "No active session"));
  const origin = new URL(baseUrl).origin;
  const key = `${origin}|${started.refreshToken}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const run = async (): Promise<AuthSession> => {
    const locked = async (): Promise<AuthSession> => {
      const current = readSession();
      if (!current || !sameIdentity(started, current)) throw new SessionChangedError();
      if (failedAccessToken && current.accessToken !== failedAccessToken) return current;
      if (!failedAccessToken && !tokenExpired(current.accessToken)) return current;
      const currentGeneration = generation;
      const url = `${origin}/auth/refresh`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      assertUnchanged(current, currentGeneration);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) clearSession();
        throw responseError(response, "POST", url);
      }
      const next = authSessionSchema.parse(await response.json());
      assertUnchanged(current, currentGeneration);
      if (!sameIdentity(current, next)) throw new SessionChangedError();
      saveSession(next);
      return next;
    };

    const navigator = (globalThis as { navigator?: { locks?: { request<T>(name: string, callback: () => Promise<T>): Promise<T> } } }).navigator;
    if (navigator?.locks) return navigator.locks.request("comanda.session.refresh", locked);
    if (!warnedWithoutLocks && (globalThis as { window?: unknown }).window) {
      console.warn("Cross-tab refresh coordination unavailable; using in-tab coordination only");
      warnedWithoutLocks = true;
    }
    return locked();
  };

  const pending = run();
  inFlight.set(key, pending);
  void pending.then(() => inFlight.delete(key), () => inFlight.delete(key));
  return pending;
}
