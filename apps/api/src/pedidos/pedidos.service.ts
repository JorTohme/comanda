import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { EstadoPedido, TipoServicio } from "@prisma/client";
import { TenantContext } from "../auth/jwt.service";
import { PrismaService } from "../prisma/prisma.service";
import { MesasService } from "../salon/mesas/mesas.service";
import { CajaService } from "../caja/caja.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { assertTransicionValida } from "./estado-pedido";

export interface CreatePedidoInput {
  tipoServicio: TipoServicio;
  mesaId?: string;
  plataforma?: string;
  direccionEnvio?: string;
  items: { platoId: string; cantidad: number }[];
  clientRequestId?: string;
}

@Injectable()
export class PedidosService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MesasService) private readonly mesasService: MesasService,
    @Inject(CajaService) private readonly cajaService: CajaService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
  ) {}

  async create(input: CreatePedidoInput, tenant: TenantContext) {
    if (input.clientRequestId) {
      const existente = await this.prisma.pedido.findFirst({
        where: { clientRequestId: input.clientRequestId, ...tenant },
        include: { items: true },
      });
      if (existente) return existente;
    }

    if (input.tipoServicio === "mesa" && !input.mesaId) throw new BadRequestException("mesaId is required when tipoServicio=mesa");
    if (input.tipoServicio !== "mesa" && input.mesaId) throw new BadRequestException(`mesaId must not be set when tipoServicio=${input.tipoServicio}`);
    if (input.tipoServicio === "mesa" && input.mesaId) await this.mesasService.assertMesaExists(input.mesaId, tenant);

    if (input.tipoServicio === "delivery") {
      const tienePlataforma = Boolean(input.plataforma);
      const tieneDireccion = Boolean(input.direccionEnvio);
      if (tienePlataforma === tieneDireccion) {
        throw new BadRequestException("delivery requires exactly one of plataforma or direccionEnvio");
      }
    } else if (input.plataforma || input.direccionEnvio) {
      throw new BadRequestException(`plataforma/direccionEnvio must not be set when tipoServicio=${input.tipoServicio}`);
    }

    const platoIds = [...new Set(input.items.map((item) => item.platoId))];
    const platos = await this.prisma.plato.findMany({ where: { id: { in: platoIds }, ...tenant } });
    if (platos.length !== platoIds.length) throw new BadRequestException("One or more items reference a nonexistent Plato");
    const platoById = new Map(platos.map((plato) => [plato.id, plato]));

    const { pedido, mesa } = await this.prisma.$transaction(async (tx) => {
      const pedido = await tx.pedido.create({
        data: {
          tipoServicio: input.tipoServicio,
          mesaId: input.mesaId ?? null,
          plataforma: input.plataforma ?? null,
          direccionEnvio: input.direccionEnvio ?? null,
          estado: "abierto",
          ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
          ...tenant,
          items: { create: input.items.map((item) => {
            const plato = platoById.get(item.platoId)!;
            return { platoId: item.platoId, nombre: plato.nombre, precioUnitario: plato.precio, cantidad: item.cantidad };
          }) },
        },
        include: { items: true },
      });
      const mesa = input.tipoServicio === "mesa" && input.mesaId
        ? await this.mesasService.marcarEstado(tx, input.mesaId, "pedido_en_curso")
        : null;
      return { pedido, mesa };
    });

    this.realtime.emitToSucursal(tenant.sucursalId, "pedido.actualizado", pedido);
    if (mesa) this.realtime.emitToSucursal(tenant.sucursalId, "mesa.actualizada", mesa);
    return pedido;
  }

  findAll(tenant: TenantContext) {
    return this.prisma.pedido.findMany({ where: tenant, include: { items: true } });
  }

  async findOne(id: string, tenant: TenantContext) {
    const pedido = await this.prisma.pedido.findFirst({ where: { id, ...tenant }, include: { items: true } });
    if (!pedido) throw new NotFoundException(`Pedido ${id} not found`);
    return pedido;
  }

  async updateEstado(id: string, destino: EstadoPedido, tenant: TenantContext) {
    const pedido = await this.prisma.pedido.findFirst({ where: { id, ...tenant } });
    if (!pedido) throw new NotFoundException(`Pedido ${id} not found`);
    assertTransicionValida(pedido, destino);

    const pagoAprobado = destino === "entregado"
      ? await this.prisma.pago.findFirst({ where: { pedidoId: id, estado: "aprobado", ...tenant }, select: { id: true } })
      : null;
    const estadoFinal: EstadoPedido = pagoAprobado ? "cobrado" : destino;
    const turno = estadoFinal === "cobrado" ? await this.cajaService.assertTurnoAbierto(tenant) : null;

    const { updated, mesa } = await this.prisma.$transaction(async (tx) => {
      const data = turno ? { estado: estadoFinal, turnoCajaId: turno.id } : { estado: estadoFinal };
      const updated = await tx.pedido.update({ where: { id }, data, include: { items: true } });
      const mesa = estadoFinal === "cerrado" && pedido.tipoServicio === "mesa" && pedido.mesaId
        ? await this.mesasService.marcarEstado(tx, pedido.mesaId, "libre")
        : null;
      return { updated, mesa };
    });

    this.realtime.emitToSucursal(tenant.sucursalId, "pedido.actualizado", updated);
    if (mesa) this.realtime.emitToSucursal(tenant.sucursalId, "mesa.actualizada", mesa);
    return updated;
  }
}
