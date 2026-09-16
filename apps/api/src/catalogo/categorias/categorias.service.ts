import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { TenantContext } from "../../auth/jwt.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateCategoriaDto } from "./dto/create-categoria.dto";
import { UpdateCategoriaDto } from "./dto/update-categoria.dto";

@Injectable()
export class CategoriasService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  create(dto: CreateCategoriaDto, tenant: TenantContext) {
    return this.prisma.categoria.create({ data: { ...dto, ...tenant } });
  }

  findAll(tenant: TenantContext) {
    return this.prisma.categoria.findMany({ where: tenant });
  }

  async update(id: string, dto: UpdateCategoriaDto, tenant: TenantContext) {
    await this.assertExists(id, tenant);
    return this.prisma.categoria.update({ where: { id }, data: dto });
  }

  async remove(id: string, tenant: TenantContext) {
    await this.assertExists(id, tenant);
    return this.prisma.categoria.delete({ where: { id } });
  }

  private async assertExists(id: string, tenant: TenantContext) {
    if (!(await this.prisma.categoria.findFirst({ where: { id, ...tenant }, select: { id: true } }))) {
      throw new NotFoundException(`Categoria ${id} not found`);
    }
  }
}
