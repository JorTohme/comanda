import type { TenantContext } from "@comanda/shared";

type LegacyEntry = Record<string, unknown> & { id?: unknown; input?: unknown; createdAt?: unknown };
type LegacyPedido = Record<string, unknown> | null | undefined;

export type LegacyAssessment =
  | { disposition: "recoverable"; tenant: TenantContext; input: Record<string, unknown>; optimistic: Record<string, unknown>; raw: string }
  | { disposition: "quarantined"; reason: string; raw: string };

function serializeRaw(entry: unknown, optimistic: unknown): string {
  try {
    return JSON.stringify({ entry, optimistic });
  } catch {
    return JSON.stringify({ entry: String(entry), optimistic: String(optimistic) });
  }
}

export function branchDatabaseName(tenant: TenantContext): string {
  return `comanda-operativa-${tenant.orgId}-${tenant.sucursalId}`;
}

export function assessLegacyCommand(
  databaseName: string,
  tenant: TenantContext,
  entry: LegacyEntry,
  optimistic: LegacyPedido,
): LegacyAssessment {
  const raw = serializeRaw(entry, optimistic);
  if (databaseName !== branchDatabaseName(tenant)) return { disposition: "quarantined", reason: "database_tenant_unproven", raw };
  if (!optimistic || optimistic.id !== entry.id || optimistic.clientRequestId !== entry.id || optimistic.orgId !== tenant.orgId || optimistic.sucursalId !== tenant.sucursalId) {
    return { disposition: "quarantined", reason: "optimistic_tenant_unproven", raw };
  }
  if (typeof entry.id !== "string" || typeof entry.input !== "string") return { disposition: "quarantined", reason: "invalid_legacy_record", raw };
  let input: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(entry.input);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid command");
    input = parsed as Record<string, unknown>;
  } catch {
    return { disposition: "quarantined", reason: "invalid_legacy_json", raw };
  }
  if (input.clientRequestId !== entry.id) return { disposition: "quarantined", reason: "legacy_request_id_mismatch", raw };
  return { disposition: "recoverable", tenant, input, optimistic, raw };
}

export function migrateLegacyOutboxRecord(entry: LegacyEntry): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: typeof entry.id === "string" ? entry.id : crypto.randomUUID(),
    // Empty tenant values are an explicit quarantine marker, never an inferred tenant.
    orgId: "",
    sucursalId: "",
    input: typeof entry.input === "string" ? entry.input : JSON.stringify(entry.input ?? null),
    optimistic: "",
    status: "failed",
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : now,
    attempts: 0,
    retryAt: 0,
    errorCode: "legacy_recovery_required",
    errorMessage: "Verificá los datos locales anteriores antes de volver a enviarlos.",
    legacyRaw: JSON.stringify(entry),
  };
}

function logicalDatabaseName(physicalName: string): string | null {
  const prefix = "rxdb-dexie-";
  if (!physicalName.startsWith(prefix)) return null;
  const remainder = physicalName.slice(prefix.length);
  const separator = remainder.indexOf("--");
  return separator > 0 ? remainder.slice(0, separator) : null;
}

export function findLegacyDatabaseNames(physicalNames: string[], orgId: string): string[] {
  const oldOrganizationDatabase = `comanda-operativa-${orgId}`;
  return physicalNames.filter((name) => {
    const logical = logicalDatabaseName(name);
    return logical === "comanda-operativa" || logical === oldOrganizationDatabase;
  });
}

export interface LegacyDatabaseSnapshot {
  name: string;
  stores: Record<string, unknown[]>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo leer el almacenamiento local antiguo."));
  });
}

function openExistingDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name);
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      resolve(null);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      if (request.error?.name === "AbortError" || request.error?.name === "NotFoundError") resolve(null);
      else reject(request.error ?? new Error("No se pudo abrir el almacenamiento local antiguo."));
    };
  });
}

export async function readLegacyDatabase(name: string, factory: IDBFactory): Promise<LegacyDatabaseSnapshot | null> {
  const database = await openExistingDatabase(factory, name);
  if (!database) return null;
  try {
    const stores = Object.fromEntries(await Promise.all(
      Array.from(database.objectStoreNames).map(async (storeName) => {
        const transaction = database.transaction(storeName, "readonly");
        return [storeName, await requestResult(transaction.objectStore(storeName).getAll())] as const;
      }),
    ));
    return { name, stores };
  } finally {
    database.close();
  }
}

export async function listLegacyDatabaseNames(orgId: string): Promise<string[]> {
  const factory = (globalThis as typeof globalThis & { indexedDB?: IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> } }).indexedDB;
  if (!factory) return [];
  if (factory.databases) {
    const databases = await factory.databases();
    return findLegacyDatabaseNames(databases.map(({ name }) => name).filter((name): name is string => Boolean(name)), orgId);
  }

  const logicalNames = ["comanda-operativa", `comanda-operativa-${orgId}`];
  const collections = ["mesas", "platos", "pedidos", "outbox"];
  return logicalNames.flatMap((logical) => collections.flatMap((collection) => [0, 1].map(
    (version) => `rxdb-dexie-${logical}--${version}--${collection}`,
  )));
}

export async function exportLegacyDatabases(orgId: string): Promise<LegacyDatabaseSnapshot[]> {
  const factory = (globalThis as typeof globalThis & { indexedDB?: IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> } }).indexedDB;
  if (!factory) throw new Error("El navegador no permite leer el almacenamiento local antiguo.");
  const names = await listLegacyDatabaseNames(orgId);
  return (await Promise.all(names.map((name) => readLegacyDatabase(name, factory)))).filter((entry): entry is LegacyDatabaseSnapshot => entry !== null);
}
