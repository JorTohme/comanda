import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { EstadoPedido, Prisma, TipoServicio } from "@prisma/client";
import type { JwtClaims, TenantContext } from "../auth/jwt.service";
import { PrismaService } from "../prisma/prisma.service";
import { MesasService, normalizeMesaRealtime } from "../salon/mesas/mesas.service";
import { CajaService } from "../caja/caja.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { lockSucursal } from "../prisma/branch-lock";
import { assertTransicionValida } from "./estado-pedido";
import { assertPedidoActionAllowed, assertPedidoCreateAllowed } from "./pedido-policy";

const MAX_ITEMS = 100;
const MAX_QUANTITY = 999;
const MAX_ORDER_TOTAL = 2_147_483_647;

export interface CreatePedidoInput {
  tipoServicio: TipoServicio;
  mesaId?: string;
  plataforma?: string;
  direccionEnvio?: string;
  items: { platoId: string; cantidad: number }[];
  clientRequestId?: string;
}

export interface UpdateEstadoPedidoInput {
  estado: EstadoPedido;
  expectedVersion: number;
}

interface NormalizedPedido {
  tipoServicio: TipoServicio;
  mesaId: string | null;
  plataforma: string | null;
  direccionEnvio: string | null;
  clientRequestId: string | null;
  items: { platoId: string; cantidad: number }[];
  canonical: string;
}

function normalizePedido(input: CreatePedidoInput): NormalizedPedido {
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > MAX_ITEMS) {
    throw new BadRequestException("Cantidad de elementos inválida");
  }

  const quantities = new Map<string, number>();
  for (const item of input.items) {
    if (typeof item.platoId !== "string" || !item.platoId || !Number.isInteger(item.cantidad) ||
      item.cantidad < 1 || item.cantidad > MAX_QUANTITY) {
      throw new BadRequestException("Cantidad inválida");
    }
    const combined = (quantities.get(item.platoId) ?? 0) + item.cantidad;
    if (combined > MAX_QUANTITY) throw new BadRequestException("Cantidad inválida");
    quantities.set(item.platoId, combined);
  }

  const items = [...quantities]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([platoId, cantidad]) => ({ platoId, cantidad }));
  const mesaId = input.mesaId?.trim() || null;
  const plataforma = input.plataforma?.trim() || null;
  const direccionEnvio = input.direccionEnvio?.trim() || null;
  if (input.tipoServicio === "mesa" && !mesaId) {
    throw new BadRequestException("mesaId is required when tipoServicio=mesa");
  }
  if (input.tipoServicio !== "mesa" && mesaId) {
    throw new BadRequestException(`mesaId must not be set when tipoServicio=${input.tipoServicio}`);
  }
  if (input.tipoServicio === "delivery") {
    if (Boolean(plataforma) === Boolean(direccionEnvio)) {
      throw new BadRequestException("delivery requires exactly one of plataforma or direccionEnvio");
    }
  } else if (plataforma || direccionEnvio) {
    throw new BadRequestException(`plataforma/direccionEnvio must not be set when tipoServicio=${input.tipoServicio}`);
  }

  const clientRequestId = input.clientRequestId?.trim() || null;
  if (input.clientRequestId !== undefined && clientRequestId === null) {
    throw new BadRequestException("clientRequestId cannot be blank");
  }
  const canonical = JSON.stringify({ tipoServicio: input.tipoServicio, mesaId, plataforma, direccionEnvio, items });
  return { tipoServicio: input.tipoServicio, mesaId, plataforma, direccionEnvio, clientRequestId, items, canonical };
}

