import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { MetodoCobro, Prisma, TipoMovimientoCaja } from "@prisma/client";
import type { JwtClaims, TenantContext } from "../auth/jwt.service";
import { lockSucursal } from "../prisma/branch-lock";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

const MAX_INT = 2_147_483_647n;
const MIN_INT = -2_147_483_648n;
const LEGACY = "legacy_mixta";
const EFFECTIVE = "efectivo";

interface TotalsInput {
  montoInicial: number;
  movimientos: { tipo: TipoMovimientoCaja; monto: number }[];
  cobros: { metodo: MetodoCobro; monto: number }[];
}

function safeInt(value: bigint, label: string, min = MIN_INT, max = MAX_INT): number {
  if (value < min || value > max) throw new BadRequestException(`${label} is outside the supported integer range`);
  return Number(value);
}

function validateMoney(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new BadRequestException(`${label} must be a safe integer`);
  return safeInt(BigInt(value), label, 0n);
}

function assertActor(actor: JwtClaims, tenant: TenantContext): void {
  if (actor.orgId !== tenant.orgId || actor.sucursalId !== tenant.sucursalId) throw new ForbiddenException("Actor does not belong to this tenant");
  if (actor.rol !== "admin" && actor.rol !== "caja") throw new ForbiddenException("Caja role required");
}

