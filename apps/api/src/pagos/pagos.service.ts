import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger,
  NotFoundException, ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Pago } from "@prisma/client";
import type { JwtClaims, TenantContext } from "../auth/jwt.service";
import { lockSucursal } from "../prisma/branch-lock";
import { PrismaService } from "../prisma/prisma.service";
import { CobrosService } from "../pedidos/cobros.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { MercadoPagoClient, type PagoMercadoPago, type PreferenciaCreada } from "./mercadopago.client";

const MAX_INT = 2_147_483_647n;
const CREATE_LEASE_MS = 60_000;
type AttemptOutcome = {
  kind: "created" | "recover";
  pago: Pago;
  items: { id: string; title: string; quantity: number; unitPrice: number }[];
};

function assertActor(actor: JwtClaims, tenant: TenantContext, adminOnly = false): void {
  if (actor.orgId !== tenant.orgId || actor.sucursalId !== tenant.sucursalId) throw new ForbiddenException("Actor does not belong to this tenant");
  if (adminOnly ? actor.rol !== "admin" : actor.rol !== "admin" && actor.rol !== "caja") {
    throw new ForbiddenException(adminOnly ? "Admin role required" : "Caja role required");
  }
}

function sumItems(items: { precioUnitario: number; cantidad: number }[]): number {
  let total = 0n;
  for (const item of items) {
    if (!Number.isSafeInteger(item.precioUnitario) || item.precioUnitario <= 0 || !Number.isSafeInteger(item.cantidad) || item.cantidad <= 0) {
      throw new BadRequestException("Order contains an invalid item amount");
    }
    total += BigInt(item.precioUnitario) * BigInt(item.cantidad);
    if (total > MAX_INT) throw new BadRequestException("Order total is outside the supported integer range");
  }
  if (!total) throw new BadRequestException("Order total must be positive");
  return Number(total);
}

