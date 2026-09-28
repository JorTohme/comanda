import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { EstadoMesa, Prisma } from "@prisma/client";
import { TenantContext } from "../../auth/jwt.service";
import { PrismaService } from "../../prisma/prisma.service";
import { lockSucursal } from "../../prisma/branch-lock";
import { RealtimeGateway } from "../../realtime/realtime.gateway";
import { CreateMesaDto } from "./dto/create-mesa.dto";
import { UpdateMesaDto } from "./dto/update-mesa.dto";

function isForeignKeyViolationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2003";
}

@Injectable()
export class MesasService {
  private readonly logger = new Logger(MesasService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
  ) {}

  async create(dto: CreateMesaDto, tenant: TenantContext) {
    const mesa = await this.prisma.$transaction(async (tx) => {
      await lockSucursal(tx, tenant);
      return tx.mesa.create({ data: { ...dto, estado: dto.estado ?? "libre", ...tenant } });
    });
    this.publish(tenant, mesa);
    return mesa;
  }

  findAll(tenant: TenantContext) {
    return this.prisma.mesa.findMany({ where: tenant });
  }

  async update(id: string, dto: UpdateMesaDto, tenant: TenantContext) {
    const mesa = await this.prisma.$transaction(async (tx) => {
      await lockSucursal(tx, tenant);
      await this.assertOwnedMesa(tx, id, tenant);
      if (dto.estado === "libre") {
        const active = await tx.pedido.findFirst({
          where: { mesaId: id, estado: { not: "cerrado" }, ...tenant }, select: { id: true },
        });
        if (active) throw new ConflictException(`Mesa ${id} has an active Pedido`);
      }
      return tx.mesa.update({ where: { id }, data: dto });
    });
    this.publish(tenant, mesa);
    return mesa;
  }

  updateOccupancy(id: string, estado: "libre" | "ocupada", tenant: TenantContext) {
    return this.update(id, { estado }, tenant);
  }

  async remove(id: string, tenant: TenantContext) {
    try {
      const mesa = await this.prisma.$transaction(async (tx) => {
        await lockSucursal(tx, tenant);
        await this.assertOwnedMesa(tx, id, tenant);
        return tx.mesa.delete({ where: { id } });
      });
      return mesa;
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

  private async assertOwnedMesa(tx: Prisma.TransactionClient, mesaId: string, tenant: TenantContext) {
    if (!(await tx.mesa.findFirst({ where: { id: mesaId, ...tenant }, select: { id: true } }))) {
      throw new NotFoundException(`Mesa ${mesaId} not found`);
    }
  }

  async marcarEstado(tx: Prisma.TransactionClient, mesaId: string, estado: EstadoMesa) {
    return tx.mesa.update({ where: { id: mesaId }, data: { estado } });
  }

  private publish(tenant: TenantContext, mesa: unknown): void {
    try {
      this.realtime.emitToSucursal(tenant.sucursalId, "mesa.actualizada", mesa);
    } catch (error) {
      this.logger.error("Failed to publish mesa.actualizada after committed mesa mutation", error instanceof Error ? error.stack : undefined);
    }
  }
}
