import { cpSync, copyFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { lockSucursal } from "../src/prisma/branch-lock";
import { moneyFixture } from "./money-fixture";

function runScript(script: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [resolve(__dirname, "../scripts", script), ...args], {
    cwd: resolve(__dirname, ".."), env: process.env, encoding: "utf8",
  });
}

describe("money schema migration", () => {
  it("refuses upgrade when a branch has duplicate open shifts, then applies after reconciliation", async () => {
    const baseUrl = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV !== "test" || baseUrl.pathname !== "/comanda_test" ||
      !["localhost", "127.0.0.1"].includes(baseUrl.hostname) || baseUrl.port !== "55432") {
      throw new Error("Disposable localhost comanda_test database required");
    }
    const schema = `money_migration_${randomUUID().replaceAll("-", "")}`;
    const scratchUrl = new URL(baseUrl);
    scratchUrl.searchParams.set("schema", schema);
    const admin = new PrismaClient({ datasourceUrl: baseUrl.href });
    const scratch = new PrismaClient({ datasourceUrl: scratchUrl.href });
    const directory = mkdtempSync(join(tmpdir(), "comanda-money-migrations-"));
    const prismaDir = join(directory, "prisma");
    const migrationsDir = join(prismaDir, "migrations");
    const schemaFile = join(prismaDir, "schema.prisma");
    mkdirSync(migrationsDir, { recursive: true });
    writeFileSync(schemaFile, [
      "datasource db {",
      '  provider = "postgresql"',
      '  url = env("DATABASE_URL")',
      "}",
    ].join("\n"));
    copyFileSync(resolve(__dirname, "../prisma/migrations/migration_lock.toml"), join(migrationsDir, "migration_lock.toml"));
    const migrations = resolve(__dirname, "../prisma/migrations");
    for (const name of readdirSync(migrations)) {
      if (name === "migration_lock.toml" || name.startsWith("20260927005900_") || name.startsWith("20260927010000_")) continue;
      cpSync(join(migrations, name), join(migrationsDir, name), { recursive: true });
    }

    const deploy = () => {
      return spawnSync(process.execPath, [require.resolve("prisma"), "migrate", "deploy", "--schema", schemaFile], {
        cwd: resolve(__dirname, ".."), env: { ...process.env, DATABASE_URL: scratchUrl.href }, encoding: "utf8",
      });
    };
    const markRolledBack = () => spawnSync(process.execPath, [
      require.resolve("prisma"), "migrate", "resolve", "--rolled-back", "20260927010000_money", "--schema", schemaFile,
    ], { cwd: resolve(__dirname, ".."), env: { ...process.env, DATABASE_URL: scratchUrl.href }, encoding: "utf8" });
    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      const baseline = deploy();
      if (baseline.status !== 0) throw new Error(`${baseline.stdout}\n${baseline.stderr}`);

      const orgId = randomUUID();
      const branchId = randomUUID();
      const userId = randomUUID();
      await scratch.$executeRaw`INSERT INTO "Organizacion" ("id", "nombre", "updatedAt") VALUES (${orgId}, 'migration fixture', NOW())`;
      await scratch.$executeRaw`INSERT INTO "Sucursal" ("id", "nombre", "organizacionId", "updatedAt") VALUES (${branchId}, 'fixture', ${orgId}, NOW())`;
      await scratch.$executeRaw`INSERT INTO "Usuario" ("id", "nombre", "email", "passwordHash", "rol", "organizacionId", "sucursalId", "updatedAt") VALUES (${userId}, 'fixture', ${`${userId}@example.test`}, 'test-only', 'admin', ${orgId}, ${branchId}, NOW())`;
      const shiftA = randomUUID();
      const shiftB = randomUUID();
      const legacyShift = randomUUID();
      const legacyPedido = randomUUID();
      await scratch.$executeRaw`INSERT INTO "TurnoCaja" ("id", "orgId", "sucursalId", "montoInicial", "abiertoPorId", "updatedAt") VALUES (${shiftA}, ${orgId}, ${branchId}, 5000, ${userId}, NOW())`;
      await scratch.$executeRaw`INSERT INTO "TurnoCaja" ("id", "orgId", "sucursalId", "montoInicial", "abiertoPorId", "updatedAt") VALUES (${shiftB}, ${orgId}, ${branchId}, 5000, ${userId}, NOW())`;
      await scratch.$executeRaw`INSERT INTO "TurnoCaja" ("id", "orgId", "sucursalId", "estado", "montoInicial", "abiertoPorId", "totalCalculado", "updatedAt") VALUES (${legacyShift}, ${orgId}, ${branchId}, 'cerrado', 5000, ${userId}, 6100, NOW())`;
      await scratch.$executeRaw`INSERT INTO "Pedido" ("id", "tipoServicio", "estado", "orgId", "sucursalId", "turnoCajaId", "createdAt", "updatedAt") VALUES (${legacyPedido}, 'barra', 'cobrado', ${orgId}, ${branchId}, ${legacyShift}, NOW(), NOW())`;

      for (const name of ["20260927005900_money_payment_states", "20260927010000_money"]) {
        cpSync(join(migrations, name), join(migrationsDir, name), { recursive: true });
      }
      const blocked = deploy();
      expect(blocked.status).not.toBe(0);
      expect(`${blocked.stdout}\n${blocked.stderr}`).toContain("Duplicate open shifts: reconcile before money migration");

      await scratch.$executeRaw`DELETE FROM "TurnoCaja" WHERE "id" = ${shiftB}`;
      const rollback = markRolledBack();
      if (rollback.status !== 0) throw new Error(`${rollback.stdout}\n${rollback.stderr}`);
      const applied = deploy();
      if (applied.status !== 0) throw new Error(`${applied.stdout}\n${applied.stderr}`);
      const preserved = await scratch.$queryRaw<Array<{ totalCalculado: number; semantica: string }>>`
        SELECT "totalCalculado", "semantica" FROM "TurnoCaja" WHERE "id" = ${legacyShift}
      `;
      expect(preserved).toEqual([{ totalCalculado: 6100, semantica: "legacy_mixta" }]);
      expect(await scratch.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Cobro" WHERE "pedidoId" = ${legacyPedido}
      `).toHaveLength(0);
      await expect(scratch.$executeRaw`
        INSERT INTO "Pedido" ("id", "tipoServicio", "orgId", "sucursalId", "version", "updatedAt")
        VALUES (${randomUUID()}, 'barra', ${orgId}, ${branchId}, -1, NOW())
      `).rejects.toThrow();
    } finally {
      await scratch.$disconnect();
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("blocks rollout for an open legacy-mixed shift and reports paid orders with unknown evidence", async () => {
    const f = await moneyFixture();
    try {
      const shift = await f.prisma.turnoCaja.create({
        data: {
          orgId: f.tenant.orgId, sucursalId: f.tenant.sucursalId, abiertoPorId: f.actor.sub,
          montoInicial: 5000,
        },
      });
      await f.prisma.$executeRaw`UPDATE "TurnoCaja" SET "semantica" = 'legacy_mixta' WHERE "id" = ${shift.id}`;
      await f.prisma.pedido.create({
        data: { orgId: f.tenant.orgId, sucursalId: f.tenant.sucursalId, estado: "cerrado", tipoServicio: "barra" },
      });

      const result = runScript("money-preflight.mjs", []);
      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout) as {
        duplicateOpenShifts: unknown[];
        openLegacyMixedShifts: Array<{ id: string; orgId: string; sucursalId: string }>;
        paidOrdersWithoutReceipt: Array<{ orgId: string; sucursalId: string; count: number }>;
      };
      expect(report.duplicateOpenShifts).toHaveLength(0);
      expect(report.openLegacyMixedShifts).toContainEqual({
        id: shift.id, orgId: f.tenant.orgId, sucursalId: f.tenant.sucursalId,
      });
      expect(report.paidOrdersWithoutReceipt).toContainEqual({
        orgId: f.tenant.orgId, sucursalId: f.tenant.sucursalId, count: 1,
      });
    } finally {
      await f.dispose();
    }
  });

  it("serializes transactions on the verified branch row and rejects a foreign tenant", async () => {
    const f = await moneyFixture();
    let releaseFirst!: () => void;
    let signalLocked!: () => void;
    const released = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    try {
      const first = f.prisma.$transaction(async (tx) => {
        await lockSucursal(tx, f.tenant);
        signalLocked();
        await released;
      });
      await locked;
      let secondAcquired = false;
      const second = f.prisma.$transaction(async (tx) => {
        await lockSucursal(tx, f.tenant);
        secondAcquired = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(secondAcquired).toBe(false);
      releaseFirst();
      await Promise.all([first, second]);
      expect(secondAcquired).toBe(true);
      await expect(f.prisma.$transaction((tx) => lockSucursal(tx, {
        orgId: "00000000-0000-0000-0000-000000000001", sucursalId: f.tenant.sucursalId,
      }))).rejects.toThrow("Sucursal no encontrada");
    } finally {
      releaseFirst();
      await f.dispose();
    }
  });

  it("preserves proven digital tender without inventing collection date or changing a legacy close", async () => {
    const f = await moneyFixture();
    try {
      const legacyShift = await f.prisma.turnoCaja.create({
        data: {
          orgId: f.tenant.orgId, sucursalId: f.tenant.sucursalId, abiertoPorId: f.actor.sub,
          estado: "cerrado", montoInicial: 5000, montoDeclarado: 6000, totalCalculado: 6100, diferencia: -100,
          cerradoPorId: f.actor.sub,
        },
      });
      const legacyPedido = await f.prisma.pedido.create({
        data: {
          orgId: f.tenant.orgId, sucursalId: f.tenant.sucursalId, estado: "cobrado",
          tipoServicio: "barra", turnoCajaId: legacyShift.id,
          items: { create: { platoId: f.platoId, nombre: "Test dish", precioUnitario: 1000, cantidad: 1 } },
        },
      });
      const unknownPedido = await f.prisma.pedido.create({
        data: {
          orgId: f.tenant.orgId, sucursalId: f.tenant.sucursalId, estado: "cobrado", tipoServicio: "barra",
        },
      });

      const directory = mkdtempSync(join(tmpdir(), "comanda-money-evidence-"));
      const evidence = join(directory, "evidence.json");
      writeFileSync(evidence, JSON.stringify([{
        pedidoId: legacyPedido.id, paymentId: "verified-legacy-123", monto: 1000, cobradoEn: null,
      }]));
      const dryRun = runScript("backfill-cobros.mjs", ["--evidence", evidence]);
      expect(dryRun.status).toBe(0);
      expect(JSON.parse(dryRun.stdout)).toEqual({ mode: "dry-run", evidenceRows: 1 });
      expect(await f.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Cobro" WHERE "pedidoId" = ${legacyPedido.id}
      `).toHaveLength(0);
      const result = runScript("backfill-cobros.mjs", ["--apply", "--evidence", evidence]);
      rmSync(directory, { recursive: true, force: true });
      expect(result.status).toBe(0);

      const receipts = await f.prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT "metodo", "monto", "cobradoEn", "turnoCajaId" FROM "Cobro" WHERE "pedidoId" = ${legacyPedido.id}
      `;
      const receipt = receipts[0];
      expect(receipt).toMatchObject({
        metodo: "mercadopago", monto: 1000, cobradoEn: null, turnoCajaId: null,
      });
      expect(await f.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Cobro" WHERE "pedidoId" = ${unknownPedido.id}
      `).toHaveLength(0);
      expect((await f.prisma.turnoCaja.findUniqueOrThrow({ where: { id: legacyShift.id } })).totalCalculado)
        .toBe(6100);
    } finally {
      await f.dispose();
    }
  });
});
