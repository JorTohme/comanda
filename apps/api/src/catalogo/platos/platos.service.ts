import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreatePlatoDto } from "./dto/create-plato.dto";
import { UpdatePlatoDto } from "./dto/update-plato.dto";

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2025";
}

@Injectable()
export class PlatosService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertCategoriaExists(categoriaId: string) {
    const categoria = await this.prisma.categoria.findUnique({ where: { id: categoriaId } });
    if (!categoria) {
      throw new BadRequestException(`Categoria ${categoriaId} not found`);
    }
  }

  async create(dto: CreatePlatoDto) {
    await this.assertCategoriaExists(dto.categoriaId);
    return this.prisma.plato.create({
      data: {
        nombre: dto.nombre,
        precio: dto.precio,
        categoriaId: dto.categoriaId,
        disponible: dto.disponible ?? true,
      },
    });
  }

  findAll(categoriaId?: string) {
    return this.prisma.plato.findMany({ where: categoriaId ? { categoriaId } : {} });
  }

  async update(id: string, dto: UpdatePlatoDto) {
    if (dto.categoriaId) {
      await this.assertCategoriaExists(dto.categoriaId);
    }
    try {
      return await this.prisma.plato.update({ where: { id }, data: dto });
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new NotFoundException(`Plato ${id} not found`);
      }
      throw error;
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.plato.delete({ where: { id } });
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new NotFoundException(`Plato ${id} not found`);
      }
      throw error;
    }
  }
}
