import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateMesaDto } from "./dto/create-mesa.dto";
import { UpdateMesaDto } from "./dto/update-mesa.dto";

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2025";
}

@Injectable()
export class MesasService {
  // ponytail: explicit @Inject token — see categorias.controller.ts for why.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  create(dto: CreateMesaDto) {
    return this.prisma.mesa.create({
      data: {
        nombre: dto.nombre,
        capacidad: dto.capacidad,
        estado: dto.estado ?? "libre",
      },
    });
  }

  findAll() {
    return this.prisma.mesa.findMany({});
  }

  async update(id: string, dto: UpdateMesaDto) {
    try {
      return await this.prisma.mesa.update({ where: { id }, data: dto });
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new NotFoundException(`Mesa ${id} not found`);
      }
      throw error;
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.mesa.delete({ where: { id } });
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new NotFoundException(`Mesa ${id} not found`);
      }
      throw error;
    }
  }
}
