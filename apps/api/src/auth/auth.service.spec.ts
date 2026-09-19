import { Test } from "@nestjs/testing";
import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { JwtService, hashPassword } from "./jwt.service";

function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

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
    refreshToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    sucursal: { findFirst: jest.fn() },
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
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

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
        data: expect.objectContaining({ usuarioId: user.id, sucursalId: user.sucursalId, expiresAt: expect.any(Date) }),
      });
    });
  });

  describe("refresh", () => {
    it("rotates a valid refresh token: revokes the old row and mints a new pair", async () => {
      const row = {
        id: "rt-1",
        usuarioId: user.id,
        tokenHash: "hash",
        sucursalId: "suc-1",
        expiresAt: new Date(Date.now() + 1000),
        revokedAt: null,
      };
      prisma.refreshToken.findUnique.mockResolvedValue(row);
      prisma.usuario.findUnique.mockResolvedValue(user);

      const result = await service.refresh("some-raw-token");

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: row.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ usuarioId: user.id, sucursalId: row.sucursalId }),
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

    it("keeps the refresh token bound to its original sucursal", async () => {
      const row = {
        id: "rt-1",
        usuarioId: user.id,
        tokenHash: "hash",
        sucursalId: "suc-2",
        expiresAt: new Date(Date.now() + 1000),
        revokedAt: null,
      };
      prisma.refreshToken.findUnique.mockResolvedValue(row);
      prisma.usuario.findUnique.mockResolvedValue(user);

      const result = await service.refresh("some-raw-token");

      expect(prisma.sucursal.findFirst).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sucursalId: row.sucursalId }),
      });
      expect(decodePayload(result.accessToken)).toMatchObject({
        sub: user.id,
        orgId: user.organizacionId,
        sucursalId: "suc-2",
        rol: user.rol,
      });
    });

    it("rejects a token that a concurrent refresh already consumed", async () => {
      const row = {
        id: "rt-1",
        usuarioId: user.id,
        tokenHash: "hash",
        sucursalId: user.sucursalId,
        expiresAt: new Date(Date.now() + 1000),
        revokedAt: null,
      };
      prisma.refreshToken.findUnique.mockResolvedValue(row);
      prisma.usuario.findUnique.mockResolvedValue(user);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.refresh("some-raw-token")).rejects.toThrow(UnauthorizedException);

      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe("switchSucursal", () => {
    it("mints a token for the target sucursal, keeping the same orgId/rol/sub", async () => {
      prisma.sucursal.findFirst.mockResolvedValue({ id: "suc-2" });
      prisma.usuario.findUnique.mockResolvedValue(user);

      const result = await service.switchSucursal(user.id, user.organizacionId, "suc-2");

      expect(prisma.sucursal.findFirst).toHaveBeenCalledWith({
        where: { id: "suc-2", organizacionId: user.organizacionId },
        select: { id: true },
      });
      expect(decodePayload(result.accessToken)).toMatchObject({
        sub: user.id,
        orgId: user.organizacionId,
        sucursalId: "suc-2",
        rol: user.rol,
      });
      expect(result.refreshToken).toEqual(expect.any(String));
    });

    it("rejects a sucursal that belongs to another org, without leaking whether it exists", async () => {
      prisma.sucursal.findFirst.mockResolvedValue(null);

      await expect(service.switchSucursal(user.id, user.organizacionId, "suc-other-org")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
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
