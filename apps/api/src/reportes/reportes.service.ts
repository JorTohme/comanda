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
}
