import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { EstadoMesa, Prisma } from "@prisma/client";
import { TenantContext } from "../../auth/jwt.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeGateway } from "../../realtime/realtime.gateway";
import { CreateMesaDto } from "./dto/create-mesa.dto";
import { UpdateMesaDto } from "./dto/update-mesa.dto";

function isForeignKeyViolationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2003";
}

@Injectable()
export class MesasService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
  ) {}

  async create(dto: CreateMesaDto, tenant: TenantContext) {
    const mesa = await this.prisma.mesa.create({ data: { ...dto, estado: dto.estado ?? "libre", ...tenant } });
    this.realtime.emitToSucursal(tenant.sucursalId, "mesa.actualizada", mesa);
    return mesa;
  }

  findAll(tenant: TenantContext) {
    return this.prisma.mesa.findMany({ where: tenant });
  }

  async update(id: string, dto: UpdateMesaDto, tenant: TenantContext) {
    await this.assertOwnedMesa(id, tenant);
    const mesa = await this.prisma.mesa.update({ where: { id }, data: dto });
    this.realtime.emitToSucursal(tenant.sucursalId, "mesa.actualizada", mesa);
    return mesa;
  }

  async remove(id: string, tenant: TenantContext) {
    await this.assertOwnedMesa(id, tenant);
    try {
      return await this.prisma.mesa.delete({ where: { id } });
    } catch (error) {
      if (isForeignKeyViolationError(error)) throw new ConflictException(`Mesa ${id} is referenced by an existing Pedido`);
      throw error;
    }
  }

  async assertMesaExists(mesaId: string, tenant: TenantContext) {
    if (!(await this.prisma.mesa.findFirst({ where: { id: mesaId, ...tenant }, select: { id: true } }))) {
      throw new BadRequestException(`Mesa ${mesaId} not found`);
    }
  }

  private async assertOwnedMesa(mesaId: string, tenant: TenantContext) {
    if (!(await this.prisma.mesa.findFirst({ where: { id: mesaId, ...tenant }, select: { id: true } }))) {
      throw new NotFoundException(`Mesa ${mesaId} not found`);
    }
  }

  async marcarEstado(tx: Prisma.TransactionClient, mesaId: string, estado: EstadoMesa) {
    return tx.mesa.update({ where: { id: mesaId }, data: { estado } });
  }
}
