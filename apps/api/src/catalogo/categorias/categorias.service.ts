import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateCategoriaDto } from "./dto/create-categoria.dto";
import { UpdateCategoriaDto } from "./dto/update-categoria.dto";

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2025";
}

@Injectable()
export class CategoriasService {
  // ponytail: explicit @Inject token — see categorias.controller.ts for why.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  create(dto: CreateCategoriaDto) {
    return this.prisma.categoria.create({ data: dto });
  }

  findAll() {
    return this.prisma.categoria.findMany();
  }

  async update(id: string, dto: UpdateCategoriaDto) {
    try {
      return await this.prisma.categoria.update({ where: { id }, data: dto });
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new NotFoundException(`Categoria ${id} not found`);
      }
      throw error;
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.categoria.delete({ where: { id } });
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new NotFoundException(`Categoria ${id} not found`);
      }
      throw error;
    }
  }
}
