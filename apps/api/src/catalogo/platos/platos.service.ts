import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { TenantContext } from "../../auth/jwt.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeGateway } from "../../realtime/realtime.gateway";
import { CreatePlatoDto } from "./dto/create-plato.dto";
import { UpdatePlatoDto } from "./dto/update-plato.dto";

function isForeignKeyViolationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2003";
}

@Injectable()
export class PlatosService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
  ) {}

  private async assertCategoriaExists(categoriaId: string, tenant: TenantContext) {
    if (!(await this.prisma.categoria.findFirst({ where: { id: categoriaId, ...tenant }, select: { id: true } }))) {
      throw new BadRequestException(`Categoria ${categoriaId} not found`);
    }
  }

  async create(dto: CreatePlatoDto, tenant: TenantContext) {
    await this.assertCategoriaExists(dto.categoriaId, tenant);
    return this.prisma.plato.create({ data: { ...dto, disponible: dto.disponible ?? true, ...tenant } });
  }

  findAll(categoriaId: string | undefined, tenant: TenantContext) {
    return this.prisma.plato.findMany({ where: { ...tenant, ...(categoriaId ? { categoriaId } : {}) } });
  }

  async update(id: string, dto: UpdatePlatoDto, tenant: TenantContext) {
    await this.assertExists(id, tenant);
    if (dto.categoriaId) await this.assertCategoriaExists(dto.categoriaId, tenant);
    const plato = await this.prisma.plato.update({ where: { id }, data: dto });
    this.realtime.emitToSucursal(tenant.sucursalId, "plato.actualizado", plato);
    return plato;
  }

  async remove(id: string, tenant: TenantContext) {
    await this.assertExists(id, tenant);
    try {
      return await this.prisma.plato.delete({ where: { id } });
    } catch (error) {
      if (isForeignKeyViolationError(error)) throw new ConflictException(`Plato ${id} is referenced by an existing Pedido`);
      throw error;
    }
  }

  private async assertExists(id: string, tenant: TenantContext) {
    if (!(await this.prisma.plato.findFirst({ where: { id, ...tenant }, select: { id: true } }))) {
      throw new NotFoundException(`Plato ${id} not found`);
    }
  }
}
