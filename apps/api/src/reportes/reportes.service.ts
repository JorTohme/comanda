import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantContext } from "../auth/jwt.service";
import { PrismaService } from "../prisma/prisma.service";
import { ReportesQueryDto } from "./dto/reportes-query.dto";

export interface VentaDiaria {
  fecha: string;
  total: number;
}
export interface PlatoRanking {
  platoId: string;
  nombre: string;
  cantidad: number;
}
export interface HoraPico {
  hora: number;
  pedidos: number;
}
export interface Reportes {
  ventasPorDia: VentaDiaria[];
  platosMasPedidos: PlatoRanking[];
  horasPico: HoraPico[];
}
export interface ReportesSucursal extends Reportes {
  sucursalId: string;
  sucursalNombre: string;
}
export type ReportesConsolidado = ReportesSucursal[];

interface VentaDiariaRow {
  fecha: Date | string;
  total: number | bigint | string;
}
interface PlatoRankingRow {
  platoId: string;
  nombre: string;
  cantidad: number | bigint | string;
}
interface HoraPicoRow {
  hora: number | bigint | string;
  pedidos: number | bigint | string;
}
interface SucursalTag {
  sucursalId: string;
  sucursalNombre: string;
}
type VentaDiariaSucursalRow = VentaDiariaRow & SucursalTag;
type PlatoRankingSucursalRow = PlatoRankingRow & SucursalTag;
type HoraPicoSucursalRow = HoraPicoRow & SucursalTag;

function toIsoDate(value: Date | string): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

@Injectable()
export class ReportesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async obtenerReportes(query: ReportesQueryDto, tenant: TenantContext): Promise<Reportes> {
    const desde = new Date(query.desde);
    const hasta = new Date(query.hasta);
    if (desde > hasta) throw new BadRequestException("desde must not be after hasta");
    const hastaExclusiva = new Date(hasta);
    hastaExclusiva.setDate(hastaExclusiva.getDate() + 1);

    const [ventasRows, platosRows, horasRows] = await Promise.all([
      this.prisma.$queryRaw<VentaDiariaRow[]>(Prisma.sql`
        SELECT date_trunc('day', p."createdAt")::date AS fecha,
               SUM(i."precioUnitario" * i."cantidad")::int AS total
        FROM "Pedido" p
        JOIN "ItemPedido" i ON i."pedidoId" = p.id
        WHERE p."orgId" = ${tenant.orgId} AND p."sucursalId" = ${tenant.sucursalId}
          AND p."estado" IN ('cobrado','cerrado')
          AND p."createdAt" >= ${desde} AND p."createdAt" < ${hastaExclusiva}
        GROUP BY 1
        ORDER BY 1
      `),
      this.prisma.$queryRaw<PlatoRankingRow[]>(Prisma.sql`
        SELECT i."platoId", i."nombre", SUM(i."cantidad")::int AS cantidad
        FROM "Pedido" p
        JOIN "ItemPedido" i ON i."pedidoId" = p.id
        WHERE p."orgId" = ${tenant.orgId} AND p."sucursalId" = ${tenant.sucursalId}
          AND p."estado" IN ('cobrado','cerrado')
          AND p."createdAt" >= ${desde} AND p."createdAt" < ${hastaExclusiva}
        GROUP BY i."platoId", i."nombre"
        ORDER BY cantidad DESC
        LIMIT 10
      `),
      this.prisma.$queryRaw<HoraPicoRow[]>(Prisma.sql`
        SELECT EXTRACT(HOUR FROM p."createdAt")::int AS hora, COUNT(DISTINCT p.id)::int AS pedidos
        FROM "Pedido" p
        WHERE p."orgId" = ${tenant.orgId} AND p."sucursalId" = ${tenant.sucursalId}
          AND p."estado" IN ('cobrado','cerrado')
          AND p."createdAt" >= ${desde} AND p."createdAt" < ${hastaExclusiva}
        GROUP BY 1
        ORDER BY 1
      `),
    ]);

