import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

const execFileAsync = promisify(execFile);
const DEMO_ORG_ID = "5dbff8f2-89ed-4c65-b39d-f6c029346ee1";
const DATABASE_URL = process.env.DATABASE_URL ?? "";

async function runSeedModule(source: string, env: NodeJS.ProcessEnv = {}) {
  return execFileAsync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "development",
      ALLOW_DEMO_SEED: "true",
      DATABASE_URL,
      ...env,
    },
    timeout: 240_000,
  });
}

describe("identity-safe demo seed with PostgreSQL", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    const database = new URL(DATABASE_URL);
    if (process.env.NODE_ENV !== "test" || database.pathname !== "/comanda_test" ||
      !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "55432") {
      throw new Error("Disposable localhost comanda_test database required");
    }
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  it("rejects unsafe environments before connecting to a database", async () => {
    const source = `
      import { assertSeedEnvironment, DEMO_ORG_ID } from './prisma/seed.mjs';
      if (DEMO_ORG_ID !== '${DEMO_ORG_ID}') throw new Error('wrong demo identity');
      const unsafe = [
        { NODE_ENV:'production', ALLOW_DEMO_SEED:'true', DATABASE_URL:'postgresql://x:x@localhost/x_demo' },
        { NODE_ENV:'development', DATABASE_URL:'postgresql://x:x@localhost/x_demo' },
        { NODE_ENV:'development', ALLOW_DEMO_SEED:'false', DATABASE_URL:'postgresql://x:x@localhost/x_demo' },
        { NODE_ENV:'development', ALLOW_DEMO_SEED:'true', DATABASE_URL:'postgresql://x:x@db/x_demo' },
        { NODE_ENV:'development', ALLOW_DEMO_SEED:'true', DATABASE_URL:'postgresql://x:x@localhost/comanda' },
      ];
      for (const env of unsafe) {
        let rejected = false;
        try { assertSeedEnvironment(env); } catch { rejected = true; }
        if (!rejected) throw new Error('unsafe seed environment accepted');
      }
      console.log('environment guards passed');
    `;
    await expect(runSeedModule(source)).resolves.toMatchObject({ stdout: expect.stringContaining("environment guards passed") });

    const result = await execFileAsync(process.execPath, ["prisma/seed.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "production",
        ALLOW_DEMO_SEED: "true",
        DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:55432/production",
      },
    }).catch((error: { stderr?: string; code?: number }) => error);
    expect(result).toMatchObject({ code: 1 });
    expect(result).toMatchObject({ stderr: expect.stringContaining("Development demo seed explicitly required") });
    expect(result).toMatchObject({ stderr: expect.not.stringContaining("P1001") });
  });

  it("preserves a same-named unrelated organization and creates real paid receipts", async () => {
    const unrelated = await prisma.organizacion.create({ data: { nombre: "Asador Don Mario" } });
    try {
      await runSeedModule(`
        import { PrismaClient } from '@prisma/client';
        import { seedDemo } from './prisma/seed.mjs';
        const prisma = new PrismaClient();
        try { await seedDemo(prisma); } finally { await prisma.$disconnect(); }
      `);

      expect(await prisma.organizacion.findUnique({ where: { id: unrelated.id } })).not.toBeNull();
      const paidOrders = await prisma.pedido.findMany({
        where: { orgId: DEMO_ORG_ID, estado: "cobrado" },
        include: { cobro: true },
      });
      expect(paidOrders.length).toBeGreaterThan(0);
      expect(paidOrders.every((pedido) => Boolean(pedido.cobro?.monto && pedido.cobro.cobradoEn && pedido.cobro.turnoCajaId))).toBe(true);
      expect(paidOrders.every((pedido) => pedido.cobro?.metodo === "efectivo" || pedido.cobro?.metodo === "mercadopago")).toBe(true);
      expect(paidOrders.filter((pedido) => pedido.cobro?.metodo === "mercadopago").every((pedido) => Boolean(pedido.cobro?.mpPaymentId))).toBe(true);

      const shifts = await prisma.turnoCaja.findMany({
        where: { orgId: DEMO_ORG_ID, estado: "cerrado" },
        include: { cobros: true },
      });
      expect(shifts.length).toBeGreaterThan(0);
      for (const shift of shifts) {
        const cash = shift.cobros.filter((receipt) => receipt.metodo === "efectivo").reduce((sum, receipt) => sum + receipt.monto, 0);
        const digital = shift.cobros.filter((receipt) => receipt.metodo === "mercadopago").reduce((sum, receipt) => sum + receipt.monto, 0);
        expect(shift.totalCalculado).toBe(shift.montoInicial + cash);
        expect(shift.totalDigital).toBe(digital);
        expect(shift.totalVentas).toBe(cash + digital);
      }

      const activeTableOrders = await prisma.pedido.findMany({
        where: { orgId: DEMO_ORG_ID, mesaId: { not: null }, estado: { in: ["abierto", "enviado_a_cocina", "en_preparacion", "listo", "en_camino"] } },
        select: { mesaId: true },
      });
      expect(new Set(activeTableOrders.map((order) => order.mesaId)).size).toBe(activeTableOrders.length);
    } finally {
      await prisma.organizacion.delete({ where: { id: unrelated.id } });
    }
  }, 240_000);

  it("replaces the fixed identity without duplicate shifts and rolls back a failure", async () => {
    const protectedOrders = await prisma.pedido.count({ where: { orgId: DEMO_ORG_ID } });
    const existingBranch = await prisma.sucursal.findFirstOrThrow({ where: { organizacionId: DEMO_ORG_ID } });
    const unexpectedUser = await prisma.usuario.create({
      data: {
        nombre: "Unexpected identity",
        email: `unexpected-${randomUUID()}@example.test`,
        passwordHash: "test-only",
        rol: "admin",
        organizacionId: DEMO_ORG_ID,
        sucursalId: existingBranch.id,
      },
    });
    const unsafeReplacement = await runSeedModule(`
      import { PrismaClient } from '@prisma/client';
      import { seedDemo } from './prisma/seed.mjs';
      const prisma = new PrismaClient();
      try { await seedDemo(prisma); } finally { await prisma.$disconnect(); }
    `).catch((error: { stderr?: string; code?: number }) => error);
    expect(unsafeReplacement).toMatchObject({ code: 1 });
    expect(unsafeReplacement).toMatchObject({ stderr: expect.stringContaining("Refusing to replace unexpected organization identity") });
    expect(await prisma.usuario.findUnique({ where: { id: unexpectedUser.id } })).not.toBeNull();
    expect(await prisma.pedido.count({ where: { orgId: DEMO_ORG_ID } })).toBe(protectedOrders);
    await prisma.usuario.delete({ where: { id: unexpectedUser.id } });

    const shiftsBefore = await prisma.turnoCaja.count({ where: { orgId: DEMO_ORG_ID, estado: "abierto" } });
    await runSeedModule(`
      import { PrismaClient } from '@prisma/client';
      import { seedDemo } from './prisma/seed.mjs';
      const prisma = new PrismaClient();
      try { await seedDemo(prisma); } finally { await prisma.$disconnect(); }
    `);
    expect(await prisma.organizacion.count({ where: { id: DEMO_ORG_ID } })).toBe(1);
    expect(await prisma.turnoCaja.count({ where: { orgId: DEMO_ORG_ID, estado: "abierto" } })).toBe(shiftsBefore);

    const baseline = await prisma.pedido.count({ where: { orgId: DEMO_ORG_ID } });
    const failedRun = await runSeedModule(`
      import { PrismaClient } from '@prisma/client';
      import { seedDemo } from './prisma/seed.mjs';
      const prisma = new PrismaClient();
      try { await seedDemo(prisma, async () => { throw new Error('forced rollback'); }); }
      finally { await prisma.$disconnect(); }
    `).catch((error: { stderr?: string; code?: number }) => error);
    expect(failedRun).toMatchObject({ code: 1 });
    expect(failedRun).toMatchObject({ stderr: expect.stringContaining("forced rollback") });
    expect(await prisma.pedido.count({ where: { orgId: DEMO_ORG_ID } })).toBe(baseline);
    expect(baseline).toBeGreaterThan(0);
  }, 240_000);
});
