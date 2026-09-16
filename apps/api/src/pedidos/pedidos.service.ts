import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { EstadoPedido, TipoServicio } from "@prisma/client";
import { TenantContext } from "../auth/jwt.service";
import { PrismaService } from "../prisma/prisma.service";
import { MesasService } from "../salon/mesas/mesas.service";
import { assertTransicionValida } from "./estado-pedido";

export interface CreatePedidoInput {
  tipoServicio: TipoServicio;
  mesaId?: string;
  items: { platoId: string; cantidad: number }[];
}

@Injectable()
export class PedidosService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MesasService) private readonly mesasService: MesasService,
  ) {}

  async create(input: CreatePedidoInput, tenant: TenantContext) {
    if (input.tipoServicio === "mesa" && !input.mesaId) throw new BadRequestException("mesaId is required when tipoServicio=mesa");
    if (input.tipoServicio === "barra" && input.mesaId) throw new BadRequestException("mesaId must not be set when tipoServicio=barra");
    if (input.tipoServicio === "mesa" && input.mesaId) await this.mesasService.assertMesaExists(input.mesaId, tenant);

    const platoIds = [...new Set(input.items.map((item) => item.platoId))];
    const platos = await this.prisma.plato.findMany({ where: { id: { in: platoIds }, ...tenant } });
    if (platos.length !== platoIds.length) throw new BadRequestException("One or more items reference a nonexistent Plato");
    const platoById = new Map(platos.map((plato) => [plato.id, plato]));

    return this.prisma.$transaction(async (tx) => {
      const pedido = await tx.pedido.create({
        data: {
          tipoServicio: input.tipoServicio,
          mesaId: input.mesaId ?? null,
          estado: "abierto",
          ...tenant,
          items: { create: input.items.map((item) => {
            const plato = platoById.get(item.platoId)!;
            return { platoId: item.platoId, nombre: plato.nombre, precioUnitario: plato.precio, cantidad: item.cantidad };
          }) },
        },
        include: { items: true },
      });
      if (input.tipoServicio === "mesa" && input.mesaId) await this.mesasService.marcarEstado(tx, input.mesaId, "pedido_en_curso");
      return pedido;
    });
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
    assertTransicionValida(pedido.estado, destino);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.pedido.update({ where: { id }, data: { estado: destino }, include: { items: true } });
      if (destino === "cerrado" && pedido.tipoServicio === "mesa" && pedido.mesaId) await this.mesasService.marcarEstado(tx, pedido.mesaId, "libre");
      return updated;
    });
  }
}
