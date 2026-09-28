import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Cobro, Pago, Prisma } from "@prisma/client";
import type { JwtClaims, TenantContext } from "../auth/jwt.service";
import { CajaService } from "../caja/caja.service";
import { lockSucursal } from "../prisma/branch-lock";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

const MAX_INT = 2_147_483_647n;

function assertActor(actor: JwtClaims, tenant: TenantContext): void {
  if (actor.orgId !== tenant.orgId || actor.sucursalId !== tenant.sucursalId) throw new ForbiddenException("Actor does not belong to this tenant");
  if (actor.rol !== "admin" && actor.rol !== "caja") throw new ForbiddenException("Caja role required");
}

@Injectable()
export class CobrosService {
  private readonly logger = new Logger(CobrosService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CajaService) private readonly caja: CajaService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
  ) {}

  async cobrarEfectivo(id: string, tenant: TenantContext, actor: JwtClaims) {
    assertActor(actor, tenant);
    const pedido = await this.prisma.$transaction(async (tx) => {
      await lockSucursal(tx, tenant);
      const current = await tx.pedido.findFirst({ where: { id, ...tenant }, include: { items: true, cobro: true } });
      if (!current) throw new NotFoundException(`Pedido ${id} not found`);
      if (current.cobro) {
        if (current.cobro.metodo === "efectivo") return current;
        throw new ConflictException("Pedido already has a digital receipt");
      }
      if (current.estado !== "entregado") throw new BadRequestException("Only delivered orders can be collected in cash");
      let amount = 0n;
      for (const item of current.items) {
        if (!Number.isSafeInteger(item.precioUnitario) || item.precioUnitario < 0 || !Number.isSafeInteger(item.cantidad) || item.cantidad <= 0) {
          throw new BadRequestException("Order contains an invalid item amount");
        }
        amount += BigInt(item.precioUnitario) * BigInt(item.cantidad);
        if (amount > MAX_INT) throw new BadRequestException("Order total is outside the supported integer range");
      }
      if (amount <= 0n) throw new BadRequestException("Order total must be positive");
      const shift = await this.caja.findOpenEffectiveShift(tx, tenant);
      if (!shift) throw new ConflictException("An open cash shift is required to collect cash");
      await tx.cobro.create({
        data: { pedidoId: id, monto: Number(amount), metodo: "efectivo", cobradoEn: new Date(), usuarioId: actor.sub, turnoCajaId: shift.id, ...tenant },
      });
      return tx.pedido.update({
        where: { id, orgId: tenant.orgId, sucursalId: tenant.sucursalId, version: current.version },
        data: { estado: "cobrado", version: { increment: 1 }, turnoCajaId: shift.id },
        include: { items: true, cobro: true },
      });
    });
    try { this.realtime.emitToSucursal(tenant.sucursalId, "pedido.actualizado", pedido); }
    catch (error) { this.logger.error("Failed to publish pedido.actualizado after cash collection", error instanceof Error ? error.stack : undefined); }
    return pedido;
  }

  /** Called by the payment reconciler inside its already-locked transaction. */
  async postDigital(
    tx: Prisma.TransactionClient,
    pago: Pago,
    paymentId: string,
    cobradoEn: Date,
    tenant: TenantContext,
  ): Promise<Cobro> {
    if (pago.orgId !== tenant.orgId || pago.sucursalId !== tenant.sucursalId || !paymentId || pago.mpPaymentId !== paymentId ||
      !Number.isFinite(cobradoEn.getTime()) || !Number.isSafeInteger(pago.monto) || pago.monto <= 0 || BigInt(pago.monto) > MAX_INT) {
      throw new BadRequestException("Invalid payment receipt evidence");
    }
    if (pago.estado !== "aprobado") throw new BadRequestException("Approved payment required");
    const existing = await tx.cobro.findFirst({ where: { pedidoId: pago.pedidoId, ...tenant } });
    if (existing) {
      if (existing.metodo === "mercadopago" && existing.mpPaymentId === paymentId) return existing;
      throw new ConflictException("Pedido already has a different receipt");
    }
    const shift = await this.caja.findOpenEffectiveShift(tx, tenant);
    return tx.cobro.create({
      data: {
        pedidoId: pago.pedidoId, monto: pago.monto, metodo: "mercadopago", cobradoEn,
        mpPaymentId: paymentId, turnoCajaId: shift?.id ?? null, ...tenant,
      },
    });
  }
}
