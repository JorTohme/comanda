import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantContext } from "../auth/jwt.service";
import { PrismaService } from "../prisma/prisma.service";
import { ReportesQueryDto } from "./dto/reportes-query.dto";

const MAX_REPORT_DAYS = 366;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

export interface VentaDiaria { fecha: string; total: number; }
export interface PlatoRanking { platoId: string; nombre: string; cantidad: number; }
export interface HoraPico { hora: number; pedidos: number; }
export interface Reportes {
  ventasPorDia: VentaDiaria[];
  platosMasPedidos: PlatoRanking[];
  horasPico: HoraPico[];
  cobrosSinFecha: number;
  pedidosLegadoSinCobro: number;
  timezone: string;
}
export interface ReportesSucursal extends Reportes { sucursalId: string; sucursalNombre: string; }
export type ReportesConsolidado = ReportesSucursal[];

type NumericValue = number | bigint | string;
interface VentaDiariaRow { sucursalId?: string; fecha: Date | string; total: NumericValue; }
interface PlatoRankingRow { sucursalId?: string; platoId: string; nombre: string; cantidad: NumericValue; }
interface HoraPicoRow { sucursalId?: string; hora: NumericValue; pedidos: NumericValue; }
interface Branch { id: string; nombre: string; timezone: string; }
interface UnresolvedRow { sucursalId?: string; cobrosSinFecha: NumericValue; pedidosLegadoSinCobro: NumericValue; }

export function toSafeInteger(value: NumericValue): number {
  if (typeof value === "bigint") {
    if (value > MAX_SAFE_BIGINT || value < MIN_SAFE_BIGINT) throw new BadRequestException("Total fuera de rango seguro");
    return Number(value);
  }
  if (typeof value === "string" && !/^-?\d+$/.test(value)) throw new BadRequestException("Total fuera de rango seguro");
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new BadRequestException("Total fuera de rango seguro");
  return result;
}

function parseReportRange(query: ReportesQueryDto): { desde: string; hasta: string } {
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!validDate(query.desde) || !validDate(query.hasta) || query.desde > query.hasta) {
    throw new BadRequestException("Dates must be real YYYY-MM-DD values and desde must not be after hasta");
  }
  const start = Date.parse(`${query.desde}T00:00:00.000Z`);
  const end = Date.parse(`${query.hasta}T00:00:00.000Z`);
  const days = (end - start) / 86_400_000 + 1;
  if (days > MAX_REPORT_DAYS) throw new BadRequestException(`Report range cannot exceed ${MAX_REPORT_DAYS} days`);
  return { desde: query.desde, hasta: query.hasta };
}

