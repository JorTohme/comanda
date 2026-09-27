import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { hashPassword, hashRefreshToken } from "../src/auth/jwt.service";
import type { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./test-app";

type SessionResponse = { accessToken: string; refreshToken: string; user: { sucursalId: string } };

describe("refresh rotation over HTTP with PostgreSQL and Redis", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let origin: string;
  let orgId: string;
  let branchId: string;
  let otherBranchId: string;
  let userId: string;
  let refreshToken: string;
  let accessToken: string;

  const post = (path: string, body: object, token?: string) => fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

  beforeAll(async () => {
    ({ app, prisma, close } = await createTestApp({
      crearPreferencia: async () => { throw new Error("External payments are disabled in integration tests"); },
      obtenerPago: async () => { throw new Error("External payments are disabled in integration tests"); },
    }));
    const address = app.getHttpServer().address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    orgId = randomUUID();
    branchId = randomUUID();
    otherBranchId = randomUUID();
    userId = randomUUID();
    const email = `refresh-${userId}@example.invalid`;
    const password = `integration-${randomUUID()}`;
    await prisma.organizacion.create({ data: { id: orgId, nombre: `Test ${orgId}` } });
    await prisma.sucursal.createMany({ data: [
      { id: branchId, organizacionId: orgId, nombre: "A" },
      { id: otherBranchId, organizacionId: orgId, nombre: "B" },
    ] });
    await prisma.usuario.create({ data: {
      id: userId, nombre: "Integration user", email,
      passwordHash: await hashPassword(password), rol: "mozo",
      organizacionId: orgId, sucursalId: branchId,
    } });
    const login = await post("/auth/login", { email, password });
    expect(login.status).toBe(201);
    ({ refreshToken, accessToken } = await login.json() as SessionResponse);
  });

  afterEach(async () => {
    if (!prisma || !userId) return;
    await prisma.refreshToken.deleteMany({ where: { usuarioId: userId } });
    await prisma.usuario.delete({ where: { id: userId } });
    await prisma.sucursal.deleteMany({ where: { organizacionId: orgId } });
    await prisma.organizacion.delete({ where: { id: orgId } });
  });

  afterAll(async () => { await close?.(); });

  it("allows exactly one winner when the same refresh token races", async () => {
    const responses = await Promise.all([1, 2].map(() => post("/auth/refresh", { refreshToken })));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 401]);
    expect(await prisma.refreshToken.count({ where: { usuarioId: userId, revokedAt: null } })).toBe(1);
  });

  it("rolls back consumption when replacement-token insertion fails", async () => {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION comanda_test_reject_refresh_insert() RETURNS trigger AS $body$
      BEGIN
        IF NEW."usuarioId" = '${userId}' THEN
          RAISE EXCEPTION 'injected replacement failure';
        END IF;
        RETURN NEW;
      END;
      $body$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER comanda_test_reject_refresh_insert
      BEFORE INSERT ON "RefreshToken"
      FOR EACH ROW EXECUTE FUNCTION comanda_test_reject_refresh_insert();
    `);
    try {
      const failed = await post("/auth/refresh", { refreshToken });
      expect(failed.status).toBe(500);
      const old = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(refreshToken) } });
      expect(old?.revokedAt).toBeNull();
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS comanda_test_reject_refresh_insert ON "RefreshToken"');
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS comanda_test_reject_refresh_insert()");
    }

    const retried = await post("/auth/refresh", { refreshToken });
    expect(retried.status).toBe(201);
  });

  it("keeps the refresh token bound to its original branch", async () => {
    await prisma.usuario.update({ where: { id: userId }, data: { sucursalId: otherBranchId } });
    const refreshed = await post("/auth/refresh", { refreshToken });
    expect(refreshed.status).toBe(201);
    expect(((await refreshed.json()) as SessionResponse).user.sucursalId).toBe(branchId);

    const denied = await post("/auth/switch-sucursal", { sucursalId: otherBranchId }, accessToken);
    expect(denied.status).toBe(403);
  });
});
