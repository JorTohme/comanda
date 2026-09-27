import { randomUUID } from "node:crypto";
import { PrismaService } from "../src/prisma/prisma.service";
import type { JwtClaims, TenantContext } from "../src/auth/jwt.service";

export async function moneyFixture(): Promise<{
  prisma: PrismaService;
  tenant: TenantContext;
  actor: JwtClaims;
  platoId: string;
  dispose(): Promise<void>;
}> {
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.NODE_ENV !== "test" || database.pathname !== "/comanda_test" ||
    !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "55432") {
    throw new Error("Disposable localhost comanda_test database required");
  }

  const prisma = new PrismaService();
  await prisma.$connect();
  const id = randomUUID();
  const org = await prisma.organizacion.create({ data: { id, nombre: `money-${id}` } });
  const branch = await prisma.sucursal.create({
    data: { id: randomUUID(), nombre: "Test", organizacionId: org.id },
  });
  const user = await prisma.usuario.create({
    data: {
      id: randomUUID(), nombre: "Money test", email: `money-${id}@example.test`,
      passwordHash: "test-only", rol: "admin", organizacionId: org.id, sucursalId: branch.id,
    },
  });
  const category = await prisma.categoria.create({
    data: { id: randomUUID(), nombre: "Test", orgId: org.id, sucursalId: branch.id },
  });
  const dish = await prisma.plato.create({
    data: {
      id: randomUUID(), nombre: "Test dish", precio: 1000, categoriaId: category.id,
      orgId: org.id, sucursalId: branch.id,
    },
  });

  return {
    prisma,
    tenant: { orgId: org.id, sucursalId: branch.id },
    actor: { sub: user.id, orgId: org.id, sucursalId: branch.id, rol: user.rol, iat: 0, exp: 0 },
    platoId: dish.id,
    dispose: async () => {
      try {
        await prisma.$transaction(async (tx) => {
          const [receiptTable] = await tx.$queryRaw<Array<{ exists: boolean }>>`
            SELECT to_regclass('public."Cobro"') IS NOT NULL AS exists
          `;
          if (receiptTable.exists) {
            await tx.$executeRaw`DELETE FROM "Cobro" WHERE "orgId" = ${org.id} AND "sucursalId" = ${branch.id}`;
          }
          await tx.pago.deleteMany({ where: { orgId: org.id, sucursalId: branch.id } });
          await tx.movimientoCaja.deleteMany({ where: { turnoCaja: { orgId: org.id, sucursalId: branch.id } } });
          await tx.pedido.deleteMany({ where: { orgId: org.id, sucursalId: branch.id } });
          await tx.turnoCaja.deleteMany({ where: { orgId: org.id, sucursalId: branch.id } });
          await tx.invitation.deleteMany({ where: { organizacionId: org.id, sucursalId: branch.id } });
          await tx.plato.deleteMany({ where: { orgId: org.id, sucursalId: branch.id } });
          await tx.categoria.deleteMany({ where: { orgId: org.id, sucursalId: branch.id } });
          await tx.mesa.deleteMany({ where: { orgId: org.id, sucursalId: branch.id } });
          await tx.refreshToken.deleteMany({ where: { sucursalId: branch.id } });
          await tx.usuario.deleteMany({ where: { organizacionId: org.id, sucursalId: branch.id } });
          await tx.sucursal.deleteMany({ where: { organizacionId: org.id } });
          await tx.organizacion.delete({ where: { id: org.id } });
        });
      } finally {
        await prisma.$disconnect();
      }
    },
  };
}
