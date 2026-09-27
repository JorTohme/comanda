import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { JwtService } from "./jwt.service";
import { RolesGuard } from "./roles.guard";
import { MesasController } from "../salon/mesas/mesas.controller";
import { MesasService } from "../salon/mesas/mesas.service";
import { PlatosController } from "../catalogo/platos/platos.controller";
import { PlatosService } from "../catalogo/platos/platos.service";
import { PedidosController } from "../pedidos/pedidos.controller";
import { PedidosService } from "../pedidos/pedidos.service";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

const orgId = "00000000-0000-4000-8000-000000000011";
const sucursalId = "00000000-0000-4000-8000-000000000012";
const userId = "00000000-0000-4000-8000-000000000013";
const mesaId = "00000000-0000-4000-8000-000000000014";
const platoId = "00000000-0000-4000-8000-000000000015";

describe("HTTP tenant and actor boundary", () => {
  let app: INestApplication;
  let origin: string;
  let jwt: JwtService;
  const prisma = {
    mesa: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    plato: { findFirst: jest.fn(), update: jest.fn() },
    categoria: { findFirst: jest.fn() },
    pedido: { findFirst: jest.fn() },
  };
  const auth = { createInvitation: jest.fn() };
  const pedidos = { updateEstado: jest.fn() };
  const realtime = { emitToSucursal: jest.fn() };

  beforeAll(async () => {
    process.env.JWT_SECRET = "tenant-http-regression-secret";
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, MesasController, PlatosController, PedidosController],
      providers: [
        JwtService,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: AuthService, useValue: auth },
        MesasService,
        PlatosService,
        { provide: PedidosService, useValue: pedidos },
        { provide: PrismaService, useValue: prisma },
        { provide: RealtimeGateway, useValue: realtime },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    origin = `http://127.0.0.1:${address.port}`;
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => { await app?.close(); });
  beforeEach(() => { jest.resetAllMocks(); });

  function headers(rol: "admin" | "caja" | "mozo" | "cocina") {
    return { Authorization: `Bearer ${jwt.sign({ sub: userId, rol, orgId, sucursalId })}` };
  }

  it("passes only orgId and sucursalId from signed claims to Prisma", async () => {
    prisma.mesa.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      if (Object.keys(where).sort().join(",") !== "orgId,sucursalId") throw new Error("Unsafe tenant filter");
      return [];
    });
    const response = await fetch(`${origin}/mesas`, { headers: headers("mozo") });
    expect(response.status).toBe(200);
    expect(prisma.mesa.findMany).toHaveBeenCalledWith({ where: { orgId, sucursalId } });
  });

  it("preserves the full signed actor for an admin invitation", async () => {
    auth.createInvitation.mockResolvedValue({ activationUrl: "https://example.test/invite", expiresAt: new Date() });
    const response = await fetch(`${origin}/auth/invitations`, {
      method: "POST",
      headers: { ...headers("admin"), "Content-Type": "application/json" },
      body: JSON.stringify({ email: "worker@example.test", rol: "mozo", sucursalId }),
    });
    expect(response.status).toBe(201);
    expect(auth.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ sub: userId, rol: "admin", orgId, sucursalId }),
      { email: "worker@example.test", rol: "mozo", sucursalId },
    );
  });

  it("forbids cocina from editing a dish price", async () => {
    prisma.plato.findFirst.mockResolvedValue({ id: platoId });
    prisma.plato.update.mockResolvedValue({ id: platoId, precio: 2000 });
    const response = await fetch(`${origin}/platos/${platoId}`, {
      method: "PATCH", headers: { ...headers("cocina"), "Content-Type": "application/json" },
      body: JSON.stringify({ precio: 2000 }),
    });
    expect(response.status).toBe(403);
    expect(prisma.plato.update).not.toHaveBeenCalled();
  });

  it("allows cocina to change availability but not price through the dedicated route", async () => {
    prisma.plato.findFirst.mockResolvedValue({ id: platoId });
    prisma.plato.update.mockResolvedValue({ id: platoId, disponible: false });
    const response = await fetch(`${origin}/platos/${platoId}/disponibilidad`, {
      method: "PATCH", headers: { ...headers("cocina"), "Content-Type": "application/json" },
      body: JSON.stringify({ disponible: false }),
    });
    expect(response.status).toBe(200);
    expect(prisma.plato.update).toHaveBeenCalledWith({ where: { id: platoId }, data: { disponible: false } });
  });

  it("rejects generic cobrado even for caja", async () => {
    pedidos.updateEstado.mockResolvedValue({ id: "pedido-1", estado: "cobrado" });
    const response = await fetch(`${origin}/pedidos/pedido-1/estado`, {
      method: "PATCH", headers: { ...headers("caja"), "Content-Type": "application/json" },
      body: JSON.stringify({ estado: "cobrado" }),
    });
    expect(response.status).toBe(400);
    expect(pedidos.updateEstado).not.toHaveBeenCalled();
  });

  it("forbids mozo from changing table configuration", async () => {
    prisma.mesa.findFirst.mockResolvedValue({ id: mesaId });
    prisma.mesa.update.mockResolvedValue({ id: mesaId, capacidad: 20 });
    const response = await fetch(`${origin}/mesas/${mesaId}`, {
      method: "PATCH", headers: { ...headers("mozo"), "Content-Type": "application/json" },
      body: JSON.stringify({ capacidad: 20 }),
    });
    expect(response.status).toBe(403);
    expect(prisma.mesa.update).not.toHaveBeenCalled();
  });
});
