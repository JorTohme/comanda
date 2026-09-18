import { ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtService, generateRefreshToken, hashPassword, hashRefreshToken, verifyPassword } from "./jwt.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

  async refresh(rawToken: string) {
    const tokenHash = hashRefreshToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!existing || existing.revokedAt || existing.expiresAt <= new Date()) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }
    const user = await this.prisma.usuario.findUnique({ where: { id: existing.usuarioId } });
    if (!user) throw new UnauthorizedException("Invalid or expired refresh token");
    await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    return this.session(user);
  }

  async logout(rawToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    // Unknown token -> silent no-op, same as revoking one: never leak whether it existed.
    if (existing && !existing.revokedAt) {
      await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    }
  }

  private async session(user: {
    id: string;
    nombre: string;
    email: string;
    rol: "admin" | "caja" | "mozo" | "cocina";
    organizacionId: string;
    sucursalId: string;
  }) {
    const refreshToken = generateRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        usuarioId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    return {
      accessToken: this.jwt.sign({
        sub: user.id,
        orgId: user.organizacionId,
        sucursalId: user.sucursalId,
        rol: user.rol,
      }),
      refreshToken,
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