function preferenceMismatch(p: PreferenciaCreada, attempt: Pago, merchantId: string): string | null {
  if (!p.preferenceId || !p.initPoint || !/^https:\/\//i.test(p.initPoint)) return "Provider preference is missing a valid checkout URL or id";
  if (p.externalReference !== attempt.externalReference) return "Provider preference external reference mismatch";
  if (p.merchantId !== merchantId) return "Provider preference merchant mismatch";
  if (p.monto !== attempt.monto) return "Provider preference amount mismatch";
  if (p.currency !== attempt.moneda) return "Provider preference currency mismatch";
  return null;
}

function paymentMismatch(p: PagoMercadoPago, attempt: Pago, expectedPaymentId: string, merchantId: string): string | null {
  if (!p.id || p.id !== expectedPaymentId) return "Provider payment id mismatch";
  if (p.externalReference !== attempt.externalReference) return "Provider payment external reference mismatch";
  if (!Number.isSafeInteger(p.amountCents) || p.amountCents !== attempt.monto) return "Provider payment amount mismatch";
  if (p.currency !== attempt.moneda) return "Provider payment currency mismatch";
  if (p.merchantId !== merchantId || (attempt.merchantId && attempt.merchantId !== p.merchantId)) return "Provider payment merchant mismatch";
  if (!attempt.mpPreferenceId || p.preferenceId !== attempt.mpPreferenceId) return "Provider payment preference mismatch";
  if (p.status === "approved" && (!p.approvedAt || !Number.isFinite(p.approvedAt.getTime()))) return "Approved payment is missing a valid approval date";
  return null;
}

function isDefinitiveProviderRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 429;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

@Injectable()
export class PagosService {
  private readonly logger = new Logger(PagosService.name);
  private readonly merchantId = process.env.MERCADOPAGO_MERCHANT_ID?.trim() ?? "";

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MercadoPagoClient) private readonly mpClient: MercadoPagoClient,
    @Inject(CobrosService) private readonly cobros: CobrosService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
  ) {}

  async crearPreferencia(pedidoId: string, tenant: TenantContext, actor: JwtClaims): Promise<{ initPoint: string; preferenceId: string }> {
    assertActor(actor, tenant);
    const merchantId = this.requireMerchantId();
    const notificationUrl = this.notificationUrl();
    const reservation = await this.prisma.$transaction(async (tx): Promise<AttemptOutcome> => {
      await lockSucursal(tx, tenant);
      const pedido = await tx.pedido.findFirst({ where: { id: pedidoId, ...tenant }, include: { items: true, cobro: true } });
      if (!pedido) throw new NotFoundException(`Pedido ${pedidoId} not found`);
      if (pedido.cobro) throw new ConflictException("Pedido already has a receipt");
      const attempts = await tx.pago.findMany({ where: { pedidoId, ...tenant }, orderBy: { createdAt: "desc" } });
      const active = attempts.find((p) => p.estado === "incidente") ?? attempts.find((p) => p.estado === "pendiente" || p.estado === "creando");
      if (active?.estado === "incidente") throw new ConflictException("Payment attempt requires administrator reconciliation");
      if (active?.estado === "pendiente" && active.mpPreferenceId && active.mpInitPoint) {
        return { kind: "created", pago: active, items: [] };
      }
      if (active?.estado === "creando") {
        if (active.leaseUntil && active.leaseUntil > new Date()) throw new ConflictException("Payment preference is being created; retry later");
        const claimed = await tx.pago.update({ where: { id: active.id }, data: { leaseUntil: new Date(Date.now() + CREATE_LEASE_MS) } });
        return { kind: "recover", pago: claimed, items: [] };
      }

      const monto = sumItems(pedido.items);
      const items = pedido.items.map((item) => ({
        id: item.platoId, title: item.nombre, quantity: item.cantidad, unitPrice: item.precioUnitario / 100,
      }));
      const attemptId = randomUUID();
      const pago = await tx.pago.create({ data: {
        id: attemptId, pedidoId, externalReference: attemptId, monto, moneda: "ARS", merchantId, estado: "creando",
        leaseUntil: new Date(Date.now() + CREATE_LEASE_MS), ...tenant,
      } });
      return { kind: "created", pago, items };
    });

    if (reservation.pago.estado === "pendiente" && reservation.pago.mpInitPoint && reservation.pago.mpPreferenceId) {
      return { initPoint: reservation.pago.mpInitPoint, preferenceId: reservation.pago.mpPreferenceId };
    }

    let preferences: PreferenciaCreada[];
    try {
      preferences = reservation.kind === "recover"
        ? await this.mpClient.buscarPreferencias(reservation.pago.externalReference)
        : [await this.mpClient.crearPreferencia({
          pedidoId, externalReference: reservation.pago.externalReference,
          items: reservation.items, notificationUrl,
        })];
    } catch (error) {
      this.logger.error("Mercado Pago preference request failed", error instanceof Error ? error.stack : undefined);
      if (reservation.kind === "created" && isDefinitiveProviderRejection(error)) {
        await this.prisma.$transaction(async (tx) => {
          await lockSucursal(tx, tenant);
          const current = await tx.pago.findFirst({ where: { id: reservation.pago.id, estado: "creando", ...tenant } });
          if (current) await tx.pago.update({ where: { id: current.id }, data: { estado: "rechazado", leaseUntil: null } });
        });
        throw new BadRequestException("Mercado Pago rejected the payment preference request");
      }
      throw new ServiceUnavailableException("Payment provider is temporarily unavailable");
    }
    const mismatch = preferences.length !== 1 ? `Expected one provider preference for attempt; found ${preferences.length}` : preferenceMismatch(preferences[0], reservation.pago, merchantId);
    const result = await this.prisma.$transaction(async (tx) => {
      await lockSucursal(tx, tenant);
      const current = await tx.pago.findFirst({ where: { id: reservation.pago.id, ...tenant } });
      if (!current) throw new NotFoundException("Payment attempt not found");
      const order = await tx.pedido.findFirst({ where: { id: pedidoId, ...tenant }, include: { cobro: true } });
      if (!order) throw new NotFoundException(`Pedido ${pedidoId} not found`);
      if (order.cobro || mismatch) {
        const incident = order.cobro ? "Pedido received a receipt while provider preference was being created" : mismatch!;
        await tx.pago.update({ where: { id: current.id }, data: { estado: "incidente", incidente: incident, leaseUntil: null } });
        return { incidente: incident };
      }
      const pref = preferences[0];
      const updated = await tx.pago.update({ where: { id: current.id }, data: {
        estado: "pendiente", mpPreferenceId: pref.preferenceId, mpInitPoint: pref.initPoint, leaseUntil: null,
      } });
      return { pago: updated };
    });
    if ("incidente" in result) throw new ConflictException(result.incidente);
    return { initPoint: result.pago.mpInitPoint!, preferenceId: result.pago.mpPreferenceId! };
  }

  async procesarWebhook(paymentId: string): Promise<{ estado: string; incidente: string | null }> {
    let payment: PagoMercadoPago;
    try { payment = await this.mpClient.obtenerPago(paymentId); }
    catch { throw new ServiceUnavailableException("Payment provider is temporarily unavailable"); }
    if (!payment.externalReference) return { estado: "ignorado", incidente: null };
    const attempt = await this.prisma.pago.findUnique({ where: { externalReference: payment.externalReference } });
    if (!attempt) { this.logger.warn(`Ignoring payment with unknown external reference ${payment.externalReference}`); return { estado: "ignorado", incidente: null }; }
    return this.reconcileAttempt(attempt, payment, paymentId);
  }

  async reconciliar(pagoId: string, paymentId: string, tenant: TenantContext, actor: JwtClaims): Promise<{ estado: string; incidente: string | null }> {
    assertActor(actor, tenant, true);
    this.requireMerchantId();
    const attempt = await this.prisma.pago.findFirst({ where: { id: pagoId, ...tenant } });
    if (!attempt) throw new NotFoundException("Payment attempt not found");
    let payment: PagoMercadoPago;
    try { payment = await this.mpClient.obtenerPago(paymentId); }
    catch { throw new ServiceUnavailableException("Payment provider is temporarily unavailable"); }
    return this.reconcileAttempt(attempt, payment, paymentId);
  }

  listarIncidentes(tenant: TenantContext) {
    return this.prisma.pago.findMany({ where: { ...tenant, estado: "incidente" }, orderBy: { updatedAt: "desc" } });
  }

  private async reconcileAttempt(initial: Pago, payment: PagoMercadoPago, expectedPaymentId: string) {
    const tenant: TenantContext = { orgId: initial.orgId, sucursalId: initial.sucursalId };
    let outcome: { estado: string; incidente: string | null; pedido?: unknown };
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
      await lockSucursal(tx, tenant);
      const attempt = await tx.pago.findFirst({ where: { id: initial.id, ...tenant } });
      if (!attempt) throw new NotFoundException("Payment attempt not found");
      const order = await tx.pedido.findFirst({ where: { id: attempt.pedidoId, ...tenant }, include: { items: true, cobro: true } });
      if (!order) throw new NotFoundException("Payment order not found");
      if (attempt.estado === "creando" && !attempt.mpPreferenceId) {
        throw new ServiceUnavailableException("Payment preference is not yet linked; provider retry required");
      }
      if (attempt.mpPaymentId && attempt.mpPaymentId !== payment.id) {
        const incident = "Conflicting provider payment id for approved attempt";
        await tx.pago.update({ where: { id: attempt.id }, data: { estado: "incidente", incidente: incident } });
        return { estado: "incidente", incidente: incident };
      }
      const paymentAlreadyBound = await tx.pago.findFirst({ where: { mpPaymentId: payment.id, id: { not: attempt.id } }, select: { id: true } });
      if (paymentAlreadyBound) {
        const incident = "Provider payment id is already bound to another attempt";
        await tx.pago.update({ where: { id: attempt.id }, data: { estado: "incidente", incidente: incident } });
        return { estado: "incidente", incidente: incident };
      }
      if (attempt.estado === "aprobado" && payment.status !== "approved") return { estado: "aprobado", incidente: attempt.incidente };
      const mismatch = paymentMismatch(payment, attempt, expectedPaymentId, this.requireMerchantId());
      if (mismatch) {
        await tx.pago.update({ where: { id: attempt.id }, data: { estado: "incidente", incidente: mismatch } });
        return { estado: "incidente", incidente: mismatch };
      }
      if (payment.status !== "approved") {
        if (payment.status === "rejected" && attempt.estado !== "aprobado" && !order.cobro) {
          await tx.pago.update({ where: { id: attempt.id }, data: { estado: "rechazado", mpPaymentId: payment.id } });
          return { estado: "rechazado", incidente: attempt.incidente };
        }
        return { estado: attempt.estado, incidente: attempt.incidente };
      }
      if (order.cobro && !(order.cobro.metodo === "mercadopago" && order.cobro.mpPaymentId === payment.id && order.cobro.monto === attempt.monto)) {
        const incident = "Pedido already has a different receipt; provider approval requires investigation";
        await tx.pago.update({ where: { id: attempt.id }, data: { estado: "incidente", mpPaymentId: payment.id, incidente: incident } });
        return { estado: "incidente", incidente: incident };
      }
      const approved = await tx.pago.update({ where: { id: attempt.id }, data: { estado: "aprobado", mpPaymentId: payment.id, incidente: attempt.incidente } });
      await this.cobros.postDigital(tx, approved, payment.id, payment.approvedAt!, tenant);
      let updatedOrder = order;
      if (order.estado === "entregado") {
        updatedOrder = await tx.pedido.update({ where: { id: order.id, orgId: tenant.orgId, sucursalId: tenant.sucursalId, version: order.version }, data: { estado: "cobrado", version: { increment: 1 } }, include: { items: true, cobro: true } });
      }
      return { estado: "aprobado", incidente: approved.incidente, pedido: updatedOrder };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const incident = "Provider payment id conflicts with an existing receipt or attempt";
      outcome = await this.prisma.$transaction(async (tx) => {
        await lockSucursal(tx, tenant);
        const current = await tx.pago.findFirst({ where: { id: initial.id, ...tenant } });
        if (!current) throw new NotFoundException("Payment attempt not found");
        if (current.mpPaymentId === payment.id && current.estado === "aprobado") return { estado: "aprobado", incidente: current.incidente };
        await tx.pago.update({ where: { id: current.id }, data: { estado: "incidente", incidente: incident } });
        return { estado: "incidente", incidente: incident };
      });
    }
    if ("pedido" in outcome) {
      try { this.realtime.emitToSucursal(tenant.sucursalId, "pedido.actualizado", outcome.pedido); }
      catch (error) { this.logger.error("Failed to publish payment receipt after commit", error instanceof Error ? error.stack : undefined); }
    }
    return { estado: outcome.estado, incidente: outcome.incidente };
  }

  private requireMerchantId(): string {
    if (!this.merchantId) throw new ServiceUnavailableException("MERCADOPAGO_MERCHANT_ID must be configured");
    return this.merchantId;
  }

  private notificationUrl(): string {
    const baseUrl = process.env.PUBLIC_BASE_URL;
    if (!baseUrl) throw new BadRequestException("PUBLIC_BASE_URL must be configured before creating payments");
    try { return new URL("/pagos/webhook", baseUrl).toString(); }
    catch { throw new BadRequestException("PUBLIC_BASE_URL must be a valid URL"); }
  }
}
