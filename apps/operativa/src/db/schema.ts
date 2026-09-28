import { addRxPlugin, createRxDatabase, type RxDatabase, type RxJsonSchema } from "rxdb";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import type { Mesa, Plato, Pedido } from "@comanda/shared";
import { migrateLegacyOutboxRecord } from "./legacy-recovery";

export type PedidoOffline = Pedido;

addRxPlugin(RxDBMigrationSchemaPlugin);
if (import.meta.env.DEV) addRxPlugin(RxDBDevModePlugin);

export interface OutboxEntry {
  id: string; // = clientRequestId
  orgId: string;
  sucursalId: string;
  input: string; // JSON.stringify(CreatePedidoInput)
  optimistic: string; // JSON.stringify(Pedido)
  status: "pending" | "failed";
  createdAt: string;
  attempts: number;
  retryAt: number;
  errorCode: string | null;
  errorMessage: string | null;
  legacyRaw: string; // Original schema payload retained for safe export/recovery.
}

const mesaSchema: RxJsonSchema<Mesa> = {
  version: 1,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    orgId: { type: "string" },
    sucursalId: { type: "string" },
    nombre: { type: "string" },
    capacidad: { type: "number" },
    estado: { type: "string" },
    posX: { type: ["number", "null"] },
    posY: { type: ["number", "null"] },
    rotacion: { type: ["number", "null"] },
    forma: { type: ["string", "null"] },
    ancho: { type: ["number", "null"] },
    alto: { type: ["number", "null"] },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
  required: ["id", "orgId", "sucursalId", "nombre", "capacidad", "estado"],
} as RxJsonSchema<Mesa>;

const platoSchema: RxJsonSchema<Plato> = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    orgId: { type: "string" },
    sucursalId: { type: "string" },
    nombre: { type: "string" },
    precio: { type: "number" },
    disponible: { type: "boolean" },
    categoriaId: { type: "string" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
  required: ["id", "orgId", "sucursalId", "nombre", "precio", "disponible", "categoriaId"],
} as RxJsonSchema<Plato>;

const pedidoSchema: RxJsonSchema<PedidoOffline> = {
  version: 2,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    orgId: { type: "string" },
    sucursalId: { type: "string" },
    tipoServicio: { type: "string" },
    mesaId: { type: ["string", "null"] },
    plataforma: { type: ["string", "null"] },
    direccionEnvio: { type: ["string", "null"] },
    estado: { type: "string" },
    version: { type: "number", minimum: 0 },
    cobro: {
      type: ["object", "null"],
      properties: {
        id: { type: "string" }, pedidoId: { type: "string" }, orgId: { type: "string" }, sucursalId: { type: "string" },
        monto: { type: "number" }, metodo: { type: "string" }, cobradoEn: { type: ["string", "null"] },
        mpPaymentId: { type: ["string", "null"] }, usuarioId: { type: ["string", "null"] },
        turnoCajaId: { type: ["string", "null"] }, createdAt: { type: "string" },
      },
      required: ["id", "pedidoId", "orgId", "sucursalId", "monto", "metodo", "cobradoEn", "mpPaymentId", "usuarioId", "turnoCajaId", "createdAt"],
    },
    clientRequestId: { type: ["string", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          pedidoId: { type: "string" },
          platoId: { type: "string" },
          nombre: { type: "string" },
          precioUnitario: { type: "number" },
          cantidad: { type: "number" },
        },
      },
    },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
  required: ["id", "orgId", "sucursalId", "tipoServicio", "estado", "version", "cobro", "items"],
} as RxJsonSchema<PedidoOffline>;

const outboxSchema: RxJsonSchema<OutboxEntry> = {
  version: 1,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    orgId: { type: "string" },
    sucursalId: { type: "string" },
    input: { type: "string" },
    optimistic: { type: "string" },
    status: { type: "string", enum: ["pending", "failed"] },
    createdAt: { type: "string" },
    attempts: { type: "number", minimum: 0 },
    retryAt: { type: "number", minimum: 0 },
    errorCode: { type: ["string", "null"] },
    errorMessage: { type: ["string", "null"] },
    legacyRaw: { type: "string" },
  },
  required: ["id", "orgId", "sucursalId", "input", "optimistic", "status", "createdAt", "attempts", "retryAt", "errorCode", "errorMessage", "legacyRaw"],
};

let dbPromise: Promise<RxDatabase> | null = null;
let cachedTenantKey: string | null = null;

// Named per tenant so a shared device cannot mix offline data or queued mutations between
// branches. Switching tenant selects a distinct IndexedDB store and never erases prior data.
export function getDb(orgId: string, sucursalId: string): Promise<RxDatabase> {
  const tenantKey = `${orgId}-${sucursalId}`;
  if (dbPromise && cachedTenantKey !== tenantKey) dbPromise = null;
  cachedTenantKey = tenantKey;

  if (!dbPromise) {
    dbPromise = createRxDatabase({ name: `comanda-operativa-${tenantKey}`, storage: getRxStorageDexie() }).then(async (db) => {
      await db.addCollections({
        // ponytail: campos nuevos son todos opcionales, alcanza con devolver el doc tal cual — sube a v2 con su propia estrategia si algún campo futuro deja de serlo
        mesas: { schema: mesaSchema, migrationStrategies: { 1: (oldDoc: unknown) => oldDoc } },
        platos: { schema: platoSchema },
        // ponytail: plataforma/direccionEnvio son opcionales, alcanza con devolver el doc tal cual — sube a v2 con su propia estrategia si algún campo futuro deja de serlo
        pedidos: { schema: pedidoSchema, migrationStrategies: { 1: (oldDoc: unknown) => ({ ...(oldDoc as Record<string, unknown>), version: 0, cobro: null }) } },
        outbox: { schema: outboxSchema, migrationStrategies: { 1: (oldDoc: unknown) => migrateLegacyOutboxRecord(oldDoc as Record<string, unknown>) } },
      });
      return db;
    });
  }
  return dbPromise;
}
