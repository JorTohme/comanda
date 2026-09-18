import { addRxPlugin, createRxDatabase, type RxDatabase, type RxJsonSchema } from "rxdb";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import type { Mesa, Plato, Pedido } from "@comanda/shared";

addRxPlugin(RxDBMigrationSchemaPlugin);
if (import.meta.env.DEV) addRxPlugin(RxDBDevModePlugin);

export interface OutboxEntry {
  id: string; // = clientRequestId
  input: string; // JSON.stringify(CreatePedidoInput)
  createdAt: string;
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

const pedidoSchema: RxJsonSchema<Pedido> = {
  version: 1,
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
  required: ["id", "orgId", "sucursalId", "tipoServicio", "estado", "items"],
} as RxJsonSchema<Pedido>;

const outboxSchema: RxJsonSchema<OutboxEntry> = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    input: { type: "string" },
    createdAt: { type: "string" },
  },
  required: ["id", "input", "createdAt"],
};

let dbPromise: Promise<RxDatabase> | null = null;
let cachedOrgId: string | null = null;

// Named per organizacion so a device that ever logs into more than one org (shared/test
// browser, or a same-tab account switch with no reload) never mixes their offline data —
// each org gets its own IndexedDB store instead of silently reusing whichever one was
// cached first. Never deletes anything: switching org just starts a fresh, separate store.
export function getDb(orgId: string): Promise<RxDatabase> {
  if (dbPromise && cachedOrgId !== orgId) dbPromise = null;
  cachedOrgId = orgId;

  if (!dbPromise) {
    dbPromise = createRxDatabase({ name: `comanda-operativa-${orgId}`, storage: getRxStorageDexie() }).then(async (db) => {
      await db.addCollections({
        // ponytail: campos nuevos son todos opcionales, alcanza con devolver el doc tal cual — sube a v2 con su propia estrategia si algún campo futuro deja de serlo
        mesas: { schema: mesaSchema, migrationStrategies: { 1: (oldDoc: unknown) => oldDoc } },
        platos: { schema: platoSchema },
        // ponytail: plataforma/direccionEnvio son opcionales, alcanza con devolver el doc tal cual — sube a v2 con su propia estrategia si algún campo futuro deja de serlo
        pedidos: { schema: pedidoSchema, migrationStrategies: { 1: (oldDoc: unknown) => oldDoc } },
        outbox: { schema: outboxSchema },
      });
      return db;
    });
  }
  return dbPromise;
}