@Injectable()
export class ReportesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async obtenerReportes(query: ReportesQueryDto, tenant: TenantContext): Promise<Reportes> {
    const range = parseReportRange(query);
    const branch = await this.prisma.sucursal.findFirstOrThrow({
      where: { id: tenant.sucursalId, organizacionId: tenant.orgId },
      select: { timezone: true },
    });
    const [ventasRows, platosRows, horasRows, unresolvedRows] = await Promise.all([
      this.prisma.$queryRaw<VentaDiariaRow[]>(Prisma.sql`
        SELECT to_char((c."cobradoEn" AT TIME ZONE 'UTC') AT TIME ZONE s.timezone,'YYYY-MM-DD') AS fecha,
               SUM(c.monto::bigint) AS total
        FROM "Cobro" c
        JOIN "Sucursal" s ON s.id = c."sucursalId" AND s."organizacionId" = c."orgId"
        WHERE c."orgId" = ${tenant.orgId} AND c."sucursalId" = ${tenant.sucursalId}
          AND c."cobradoEn" >= ((${range.desde}::date)::timestamp AT TIME ZONE s.timezone) AT TIME ZONE 'UTC'
          AND c."cobradoEn" < ((${range.hasta}::date + 1)::timestamp AT TIME ZONE s.timezone) AT TIME ZONE 'UTC'
        GROUP BY 1 ORDER BY 1
      `),
      this.prisma.$queryRaw<PlatoRankingRow[]>(Prisma.sql`
        SELECT i."platoId", i."nombre", SUM(i."cantidad"::bigint) AS cantidad
        FROM "Cobro" c
        JOIN "Pedido" p ON p.id = c."pedidoId" AND p."orgId" = c."orgId" AND p."sucursalId" = c."sucursalId"
        JOIN "ItemPedido" i ON i."pedidoId" = p.id
        JOIN "Sucursal" s ON s.id = c."sucursalId" AND s."organizacionId" = c."orgId"
        WHERE c."orgId" = ${tenant.orgId} AND c."sucursalId" = ${tenant.sucursalId}
          AND c."cobradoEn" >= ((${range.desde}::date)::timestamp AT TIME ZONE s.timezone) AT TIME ZONE 'UTC'
          AND c."cobradoEn" < ((${range.hasta}::date + 1)::timestamp AT TIME ZONE s.timezone) AT TIME ZONE 'UTC'
        GROUP BY i."platoId", i."nombre" ORDER BY cantidad DESC LIMIT 10
      `),
      this.prisma.$queryRaw<HoraPicoRow[]>(Prisma.sql`
        SELECT EXTRACT(HOUR FROM ((p."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE s.timezone))::int AS hora,
               COUNT(*) AS pedidos
        FROM "Pedido" p
        JOIN "Sucursal" s ON s.id = p."sucursalId" AND s."organizacionId" = p."orgId"
        WHERE p."orgId" = ${tenant.orgId} AND p."sucursalId" = ${tenant.sucursalId}
          AND p."createdAt" >= ((${range.desde}::date)::timestamp AT TIME ZONE s.timezone) AT TIME ZONE 'UTC'
          AND p."createdAt" < ((${range.hasta}::date + 1)::timestamp AT TIME ZONE s.timezone) AT TIME ZONE 'UTC'
        GROUP BY 1 ORDER BY 1
      `),
      this.prisma.$queryRaw<UnresolvedRow[]>(Prisma.sql`
        SELECT (SELECT COUNT(*) FROM "Cobro" c WHERE c."orgId" = s."organizacionId"
                  AND c."sucursalId" = s.id AND c."cobradoEn" IS NULL) AS "cobrosSinFecha",
               (SELECT COUNT(*) FROM "Pedido" p WHERE p."orgId" = s."organizacionId" AND p."sucursalId" = s.id
                  AND p."estado" IN ('cobrado','cerrado')
                  AND NOT EXISTS (SELECT 1 FROM "Cobro" c WHERE c."pedidoId" = p.id
                    AND c."orgId" = p."orgId" AND c."sucursalId" = p."sucursalId")) AS "pedidosLegadoSinCobro"
        FROM "Sucursal" s WHERE s.id = ${tenant.sucursalId} AND s."organizacionId" = ${tenant.orgId}
      `),
    ]);
    const unresolved = unresolvedRows[0];
    return {
      ventasPorDia: ventasRows.map((row) => ({ fecha: toIsoDate(row.fecha), total: toSafeInteger(row.total) })),
      platosMasPedidos: platosRows.map((row) => ({ platoId: row.platoId, nombre: row.nombre, cantidad: toSafeInteger(row.cantidad) })),
      horasPico: horasRows.map((row) => ({ hora: toSafeInteger(row.hora), pedidos: toSafeInteger(row.pedidos) })),
      cobrosSinFecha: toSafeInteger(unresolved?.cobrosSinFecha ?? 0),
      pedidosLegadoSinCobro: toSafeInteger(unresolved?.pedidosLegadoSinCobro ?? 0),
      timezone: branch.timezone,
    };
  }

  async obtenerConsolidado(query: ReportesQueryDto, orgId: string): Promise<ReportesConsolidado> {
    const range = parseReportRange(query);
    const branches = await this.prisma.sucursal.findMany({
      where: { organizacionId: orgId },
      select: { id: true, nombre: true, timezone: true },
      orderBy: { id: "asc" },
    }) as Branch[];
    if (branches.length === 0) return [];

    const [ventasRows, platosRows, horasRows, unresolvedRows] = await Promise.all([
      this.prisma.$queryRaw<Array<VentaDiariaRow & { sucursalId: string }>>(Prisma.sql`
        SELECT c."sucursalId", to_char((c."cobradoEn" AT TIME ZONE 'UTC') AT TIME ZONE s.timezone,'YYYY-MM-DD') AS fecha,
               SUM(c.monto::bigint) AS total
        FROM "Cobro" c JOIN "Sucursal" s ON s.id = c."sucursalId" AND s."organizacionId" = c."orgId"
        WHERE c."orgId" = ${orgId}
          AND c."cobradoEn" >= ((${range.desde}::date)::timestamp AT TIME ZONE s.timezone) AT TIME ZONE 'UTC'
          AND c."cobradoEn" < ((${range.hasta}::date + 1)::timestamp AT TIME ZONE s.timezone) AT TIME ZONE 'UTC'
        GROUP BY c."sucursalId", s.timezone, 2 ORDER BY c."sucursalId", 2
      `),
      this.prisma.$queryRaw<Array<PlatoRankingRow & { sucursalId: string }>>(Prisma.sql`
        SELECT c."sucursalId", i."platoId", i."nombre", SUM(i."cantidad"::bigint) AS cantidad
        FROM "Cobro" c JOIN "Pedido" p ON p.id = c."pedidoId" AND p."orgId" = c."orgId" AND p."sucursalId" = c."sucursalId"
        JOIN "ItemPedido" i ON i."pedidoId" = p.id
        JOIN "Sucursal" s ON s.id = c."sucursalId" AND s."organizacionId" = c."orgId"
        WHERE c."orgId" = ${orgId}
          AND c."cobradoEn" >= ((${range.desde}::date)::timestamp AT TIME ZONE s.timezone) AT TIME ZONE 'UTC'
          AND c."cobradoEn" < ((${range.hasta}::date + 1)::timestamp AT TIME ZONE s.timezone) AT TIME ZONE 'UTC'
        GROUP BY c."sucursalId", i."platoId", i."nombre" ORDER BY c."sucursalId", cantidad DESC
      `),
      this.prisma.$queryRaw<Array<HoraPicoRow & { sucursalId: string }>>(Prisma.sql`
        SELECT p."sucursalId", EXTRACT(HOUR FROM ((p."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE s.timezone))::int AS hora,
               COUNT(*) AS pedidos
        FROM "Pedido" p JOIN "Sucursal" s ON s.id = p."sucursalId" AND s."organizacionId" = p."orgId"
        WHERE p."orgId" = ${orgId}
          AND p."createdAt" >= ((${range.desde}::date)::timestamp AT TIME ZONE s.timezone) AT TIME ZONE 'UTC'
          AND p."createdAt" < ((${range.hasta}::date + 1)::timestamp AT TIME ZONE s.timezone) AT TIME ZONE 'UTC'
        GROUP BY p."sucursalId", 2 ORDER BY p."sucursalId", 2
      `),
      this.prisma.$queryRaw<Array<UnresolvedRow & { sucursalId: string }>>(Prisma.sql`
        SELECT s.id AS "sucursalId",
          (SELECT COUNT(*) FROM "Cobro" c WHERE c."orgId" = s."organizacionId"
            AND c."sucursalId" = s.id AND c."cobradoEn" IS NULL) AS "cobrosSinFecha",
          (SELECT COUNT(*) FROM "Pedido" p WHERE p."orgId" = s."organizacionId" AND p."sucursalId" = s.id
            AND p."estado" IN ('cobrado','cerrado')
            AND NOT EXISTS (SELECT 1 FROM "Cobro" c WHERE c."pedidoId" = p.id
              AND c."orgId" = p."orgId" AND c."sucursalId" = p."sucursalId")) AS "pedidosLegadoSinCobro"
        FROM "Sucursal" s WHERE s."organizacionId" = ${orgId}
      `),
    ]);

    const reportByBranch = new Map<string, ReportesSucursal>(branches.map((branch) => [branch.id, {
      sucursalId: branch.id,
      sucursalNombre: branch.nombre,
      timezone: branch.timezone,
      ventasPorDia: [],
      platosMasPedidos: [],
      horasPico: [],
      cobrosSinFecha: 0,
      pedidosLegadoSinCobro: 0,
    }]));
    for (const row of ventasRows) reportByBranch.get(row.sucursalId)?.ventasPorDia.push({ fecha: toIsoDate(row.fecha), total: toSafeInteger(row.total) });
    for (const row of platosRows) reportByBranch.get(row.sucursalId)?.platosMasPedidos.push({ platoId: row.platoId, nombre: row.nombre, cantidad: toSafeInteger(row.cantidad) });
    for (const row of horasRows) reportByBranch.get(row.sucursalId)?.horasPico.push({ hora: toSafeInteger(row.hora), pedidos: toSafeInteger(row.pedidos) });
    for (const row of unresolvedRows) {
      const report = reportByBranch.get(row.sucursalId);
      if (report) {
        report.cobrosSinFecha = toSafeInteger(row.cobrosSinFecha);
        report.pedidosLegadoSinCobro = toSafeInteger(row.pedidosLegadoSinCobro);
      }
    }
    return [...reportByBranch.values()];
  }
}

function toIsoDate(value: Date | string): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}
