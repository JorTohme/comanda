import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { TenantContext } from "../../auth/jwt.service";
import { PrismaService } from "../../prisma/prisma.service";
import { lockSucursal } from "../../prisma/branch-lock";
import { RealtimeGateway } from "../../realtime/realtime.gateway";
import { CreatePlatoDto } from "./dto/create-plato.dto";
import { UpdatePlatoDto } from "./dto/update-plato.dto";

function isForeignKeyViolationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2003";
}

@Injectable()
export class PlatosService {
  private readonly logger = new Logger(PlatosService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
  ) {}

  private async assertCategoriaExists(tx: Prisma.TransactionClient, categoriaId: string, tenant: TenantContext) {
    if (!(await tx.categoria.findFirst({ where: { id: categoriaId, ...tenant }, select: { id: true } }))) {
      throw new BadRequestException(`Categoria ${categoriaId} not found`);
    }
  }

  async create(dto: CreatePlatoDto, tenant: TenantContext) {
    const plato = await this.prisma.$transaction(async (tx) => {
      await lockSucursal(tx, tenant);
      await this.assertCategoriaExists(tx, dto.categoriaId, tenant);
      return tx.plato.create({ data: { ...dto, disponible: dto.disponible ?? true, ...tenant } });
    });
    this.publish(tenant, plato);
    return plato;
  }

  findAll(categoriaId: string | undefined, tenant: TenantContext) {
    return this.prisma.plato.findMany({ where: { ...tenant, ...(categoriaId ? { categoriaId } : {}) } });
  }

  async update(id: string, dto: UpdatePlatoDto, tenant: TenantContext) {
    const plato = await this.prisma.$transaction(async (tx) => {
      await lockSucursal(tx, tenant);
      await this.assertExists(tx, id, tenant);
      if (dto.categoriaId) await this.assertCategoriaExists(tx, dto.categoriaId, tenant);
      return tx.plato.update({ where: { id }, data: dto });
    });
    this.publish(tenant, plato);
    return plato;
  }

  async remove(id: string, tenant: TenantContext) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockSucursal(tx, tenant);
        await this.assertExists(tx, id, tenant);
        return tx.plato.delete({ where: { id } });
      });
    } catch (error) {
      if (isForeignKeyViolationError(error)) throw new ConflictException(`Plato ${id} is referenced by an existing Pedido`);
      throw error;
    }
  }

  private async assertExists(tx: Prisma.TransactionClient, id: string, tenant: TenantContext) {
    if (!(await tx.plato.findFirst({ where: { id, ...tenant }, select: { id: true } }))) {
      throw new NotFoundException(`Plato ${id} not found`);
    }
  }

  private publish(tenant: TenantContext, plato: unknown): void {
    try {
      this.realtime.emitToSucursal(tenant.sucursalId, "plato.actualizado", plato);
    } catch (error) {
      this.logger.error("Failed to publish plato.actualizado after committed catalog mutation", error instanceof Error ? error.stack : undefined);
    }
  }
}
