import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  JwtClaims,
  JwtService,
  generateInvitationToken,
  generateRefreshToken,
  hashInvitationToken,
  hashPassword,
  hashRefreshToken,
  verifyPassword,
} from "./jwt.service";
import { LoginDto } from "./dto/login.dto";
import { CreateInvitationDto } from "./dto/create-invitation.dto";
import { AcceptInvitationDto } from "./dto/accept-invitation.dto";

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

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

    const consumed = await this.prisma.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (consumed.count !== 1) throw new UnauthorizedException("Invalid or expired refresh token");

    const user = await this.prisma.usuario.findUnique({ where: { id: existing.usuarioId } });
    if (!user) throw new UnauthorizedException("Invalid or expired refresh token");
    return this.session(user, existing.sucursalId);
  }

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

  async logout(rawToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (existing && !existing.revokedAt) {
      await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    }
  }

  async createInvitation(caller: JwtClaims, dto: CreateInvitationDto) {
    if (caller.rol !== "admin") throw new UnauthorizedException("Invalid invitation issuer");
    if (dto.rol === "admin") {
      throw new BadRequestException("Only employee roles may be invited");
    }

    const sucursal = await this.prisma.sucursal.findFirst({
      where: { id: dto.sucursalId, organizacionId: caller.orgId },
      select: { id: true },
    });
    if (!sucursal) throw new NotFoundException(`Sucursal ${dto.sucursalId} not found`);

    const token = generateInvitationToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    await this.prisma.invitation.create({
      data: {
        tokenHash: hashInvitationToken(token),
        email: dto.email.toLowerCase(),
        rol: dto.rol,
        organizacionId: caller.orgId,
        sucursalId: sucursal.id,
        expiresAt,
        createdById: caller.sub,
      },
    });

    return { activationUrl: this.activationUrl(token), expiresAt };
  }

  async acceptInvitation(dto: AcceptInvitationDto) {
    const tokenHash = hashInvitationToken(dto.token);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const invitation = await tx.invitation.findUnique({ where: { tokenHash } });
        if (!invitation || invitation.usedAt || invitation.expiresAt <= new Date()) throw this.invalidInvitation();

        const consumed = await tx.invitation.updateMany({
          where: { id: invitation.id, tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        if (consumed.count !== 1) throw this.invalidInvitation();

        const user = await tx.usuario.create({
          data: {
            nombre: dto.nombre,
            email: invitation.email,
            passwordHash: await hashPassword(dto.password),
            rol: invitation.rol,
            organizacionId: invitation.organizacionId,
            sucursalId: invitation.sucursalId,
          },
        });
        return this.session(user, invitation.sucursalId, tx);
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw this.invalidInvitation();
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
    db: Pick<PrismaService, "refreshToken"> = this.prisma,
  ) {
    const refreshToken = generateRefreshToken();
    await db.refreshToken.create({
      data: {
        usuarioId: user.id,
        sucursalId,
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

  private activationUrl(token: string): string {
    const url = new URL("/invitacion", process.env.WEB_APP_URL ?? "http://localhost:3000");
    url.searchParams.set("token", token);
    return url.toString();
  }

  private invalidInvitation(): UnauthorizedException {
    return new UnauthorizedException("Invalid invitation");
  }
}
