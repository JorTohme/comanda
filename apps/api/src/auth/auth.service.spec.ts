import { Test } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { JwtService, hashPassword } from "./jwt.service";

const PASSWORD = "correct-horse-battery-staple";

describe("AuthService", () => {
  let service: AuthService;
  let user: {
    id: string;
    nombre: string;
    email: string;
    passwordHash: string;
    rol: "admin" | "caja" | "mozo" | "cocina";
    organizacionId: string;
    sucursalId: string;
  };
  const prisma = {
    usuario: { findUnique: jest.fn() },
    refreshToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    user = {
      id: "user-1",
      nombre: "Ana",
      email: "ana@test.com",
      passwordHash: await hashPassword(PASSWORD),
      rol: "admin",
      organizacionId: "org-1",
      sucursalId: "suc-1",
    };
    prisma.refreshToken.create.mockResolvedValue({});

    const moduleRef = await Test.createTestingModule({
      providers: [AuthService, JwtService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe("login", () => {
    it("issues a refresh token row and returns accessToken + refreshToken", async () => {
      prisma.usuario.findUnique.mockResolvedValue(user);

      const result = await service.login({ email: user.email, password: PASSWORD });

      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toEqual(expect.any(String));
      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ usuarioId: user.id, expiresAt: expect.any(Date) }),
      });
    });
  });

  describe("refresh", () => {
    it("rotates a valid refresh token: revokes the old row and mints a new pair", async () => {
      const row = {
        id: "rt-1",
        usuarioId: user.id,
        tokenHash: "hash",
        expiresAt: new Date(Date.now() + 1000),
        revokedAt: null,
      };
      prisma.refreshToken.findUnique.mockResolvedValue(row);
      prisma.usuario.findUnique.mockResolvedValue(user);
      prisma.refreshToken.update.mockResolvedValue({});

      const result = await service.refresh("some-raw-token");

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: row.id },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ usuarioId: user.id }),
      });
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toEqual(expect.any(String));
    });

    it("rejects a missing token", async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh("nope")).rejects.toThrow(UnauthorizedException);
    });

    it("rejects a revoked token", async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: "rt-1",
        usuarioId: user.id,
        expiresAt: new Date(Date.now() + 1000),
        revokedAt: new Date(),
      });

      await expect(service.refresh("nope")).rejects.toThrow(UnauthorizedException);
    });

    it("rejects an expired token", async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: "rt-1",
        usuarioId: user.id,
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
      });

      await expect(service.refresh("nope")).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("logout", () => {
    it("revokes an existing refresh token", async () => {
      const row = { id: "rt-1", revokedAt: null };
      prisma.refreshToken.findUnique.mockResolvedValue(row);
      prisma.refreshToken.update.mockResolvedValue({});

      await service.logout("some-raw-token");

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: row.id },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("no-ops silently on an unknown token", async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.logout("unknown-token")).resolves.toBeUndefined();
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });
  });
});
