import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSucursalDto } from "./dto/create-sucursal.dto";

function isUniqueError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

@Injectable()
export class SucursalesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(dto: CreateSucursalDto, orgId: string) {
    try {
      return await this.prisma.sucursal.create({ data: { nombre: dto.nombre, organizacionId: orgId } });
    } catch (error) {
      if (isUniqueError(error)) throw new ConflictException(`Sucursal "${dto.nombre}" already exists`);
      throw error;
    }
  }

  findAll(orgId: string) {
    return this.prisma.sucursal.findMany({ where: { organizacionId: orgId } });
  }
}
