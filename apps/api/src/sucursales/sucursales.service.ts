import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSucursalDto } from "./dto/create-sucursal.dto";

const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function isUniqueError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

@Injectable()
export class SucursalesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(dto: CreateSucursalDto, orgId: string) {
    const timezone = dto.timezone ?? DEFAULT_TIMEZONE;
    if (!isValidTimezone(timezone)) throw new BadRequestException("timezone must be a valid IANA timezone");
    try {
      return await this.prisma.sucursal.create({ data: { nombre: dto.nombre, organizacionId: orgId, timezone } });
    } catch (error) {
      if (isUniqueError(error)) throw new ConflictException(`Sucursal "${dto.nombre}" already exists`);
      throw error;
    }
  }

  findAll(orgId: string) {
    return this.prisma.sucursal.findMany({ where: { organizacionId: orgId } });
  }
}
