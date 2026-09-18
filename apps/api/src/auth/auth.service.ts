import { ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
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

  async refresh(rawToken: string, sucursalIdHint?: string) {
    const tokenHash = hashRefreshToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!existing || existing.revokedAt || existing.expiresAt <= new Date()) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }
    const user = await this.prisma.usuario.findUnique({ where: { id: existing.usuarioId } });
    if (!user) throw new UnauthorizedException("Invalid or expired refresh token");
    await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    const sucursalId = await this.resolveSucursalId(user.organizacionId, user.sucursalId, sucursalIdHint);
    return this.session(user, sucursalId);
  }

  // Explicit admin action: an unknown/foreign sucursalId is a real error here, not a hint to
  // silently ignore.
  async switchSucursal(usuarioId: string, callerOrgId: string, targetSucursalId: string) {
    const target = await this.prisma.sucursal.findFirst({
      where: { id: targetSucursalId, organizacionId: callerOrgId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException(`Sucursal ${targetSucursalId} not found`);
    const user = await this.prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!user) throw new UnauthorizedException("Invalid user");
    return this.session(user, target.id);
  }

  // Best-effort hint resolution used by refresh(): never throws, falls back to the caller's
  // home sucursal when the candidate doesn't exist or belongs to another org.
  private async resolveSucursalId(
    homeOrgId: string,
    homeSucursalId: string,
    candidateSucursalId?: string,
  ): Promise<string> {
    if (!candidateSucursalId) return homeSucursalId;
    const candidate = await this.prisma.sucursal.findFirst({
      where: { id: candidateSucursalId, organizacionId: homeOrgId },
      select: { id: true },
    });
    return candidate ? candidate.id : homeSucursalId;
  }

  async logout(rawToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    // Unknown token -> silent no-op, same as revoking one: never leak whether it existed.
    if (existing && !existing.revokedAt) {
      await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    }
  }

  private async session(
    user: {
      id: string;
      nombre: string;
      email: string;
      rol: "admin" | "caja" | "mozo" | "cocina";
      organizacionId: string;
      sucursalId: string;
    },
    sucursalId: string = user.sucursalId,
  ) {
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
        sucursalId,
        rol: user.rol,
      }),
      refreshToken,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
        orgId: user.organizacionId,
        sucursalId,
      },
    };
  }
}