@Injectable()
export class CajaService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
  ) {}

  calcularTotales(turno: TotalsInput) {
    const valid = (n: number) => Number.isSafeInteger(n);
    validateMoney(turno.montoInicial, "Opening cash");
    let cash = 0n;
    let digital = 0n;
    for (const cobro of turno.cobros) {
      if (!valid(cobro.monto) || cobro.monto <= 0) throw new BadRequestException("Invalid receipt amount");
      validateMoney(cobro.monto, "Receipt amount");
      if (cobro.metodo === "efectivo") cash += BigInt(cobro.monto);
      else digital += BigInt(cobro.monto);
    }
    let movement = 0n;
    for (const item of turno.movimientos) {
      if (!valid(item.monto) || item.monto <= 0) throw new BadRequestException("Invalid movement amount");
      validateMoney(item.monto, "Movement amount");
      movement += item.tipo === "ingreso" ? BigInt(item.monto) : -BigInt(item.monto);
    }
    const sales = cash + digital;
    return {
      totalCalculado: safeInt(BigInt(turno.montoInicial) + cash + movement, "Expected physical cash"),
      totalDigital: safeInt(digital, "Digital receipts", 0n),
      totalVentas: safeInt(sales, "Sales total", 0n),
    };
  }

  async abrirTurno(dto: { montoInicial: number }, tenant: TenantContext, actor: JwtClaims) {
    assertActor(actor, tenant);
    validateMoney(dto.montoInicial, "Opening cash");
    const turno = await this.prisma.$transaction(async (tx) => {
      await lockSucursal(tx, tenant);
      const existing = await tx.turnoCaja.findFirst({ where: { ...tenant, estado: "abierto" } });
      if (existing) throw new ConflictException("Ya existe un turno de caja abierto para esta sucursal");
      return tx.turnoCaja.create({ data: { montoInicial: dto.montoInicial, abiertoPorId: actor.sub, ...tenant, semantica: EFFECTIVE } });
    });
    this.publishInvalidation(tenant, turno.id);
    return turno;
  }

  async obtenerActual(tenant: TenantContext) {
    const turno = await this.prisma.turnoCaja.findFirst({
      where: { ...tenant, estado: "abierto" }, include: { movimientos: true, cobros: true, pedidos: { include: { items: true } } },
    });
    if (!turno) return null;
    return this.enriquecer(turno, tenant);
  }

  listar(tenant: TenantContext) {
    return this.prisma.turnoCaja.findMany({ where: tenant, orderBy: { abiertoEn: "desc" } });
  }

  async obtenerUno(id: string, tenant: TenantContext) {
    const turno = await this.prisma.turnoCaja.findFirst({
      where: { id, ...tenant }, include: { movimientos: true, cobros: true, pedidos: { include: { items: true } } },
    });
    if (!turno) throw new NotFoundException(`TurnoCaja ${id} not found`);
    return this.enriquecer(turno, tenant);
  }

  async registrarMovimiento(
    turnoId: string,
    dto: { tipo: TipoMovimientoCaja; monto: number; descripcion: string },
    tenant: TenantContext,
    actor: JwtClaims,
  ) {
    assertActor(actor, tenant);
    validateMoney(dto.monto, "Movement amount");
    const movimiento = await this.prisma.$transaction(async (tx) => {
      await lockSucursal(tx, tenant);
      const turno = await this.assertOwnTurnoAbierto(tx, turnoId, tenant);
      return tx.movimientoCaja.create({ data: { turnoCajaId: turno.id, ...dto } });
    });
    this.publishInvalidation(tenant, turnoId);
    return movimiento;
  }

  async cerrarTurno(id: string, dto: { montoDeclarado: number }, tenant: TenantContext, actor: JwtClaims) {
    assertActor(actor, tenant);
    validateMoney(dto.montoDeclarado, "Declared cash");
    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockSucursal(tx, tenant);
      const turno = await tx.turnoCaja.findFirst({
        where: { id, ...tenant }, include: { movimientos: true, cobros: true },
      });
      if (!turno) throw new NotFoundException(`TurnoCaja ${id} not found`);
      if (turno.estado === "cerrado") {
        if (turno.montoDeclarado === dto.montoDeclarado) return { turno, changed: false };
        throw new ConflictException(`TurnoCaja ${id} is already closed with another declared amount`);
      }
      if (turno.semantica === LEGACY) throw new ConflictException("Legacy mixed shifts cannot be closed by the current cash workflow");
      const totals = this.calcularTotales(turno);
      const diferencia = safeInt(BigInt(dto.montoDeclarado) - BigInt(totals.totalCalculado), "Cash difference");
      const closed = await tx.turnoCaja.update({
        where: { id, orgId: tenant.orgId, sucursalId: tenant.sucursalId },
        data: { estado: "cerrado", cerradoPorId: actor.sub, cerradoEn: new Date(), montoDeclarado: dto.montoDeclarado, ...totals, diferencia },
      });
      return { turno: closed, changed: true };
    });
    if (outcome.changed) this.publishInvalidation(tenant, id);
    return outcome.turno;
  }

  /** Read-only lookup for a caller that already holds the Sucursal lock. */
  async findOpenEffectiveShift(tx: Prisma.TransactionClient, tenant: TenantContext) {
    const turno = await tx.turnoCaja.findFirst({ where: { ...tenant, estado: "abierto" } });
    if (turno?.semantica === LEGACY) throw new ConflictException("An unreconciled legacy shift blocks new money mutations");
    return turno;
  }

  /** Compatibility bridge retained for the provider slice; it intentionally does not start a nested transaction. */
  async assertTurnoAbierto(tenant: TenantContext) {
    const turno = await this.prisma.turnoCaja.findFirst({ where: { ...tenant, estado: "abierto" } });
    if (!turno) throw new BadRequestException("No hay un turno de caja abierto");
    return turno;
  }

  private async enriquecer(turno: Prisma.TurnoCajaGetPayload<{ include: { movimientos: true; cobros: true; pedidos: { include: { items: true } } } }>, tenant: TenantContext) {
    const [cobrosDigitalesSinTurno, pedidosLegacySinCobro] = await Promise.all([
      this.prisma.cobro.count({ where: { ...tenant, metodo: "mercadopago", turnoCajaId: null } }),
      this.prisma.pedido.count({ where: { ...tenant, turnoCajaId: turno.id, cobro: null } }),
    ]);
    const totals = turno.estado === "abierto" && turno.semantica !== LEGACY
      ? this.calcularTotales(turno)
      : { totalCalculado: turno.totalCalculado, totalDigital: turno.totalDigital, totalVentas: turno.totalVentas };
    return { ...turno, ...totals, cobrosDigitalesSinTurno, pedidosLegacySinCobro };
  }

  private async assertOwnTurnoAbierto(tx: Prisma.TransactionClient, id: string, tenant: TenantContext) {
    const turno = await tx.turnoCaja.findFirst({ where: { id, ...tenant } });
    if (!turno) throw new NotFoundException(`TurnoCaja ${id} not found`);
    if (turno.estado === "cerrado" || turno.semantica === LEGACY) throw new ConflictException(`TurnoCaja ${id} does not accept cash movements`);
    return turno;
  }

  private publishInvalidation(tenant: TenantContext, turnoId: string | null): void {
    this.realtime.emitToSucursal(tenant.sucursalId, "caja.actualizada", { ...tenant, turnoId });
  }
}
