import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { EstadoMesa, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateMesaDto } from "./dto/create-mesa.dto";
import { UpdateMesaDto } from "./dto/update-mesa.dto";

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2025";
}

function isForeignKeyViolationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2003";
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
      if (isForeignKeyViolationError(error)) {
        throw new ConflictException(`Mesa ${id} is referenced by an existing Pedido`);
      }
      throw error;
    }
  }

  async assertMesaExists(mesaId: string) {
    const mesa = await this.prisma.mesa.findUnique({ where: { id: mesaId } });
    if (!mesa) {
      throw new BadRequestException(`Mesa ${mesaId} not found`);
    }
  }

  async marcarEstado(tx: Prisma.TransactionClient, mesaId: string, estado: EstadoMesa) {
    return tx.mesa.update({ where: { id: mesaId }, data: { estado } });
  }
}
