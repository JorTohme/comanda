import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { TipoMovimientoCaja } from "@prisma/client";
import { TenantContext } from "../auth/jwt.service";
import { PrismaService } from "../prisma/prisma.service";

interface TurnoConDatos {
  montoInicial: number;
  movimientos: { tipo: TipoMovimientoCaja; monto: number }[];
  pedidos: { items: { precioUnitario: number; cantidad: number }[] }[];
}

@Injectable()
export class CajaService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async abrirTurno(dto: { montoInicial: number }, usuarioId: string, tenant: TenantContext) {
    const existente = await this.prisma.turnoCaja.findFirst({ where: { ...tenant, estado: "abierto" } });
    if (existente) throw new ConflictException("Ya existe un turno de caja abierto para esta sucursal");
    return this.prisma.turnoCaja.create({ data: { montoInicial: dto.montoInicial, abiertoPorId: usuarioId, ...tenant } });
  }

  async obtenerActual(tenant: TenantContext) {
    const turno = await this.prisma.turnoCaja.findFirst({
      where: { ...tenant, estado: "abierto" },
      include: { movimientos: true, pedidos: { include: { items: true } } },
    });
    if (!turno) return null;
    return { ...turno, totalCalculado: this.calcularTotal(turno) };
  }

  listar(tenant: TenantContext) {
    return this.prisma.turnoCaja.findMany({ where: tenant, orderBy: { abiertoEn: "desc" } });
  }

  async obtenerUno(id: string, tenant: TenantContext) {
    const turno = await this.prisma.turnoCaja.findFirst({
      where: { id, ...tenant },
      include: { movimientos: true, pedidos: { include: { items: true } } },
    });
    if (!turno) throw new NotFoundException(`TurnoCaja ${id} not found`);
    return { ...turno, totalCalculado: turno.estado === "abierto" ? this.calcularTotal(turno) : turno.totalCalculado };
  }

  async registrarMovimiento(
    turnoId: string,
    dto: { tipo: TipoMovimientoCaja; monto: number; descripcion: string },
    tenant: TenantContext,
  ) {
    await this.assertOwnTurnoAbierto(turnoId, tenant);
    return this.prisma.movimientoCaja.create({ data: { turnoCajaId: turnoId, ...dto } });
  }

  async cerrarTurno(id: string, dto: { montoDeclarado: number }, usuarioId: string, tenant: TenantContext) {
    await this.assertOwnTurnoAbierto(id, tenant);
    const turnoConDatos = await this.prisma.turnoCaja.findFirstOrThrow({
      where: { id },
      include: { movimientos: true, pedidos: { include: { items: true } } },
    });
    const totalCalculado = this.calcularTotal(turnoConDatos);
    const diferencia = dto.montoDeclarado - totalCalculado;
    return this.prisma.turnoCaja.update({
      where: { id },
      data: {
        estado: "cerrado",
        cerradoPorId: usuarioId,
        cerradoEn: new Date(),
        montoDeclarado: dto.montoDeclarado,
        totalCalculado,
        diferencia,
      },
    });
  }

  async assertTurnoAbierto(tenant: TenantContext) {
    const turno = await this.prisma.turnoCaja.findFirst({ where: { ...tenant, estado: "abierto" } });
    if (!turno) throw new BadRequestException("No hay un turno de caja abierto");
    return turno;
  }

  private calcularTotal(turno: TurnoConDatos): number {
    const totalVentas = turno.pedidos.reduce(
      (acc, p) => acc + p.items.reduce((a, i) => a + i.precioUnitario * i.cantidad, 0),
      0,
    );
    const totalMovimientos = turno.movimientos.reduce(
      (acc, m) => acc + (m.tipo === "ingreso" ? m.monto : -m.monto),
      0,
    );
    return turno.montoInicial + totalVentas + totalMovimientos;
  }

  private async assertOwnTurnoAbierto(id: string, tenant: TenantContext) {
    const turno = await this.prisma.turnoCaja.findFirst({ where: { id, ...tenant } });
    if (!turno) throw new NotFoundException(`TurnoCaja ${id} not found`);
    if (turno.estado === "cerrado") throw new ConflictException(`TurnoCaja ${id} is already cerrado`);
    return turno;
  }
}