    return {
      ventasPorDia: ventasRows.map((row) => ({ fecha: toIsoDate(row.fecha), total: Number(row.total) })),
      platosMasPedidos: platosRows.map((row) => ({
        platoId: row.platoId,
        nombre: row.nombre,
        cantidad: Number(row.cantidad),
      })),
      horasPico: horasRows.map((row) => ({ hora: Number(row.hora), pedidos: Number(row.pedidos) })),
    };
  }

  // Admin-only, org-wide breakdown: same three metrics as obtenerReportes but without the
  // sucursalId filter, grouped per branch so an admin comparing branches sees them side by
  // side instead of one mixed total.
  async obtenerConsolidado(query: ReportesQueryDto, orgId: string): Promise<ReportesConsolidado> {
    const desde = new Date(query.desde);
    const hasta = new Date(query.hasta);
    if (desde > hasta) throw new BadRequestException("desde must not be after hasta");
    const hastaExclusiva = new Date(hasta);
    hastaExclusiva.setDate(hastaExclusiva.getDate() + 1);

    const [ventasRows, platosRows, horasRows] = await Promise.all([
      this.prisma.$queryRaw<VentaDiariaSucursalRow[]>(Prisma.sql`
        SELECT p."sucursalId", s."nombre" AS "sucursalNombre",
               date_trunc('day', p."createdAt")::date AS fecha,
               SUM(i."precioUnitario" * i."cantidad")::int AS total
        FROM "Pedido" p
        JOIN "ItemPedido" i ON i."pedidoId" = p.id
        JOIN "Sucursal" s ON s.id = p."sucursalId"
        WHERE p."orgId" = ${orgId}
          AND p."estado" IN ('cobrado','cerrado')
          AND p."createdAt" >= ${desde} AND p."createdAt" < ${hastaExclusiva}
        GROUP BY p."sucursalId", s."nombre", 3
        ORDER BY p."sucursalId", 3
      `),
      // ponytail: no per-branch top-N cap (obtenerReportes' LIMIT 10 isn't meaningful once
      // grouped per sucursal). Add ROW_NUMBER() OVER (PARTITION BY sucursalId) if the
      // consolidated payload size becomes a problem.
      this.prisma.$queryRaw<PlatoRankingSucursalRow[]>(Prisma.sql`
        SELECT p."sucursalId", s."nombre" AS "sucursalNombre", i."platoId", i."nombre", SUM(i."cantidad")::int AS cantidad
        FROM "Pedido" p
        JOIN "ItemPedido" i ON i."pedidoId" = p.id
        JOIN "Sucursal" s ON s.id = p."sucursalId"
        WHERE p."orgId" = ${orgId}
          AND p."estado" IN ('cobrado','cerrado')
          AND p."createdAt" >= ${desde} AND p."createdAt" < ${hastaExclusiva}
        GROUP BY p."sucursalId", s."nombre", i."platoId", i."nombre"
        ORDER BY p."sucursalId", cantidad DESC
      `),
      this.prisma.$queryRaw<HoraPicoSucursalRow[]>(Prisma.sql`
        SELECT p."sucursalId", s."nombre" AS "sucursalNombre", EXTRACT(HOUR FROM p."createdAt")::int AS hora,
               COUNT(DISTINCT p.id)::int AS pedidos
        FROM "Pedido" p
        JOIN "Sucursal" s ON s.id = p."sucursalId"
        WHERE p."orgId" = ${orgId}
          AND p."estado" IN ('cobrado','cerrado')
          AND p."createdAt" >= ${desde} AND p."createdAt" < ${hastaExclusiva}
        GROUP BY p."sucursalId", s."nombre", 3
        ORDER BY p."sucursalId", 3
      `),
    ]);

    const porSucursal = new Map<string, ReportesSucursal>();
    const branch = (sucursalId: string, sucursalNombre: string): ReportesSucursal => {
      let entry = porSucursal.get(sucursalId);
      if (!entry) {
        entry = { sucursalId, sucursalNombre, ventasPorDia: [], platosMasPedidos: [], horasPico: [] };
        porSucursal.set(sucursalId, entry);
      }
      return entry;
    };

    for (const row of ventasRows) {
      branch(row.sucursalId, row.sucursalNombre).ventasPorDia.push({
        fecha: toIsoDate(row.fecha),
        total: Number(row.total),
      });
    }
    for (const row of platosRows) {
      branch(row.sucursalId, row.sucursalNombre).platosMasPedidos.push({
        platoId: row.platoId,
        nombre: row.nombre,
        cantidad: Number(row.cantidad),
      });
    }
    for (const row of horasRows) {
      branch(row.sucursalId, row.sucursalNombre).horasPico.push({
        hora: Number(row.hora),
        pedidos: Number(row.pedidos),
      });
    }

    return [...porSucursal.values()];
  }
}
