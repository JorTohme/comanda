import { Test } from "@nestjs/testing";
import { BadRequestException, NotFoundException, UnauthorizedException } from "@nestjs/common";
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
    usuario: { findUnique: jest.fn(), create: jest.fn() },
    refreshToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    sucursal: { findFirst: jest.fn() },
    invitation: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
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
    prisma.$transaction.mockImplementation(async (operation) => operation(prisma));

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
    const tokenRow = () => ({
      id: "rt-1",
      usuarioId: "user-1",
      tokenHash: "hash",
      sucursalId: "suc-2",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });

    it("rolls back token consumption when replacement creation fails", async () => {
      const row = tokenRow();
      let revoked = false;
      const tx = {
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue(row),
          updateMany: jest.fn().mockImplementation(async () => { revoked = true; return { count: 1 }; }),
          create: jest.fn().mockRejectedValue(new Error("insert failed")),
        },
        usuario: { findUnique: jest.fn().mockResolvedValue(user) },
        sucursal: { findFirst: jest.fn().mockResolvedValue({ id: row.sucursalId }) },
      };
      prisma.refreshToken.findUnique.mockResolvedValue(row);
      prisma.usuario.findUnique.mockResolvedValue(user);
      prisma.refreshToken.create.mockRejectedValue(new Error("insert failed"));
      prisma.$transaction.mockImplementationOnce(async (operation) => {
        try { return await operation(tx); } catch (error) { revoked = false; throw error; }
      });

      await expect(service.refresh("some-raw-token")).rejects.toThrow("insert failed");
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(revoked).toBe(false);
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(tx.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it("allows only one concurrent rotation and mints only one replacement", async () => {
      const row = tokenRow();
      let consumed = false;
      const tx = {
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue(row),
          updateMany: jest.fn().mockImplementation(async () => {
            if (consumed) return { count: 0 };
            consumed = true;
            return { count: 1 };
          }),
          create: jest.fn().mockResolvedValue({}),
        },
        usuario: { findUnique: jest.fn().mockResolvedValue(user) },
        sucursal: { findFirst: jest.fn().mockResolvedValue({ id: row.sucursalId }) },
      };
      prisma.refreshToken.findUnique.mockResolvedValue(row);
      prisma.usuario.findUnique.mockResolvedValue(user);
      prisma.$transaction.mockImplementation(async (operation) => operation(tx));

      const outcomes = await Promise.allSettled([
        service.refresh("same-token"), service.refresh("same-token"),
      ]);

      expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
      expect(tx.refreshToken.create).toHaveBeenCalledTimes(1);
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it("rejects a refresh bound to a branch outside the current organization", async () => {
      const row = tokenRow();
      const tx = {
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue(row),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn(),
        },
        usuario: { findUnique: jest.fn().mockResolvedValue(user) },
        sucursal: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      prisma.refreshToken.findUnique.mockResolvedValue(row);
      prisma.usuario.findUnique.mockResolvedValue(user);
      prisma.$transaction.mockImplementationOnce(async (operation) => operation(tx));

      await expect(service.refresh("some-raw-token")).rejects.toBeInstanceOf(UnauthorizedException);
      expect(tx.sucursal.findFirst).toHaveBeenCalledWith({
        where: { id: row.sucursalId, organizacionId: user.organizacionId },
      });
      expect(tx.refreshToken.create).not.toHaveBeenCalled();
    });

    it("checks expiry in the conditional consume, not only in the initial read", async () => {
      const row = tokenRow();
      const tx = {
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue(row),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn(),
        },
        usuario: { findUnique: jest.fn() },
        sucursal: { findFirst: jest.fn() },
      };
      prisma.refreshToken.findUnique.mockResolvedValue(row);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.$transaction.mockImplementationOnce(async (operation) => operation(tx));

      await expect(service.refresh("some-raw-token")).rejects.toBeInstanceOf(UnauthorizedException);
      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: row.id, revokedAt: null, expiresAt: { gt: expect.any(Date) } },
        data: { revokedAt: expect.any(Date) },
      });
    });

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
      prisma.sucursal.findFirst.mockResolvedValue({ id: row.sucursalId });

      const result = await service.refresh("some-raw-token");

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: row.id, revokedAt: null, expiresAt: { gt: expect.any(Date) } },
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
      prisma.sucursal.findFirst.mockResolvedValue({ id: row.sucursalId });

      const result = await service.refresh("some-raw-token");

      expect(prisma.sucursal.findFirst).toHaveBeenCalledWith({
        where: { id: row.sucursalId, organizacionId: user.organizacionId },
      });
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

  describe("invitations", () => {
    const caller = {
      sub: "admin-1",
      orgId: "org-1",
      sucursalId: "suc-1",
      rol: "admin" as const,
      iat: 1,
      exp: 2,
    };

    it("creates an employee invitation only in the caller organization", async () => {
      prisma.sucursal.findFirst.mockResolvedValue({ id: "suc-2" });
      prisma.invitation.create.mockResolvedValue({});

      const result = await service.createInvitation(caller, {
        email: "Cook@Example.com",
        sucursalId: "suc-2",
        rol: "cocina",
      });

      expect(prisma.invitation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: "cook@example.com",
          rol: "cocina",
          organizacionId: "org-1",
          sucursalId: "suc-2",
          createdById: "admin-1",
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      });
      expect(result.activationUrl).toContain("/invitacion?token=");
    });

    it("rejects a non-admin issuer even when the service is called directly", async () => {
      await expect(service.createInvitation({ ...caller, rol: "mozo" }, { email: "staff@example.com", sucursalId: "suc-1", rol: "caja" })).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.sucursal.findFirst).not.toHaveBeenCalled();
    });

    it("rejects an invitation to a branch outside the caller organization", async () => {
      prisma.sucursal.findFirst.mockResolvedValue(null);

      await expect(service.createInvitation(caller, { email: "staff@example.com", sucursalId: "other-org", rol: "mozo" })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.invitation.create).not.toHaveBeenCalled();
    });

    it("rejects admin invitations from the employee invitation API", async () => {
      await expect(service.createInvitation(caller, { email: "staff@example.com", sucursalId: "suc-1", rol: "admin" })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.sucursal.findFirst).not.toHaveBeenCalled();
    });

    it("accepts an invitation once and creates the fixed user identity", async () => {
      const invitation = {
        id: "invite-1",
        email: "cook@example.com",
        rol: "cocina" as const,
        organizacionId: "org-1",
        sucursalId: "suc-2",
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      };
      prisma.invitation.findUnique.mockResolvedValue(invitation);
      prisma.invitation.updateMany.mockResolvedValue({ count: 1 });
      prisma.usuario.create.mockResolvedValue({ ...user, ...invitation, id: "user-2", nombre: "María", passwordHash: "hash" });

      const result = await service.acceptInvitation({ token: "raw-token", nombre: "María", password: PASSWORD });

      expect(prisma.invitation.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: "invite-1", usedAt: null }),
        data: { usedAt: expect.any(Date) },
      });
      expect(prisma.usuario.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          nombre: "María",
          email: "cook@example.com",
          rol: "cocina",
          organizacionId: "org-1",
          sucursalId: "suc-2",
          passwordHash: expect.any(String),
        }),
      });
      expect(result.user).toMatchObject({ email: "cook@example.com", rol: "cocina", orgId: "org-1", sucursalId: "suc-2" });
    });

    it("returns the generic invalid-invitation error when a concurrent acceptance already consumed it", async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        id: "invite-1",
        email: "cook@example.com",
        rol: "cocina",
        organizacionId: "org-1",
        sucursalId: "suc-2",
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      });
      prisma.invitation.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.acceptInvitation({ token: "raw-token", nombre: "María", password: PASSWORD })).rejects.toThrow("Invalid invitation");
      expect(prisma.usuario.create).not.toHaveBeenCalled();
    });

    it("returns the same generic error for an unknown token", async () => {
      prisma.invitation.findUnique.mockResolvedValue(null);

      await expect(service.acceptInvitation({ token: "unknown-token", nombre: "María", password: PASSWORD })).rejects.toThrow("Invalid invitation");
      expect(prisma.usuario.create).not.toHaveBeenCalled();
    });
  });
});
