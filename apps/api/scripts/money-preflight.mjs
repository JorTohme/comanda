import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

export async function runPreflight(prisma) {
  const [duplicates, openLegacy, unknownPaid] = await Promise.all([
    prisma.$queryRaw`
      SELECT "orgId", "sucursalId", count(*)::int AS count
      FROM "TurnoCaja" WHERE "estado" = 'abierto'
      GROUP BY "orgId", "sucursalId" HAVING count(*) > 1
    `,
    prisma.$queryRaw`
      SELECT "id", "orgId", "sucursalId" FROM "TurnoCaja"
      WHERE "estado" = 'abierto' AND "semantica" = 'legacy_mixta'
      ORDER BY "orgId", "sucursalId", "id"
    `,
    prisma.$queryRaw`
      SELECT p."orgId", p."sucursalId", count(*)::int AS count
      FROM "Pedido" p
      WHERE p."estado" IN ('cobrado', 'cerrado')
        AND NOT EXISTS (SELECT 1 FROM "Cobro" c WHERE c."pedidoId" = p."id")
      GROUP BY p."orgId", p."sucursalId"
      ORDER BY p."orgId", p."sucursalId"
    `,
  ]);
  const report = { duplicateOpenShifts: duplicates, openLegacyMixedShifts: openLegacy, paidOrdersWithoutReceipt: unknownPaid };
  console.log(JSON.stringify(report, null, 2));
  return { report, safeToEnable: duplicates.length === 0 && openLegacy.length === 0 };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const { safeToEnable } = await runPreflight(prisma);
    if (!safeToEnable) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
