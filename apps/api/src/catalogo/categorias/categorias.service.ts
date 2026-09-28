import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { TenantContext } from "../../auth/jwt.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateCategoriaDto } from "./dto/create-categoria.dto";
import { UpdateCategoriaDto } from "./dto/update-categoria.dto";
import { RealtimeGateway } from "../../realtime/realtime.gateway";

@Injectable()
export class CategoriasService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
  ) {}

  async create(dto: CreateCategoriaDto, tenant: TenantContext) {
    const categoria = await this.prisma.categoria.create({ data: { ...dto, ...tenant } });
    this.realtime.emitToSucursal(tenant.sucursalId, "categoria.creada", categoria);
    return categoria;
  }

  findAll(tenant: TenantContext) {
    return this.prisma.categoria.findMany({ where: tenant });
  }

  async update(id: string, dto: UpdateCategoriaDto, tenant: TenantContext) {
    await this.assertExists(id, tenant);
    const categoria = await this.prisma.categoria.update({ where: { id }, data: dto });
    this.realtime.emitToSucursal(tenant.sucursalId, "categoria.actualizada", categoria);
    return categoria;
  }

  async remove(id: string, tenant: TenantContext) {
    await this.assertExists(id, tenant);
    const categoria = await this.prisma.categoria.delete({ where: { id } });
    this.realtime.emitToSucursal(tenant.sucursalId, "categoria.eliminada", { id, ...tenant });
    return categoria;
  }

  private async assertExists(id: string, tenant: TenantContext) {
    if (!(await this.prisma.categoria.findFirst({ where: { id, ...tenant }, select: { id: true } }))) {
      throw new NotFoundException(`Categoria ${id} not found`);
    }
  }
}
