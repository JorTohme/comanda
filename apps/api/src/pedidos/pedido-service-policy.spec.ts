import { ForbiddenException, BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PedidosService } from "./pedidos.service";
import { PrismaService } from "../prisma/prisma.service";
import { MesasService } from "../salon/mesas/mesas.service";
import { CajaService } from "../caja/caja.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import type { JwtClaims } from "../auth/jwt.service";

const actor: JwtClaims = {
  sub: "user-1", orgId: "org-1", sucursalId: "branch-1", rol: "cocina", iat: 1, exp: 2,
};
const tenant = { orgId: actor.orgId, sucursalId: actor.sucursalId };

describe("pedido service actor boundary", () => {
  const prisma = { pedido: { findFirst: jest.fn(), update: jest.fn() }, pago: { findFirst: jest.fn() }, $transaction: jest.fn() };
  let service: PedidosService;

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.pedido.findFirst.mockResolvedValue({ id: "pedido-1", estado: "listo", tipoServicio: "barra", mesaId: null });
    service = (await Test.createTestingModule({ providers: [
      PedidosService,
      { provide: PrismaService, useValue: prisma },
      { provide: MesasService, useValue: {} },
      { provide: CajaService, useValue: {} },
      { provide: RealtimeGateway, useValue: {} },
    ] }).compile()).get(PedidosService);
  });

  it("rejects cocina delivery even when called without an HTTP guard", async () => {
    await expect(service.updateEstado("pedido-1", { estado: "entregado", expectedVersion: 0 }, tenant, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.pedido.update).not.toHaveBeenCalled();
  });

  it("rejects generic cash collection even for caja", async () => {
    prisma.pedido.findFirst.mockResolvedValue({ id: "pedido-1", estado: "entregado", tipoServicio: "barra" });
    await expect(service.updateEstado("pedido-1", { estado: "cobrado", expectedVersion: 0 }, tenant, { ...actor, rol: "caja" })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.pedido.update).not.toHaveBeenCalled();
  });
});
