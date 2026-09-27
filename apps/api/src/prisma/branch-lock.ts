import { NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { TenantContext } from "../auth/jwt.service";

export async function lockSucursal(tx: Prisma.TransactionClient, tenant: TenantContext): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Sucursal"
    WHERE "id" = ${tenant.sucursalId} AND "organizacionId" = ${tenant.orgId}
    FOR UPDATE
  `;
  if (rows.length === 0) throw new NotFoundException("Sucursal no encontrada");
}
