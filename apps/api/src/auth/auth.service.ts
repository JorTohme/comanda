import { ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtService, hashPassword, verifyPassword } from "./jwt.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";

function isUniqueError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    try {
      const passwordHash = await hashPassword(dto.password);
      const user = await this.prisma.$transaction(async (tx) => {
        const organizacion = await tx.organizacion.create({ data: { nombre: dto.organizacionNombre } });
        const sucursal = await tx.sucursal.create({
          data: { nombre: dto.sucursalNombre, organizacionId: organizacion.id },
        });
        return tx.usuario.create({
          data: {
            nombre: dto.nombre,
            email: dto.email.toLowerCase(),
            passwordHash,
            rol: dto.rol,
            organizacionId: organizacion.id,
            sucursalId: sucursal.id,
          },
        });
      });
      return this.session(user);
    } catch (error) {
      if (isUniqueError(error)) throw new ConflictException("Email or branch already exists");
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.usuario.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user || !(await verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }
    return this.session(user);
  }

  private session(user: {
    id: string;
    nombre: string;
    email: string;
    rol: "admin" | "caja" | "mozo" | "cocina";
    organizacionId: string;
    sucursalId: string;
  }) {
    return {
      accessToken: this.jwt.sign({
        sub: user.id,
        orgId: user.organizacionId,
        sucursalId: user.sucursalId,
        rol: user.rol,
      }),
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
        orgId: user.organizacionId,
        sucursalId: user.sucursalId,
      },
    };
  }
}