export function canonicalPedido(input: CreatePedidoInput): string {
  return normalizePedido(input).canonical;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

function assertActorTenant(actor: JwtClaims, tenant: TenantContext): void {
  if (actor.orgId !== tenant.orgId || actor.sucursalId !== tenant.sucursalId) {
    throw new ForbiddenException("Actor does not belong to this tenant");
  }
}

@Injectable()
export class PedidosService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MesasService) private readonly mesasService: MesasService,
    @Inject(CajaService) private readonly cajaService: CajaService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
  ) {}

  async create(input: CreatePedidoInput, tenant: TenantContext, actor: JwtClaims) {
    assertActorTenant(actor, tenant);
    assertPedidoCreateAllowed(actor.rol);
    const normalized = normalizePedido(input);
    const requestFingerprint = createHash("sha256").update(normalized.canonical).digest("hex");

    let outcome: {
      pedido: Prisma.PedidoGetPayload<{ include: { items: true; cobro: true } }>;
      mesa: Prisma.MesaGetPayload<object> | null;
      created: boolean;
    };
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        await lockSucursal(tx, tenant);
        if (normalized.clientRequestId) {
          const existing = await tx.pedido.findFirst({
            where: { clientRequestId: normalized.clientRequestId, ...tenant },
            include: { items: true, cobro: true },
          });
          if (existing) {
            if (!existing.requestFingerprint || existing.requestFingerprint !== requestFingerprint) {
              throw new ConflictException("clientRequestId was already used with a different or unknown payload");
            }
            return { pedido: existing, mesa: null, created: false };
          }
        }

        const platos = await tx.plato.findMany({
          where: { id: { in: normalized.items.map((item) => item.platoId) }, disponible: true, ...tenant },
          select: { id: true, nombre: true, precio: true },
        });
        if (platos.length !== normalized.items.length) {
          throw new BadRequestException("One or more items reference a nonexistent or unavailable Plato");
        }
        const platoById = new Map(platos.map((plato) => [plato.id, plato]));
        let total = 0;
        for (const item of normalized.items) {
          const plato = platoById.get(item.platoId)!;
          const lineTotal = plato.precio * item.cantidad;
          if (!Number.isSafeInteger(lineTotal) || lineTotal < 0 || total + lineTotal > MAX_ORDER_TOTAL) {
            throw new BadRequestException("Order total is outside the supported range");
          }
          total += lineTotal;
        }
        if (total <= 0) throw new BadRequestException("Order total must be positive");

        if (normalized.mesaId) {
          const mesa = await tx.mesa.findFirst({ where: { id: normalized.mesaId, ...tenant }, select: { id: true } });
          if (!mesa) throw new BadRequestException(`Mesa ${normalized.mesaId} not found`);
          const active = await tx.pedido.findFirst({
            where: { mesaId: mesa.id, estado: { not: "cerrado" }, ...tenant },
            select: { id: true },
          });
          if (active) throw new ConflictException(`Mesa ${mesa.id} has an active Pedido`);
        }

        const pedido = await tx.pedido.create({
          data: {
            tipoServicio: normalized.tipoServicio,
            mesaId: normalized.mesaId,
            plataforma: normalized.plataforma,
            direccionEnvio: normalized.direccionEnvio,
            clientRequestId: normalized.clientRequestId,
            requestFingerprint,
            ...tenant,
            items: { create: normalized.items.map((item) => {
              const plato = platoById.get(item.platoId)!;
              return { platoId: item.platoId, nombre: plato.nombre, precioUnitario: plato.precio, cantidad: item.cantidad };
            }) },
          },
          include: { items: true, cobro: true },
        });
        const mesa = normalized.mesaId
          ? await this.mesasService.marcarEstado(tx, normalized.mesaId, "pedido_en_curso")
          : null;
        return { pedido, mesa, created: true };
      });
    } catch (error) {
      if (isUniqueConstraintError(error) && normalized.clientRequestId) {
        const existing = await this.prisma.pedido.findFirst({
          where: { clientRequestId: normalized.clientRequestId, ...tenant },
          include: { items: true, cobro: true },
        });
        if (existing?.requestFingerprint === requestFingerprint) return existing;
        throw new ConflictException("Pedido creation conflicts with an existing order");
      }
      throw error;
    }

    if (!outcome.created) return outcome.pedido;
    this.realtime.emitToSucursal(tenant.sucursalId, "pedido.creado", outcome.pedido);
    if (outcome.mesa) this.realtime.emitToSucursal(tenant.sucursalId, "mesa.actualizada", normalizeMesaRealtime(outcome.mesa));
    return outcome.pedido;
  }

  findAll(tenant: TenantContext) {
    return this.prisma.pedido.findMany({ where: tenant, include: { items: true, cobro: true } });
  }

  async findOne(id: string, tenant: TenantContext) {
    const pedido = await this.prisma.pedido.findFirst({ where: { id, ...tenant }, include: { items: true, cobro: true } });
    if (!pedido) throw new NotFoundException(`Pedido ${id} not found`);
    return pedido;
  }

  async updateEstado(id: string, input: UpdateEstadoPedidoInput, tenant: TenantContext, actor: JwtClaims) {
    assertActorTenant(actor, tenant);
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
      throw new BadRequestException("expectedVersion must be a non-negative integer");
    }
    if (input.estado === "cobrado") throw new BadRequestException("Use the explicit cash collection endpoint");
    assertPedidoActionAllowed(actor.rol, input.estado);
    return this.transition(id, input.estado, input.expectedVersion, tenant, "actor");
  }

  // Temporary provider bridge; payment reconciliation replaces this with receipt posting in the next slice.
  async settleApprovedPayment(id: string, tenant: TenantContext) {
    const pedido = await this.prisma.pedido.findFirst({ where: { id, ...tenant }, select: { version: true } });
    if (!pedido) throw new NotFoundException(`Pedido ${id} not found`);
    return this.transition(id, "cobrado", pedido.version, tenant, "provider");
  }

  private async transition(
    id: string,
    destino: EstadoPedido,
    expectedVersion: number,
    tenant: TenantContext,
    source: "actor" | "provider",
  ) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockSucursal(tx, tenant);
      const pedido = await tx.pedido.findFirst({
        where: { id, ...tenant },
        include: { cobro: true },
      });
      if (!pedido) throw new NotFoundException(`Pedido ${id} not found`);
      if (pedido.version !== expectedVersion) throw new ConflictException("Pedido actualizado; recargue la vista");
      if (source === "actor" && destino === "cobrado") {
        throw new BadRequestException("Use the explicit cash collection endpoint");
      }
      if (source === "provider") {
        const approved = await tx.pago.findFirst({
          where: { pedidoId: id, estado: "aprobado", ...tenant }, select: { id: true },
        });
        if (!approved) throw new BadRequestException("Approved payment required");
      } else {
        assertTransicionValida(pedido, destino);
      }
      if (destino === "cerrado" && (!pedido.cobro || !pedido.cobro.cobradoEn)) {
        throw new BadRequestException("A proven receipt is required before closing an order");
      }

      const estadoFinal: EstadoPedido = destino === "entregado" && pedido.cobro?.cobradoEn ? "cobrado" : destino;
      const turno = source === "provider" ? await this.cajaService.assertTurnoAbierto(tenant) : null;
      const updated = await tx.pedido.update({
        where: { id, orgId: tenant.orgId, sucursalId: tenant.sucursalId, version: expectedVersion },
        data: {
          estado: estadoFinal,
          version: { increment: 1 },
          ...(turno ? { turnoCajaId: turno.id } : {}),
        },
        include: { items: true, cobro: true },
      });
      const mesa = estadoFinal === "cerrado" && pedido.tipoServicio === "mesa" && pedido.mesaId
        ? await this.mesasService.marcarEstado(tx, pedido.mesaId, "libre")
        : null;
      return { pedido: updated, mesa };
    });

    this.realtime.emitToSucursal(tenant.sucursalId, "pedido.actualizado", outcome.pedido);
    if (outcome.mesa) this.realtime.emitToSucursal(tenant.sucursalId, "mesa.actualizada", normalizeMesaRealtime(outcome.mesa));
    return outcome.pedido;
  }
}
