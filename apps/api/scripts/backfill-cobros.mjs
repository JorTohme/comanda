import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

function validateEvidence(evidence) {
  if (!Array.isArray(evidence)) throw new TypeError("Evidence must be an array");
  return evidence.map((row) => {
    if (!row || typeof row.pedidoId !== "string" || !row.pedidoId ||
      typeof row.paymentId !== "string" || !row.paymentId ||
      !Number.isSafeInteger(row.monto) || row.monto <= 0 ||
      !(row.cobradoEn === null || (typeof row.cobradoEn === "string" && Number.isFinite(Date.parse(row.cobradoEn))))) {
      throw new TypeError("Each evidence row requires pedidoId, paymentId, positive integer monto, and nullable ISO cobradoEn");
    }
    return { ...row, cobradoEn: row.cobradoEn === null ? null : new Date(row.cobradoEn) };
  });
}

export async function runBackfill(prisma, evidence) {
  const rows = validateEvidence(evidence);
  return prisma.$transaction(async (tx) => {
    const results = [];
    for (const row of rows) {
      const pedido = await tx.pedido.findUnique({
        where: { id: row.pedidoId }, select: { id: true, orgId: true, sucursalId: true, estado: true },
      });
      if (!pedido || !["cobrado", "cerrado"].includes(pedido.estado)) {
        throw new Error(`Verified payment does not match a historical paid order: ${row.pedidoId}`);
      }
      const existing = await tx.cobro.findUnique({ where: { pedidoId: row.pedidoId } });
      if (existing) {
        if (existing.metodo === "mercadopago" && existing.mpPaymentId === row.paymentId && existing.monto === row.monto &&
          existing.cobradoEn?.getTime() === row.cobradoEn?.getTime()) {
          results.push({ pedidoId: row.pedidoId, status: "already-applied" });
          continue;
        }
        throw new Error(`A different receipt already exists for order: ${row.pedidoId}`);
      }
      const receipt = await tx.cobro.create({
        data: {
          pedidoId: pedido.id, orgId: pedido.orgId, sucursalId: pedido.sucursalId,
          monto: row.monto, metodo: "mercadopago", cobradoEn: row.cobradoEn,
          mpPaymentId: row.paymentId,
        },
        select: { id: true, pedidoId: true },
      });
      results.push({ pedidoId: receipt.pedidoId, status: "created" });
    }
    return results;
  });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const index = process.argv.indexOf("--evidence");
  const path = index >= 0 ? process.argv[index + 1] : undefined;
  if (index >= 0 && (!path || path.startsWith("--"))) throw new Error("--evidence requires a JSON file path");
  const evidence = path ? JSON.parse(await readFile(path, "utf8")) : [];
  if (!apply) {
    console.log(JSON.stringify({ mode: "dry-run", evidenceRows: validateEvidence(evidence).length }));
    return;
  }
  if (!path) throw new Error("--apply requires a reviewed --evidence file");
  const prisma = new PrismaClient();
  try {
    console.log(JSON.stringify(await runBackfill(prisma, evidence)));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
