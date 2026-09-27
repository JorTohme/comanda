import { Test } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PagosService } from "./pagos.service";
import { TenantContext } from "../auth/jwt.service";
import { PrismaService } from "../prisma/prisma.service";
import { MercadoPagoClient } from "./mercadopago.client";
import { PedidosService } from "../pedidos/pedidos.service";

const ORIGINAL_PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

const TENANT: TenantContext = {
  orgId: "00000000-0000-0000-0000-000000000011",
  sucursalId: "00000000-0000-0000-0000-000000000012",
};

describe("PagosService", () => {
  let service: PagosService;
  const prisma = {
    pedido: { findFirst: jest.fn() },
    pago: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const mpClient = {
    crearPreferencia: jest.fn(),
    obtenerPago: jest.fn(),
  };
  const pedidosService = {
    updateEstado: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    process.env.PUBLIC_BASE_URL = "https://api.example.test";

    const moduleRef = await Test.createTestingModule({
      providers: [
        PagosService,
        { provide: PrismaService, useValue: prisma },
        { provide: MercadoPagoClient, useValue: mpClient },
        { provide: PedidosService, useValue: pedidosService },
      ],
    }).compile();

    service = moduleRef.get(PagosService);
  });

  afterAll(() => {
    if (ORIGINAL_PUBLIC_BASE_URL === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = ORIGINAL_PUBLIC_BASE_URL;
  });

  describe("crearPreferencia", () => {
    it("throws NotFoundException when the pedido does not exist for this tenant", async () => {
      prisma.pedido.findFirst.mockResolvedValue(null);

      await expect(service.crearPreferencia("pedido-1", TENANT)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.pago.findUnique).not.toHaveBeenCalled();
      expect(mpClient.crearPreferencia).not.toHaveBeenCalled();
    });

    it("reuses an existing pendiente Pago without calling Mercado Pago again", async () => {
      prisma.pedido.findFirst.mockResolvedValue({
        id: "pedido-1",
        items: [{ platoId: "plato-1", nombre: "Milanesa", precioUnitario: 1500, cantidad: 2 }],
      });
      prisma.pago.findUnique.mockResolvedValue({
        id: "pago-1",
        pedidoId: "pedido-1",
        estado: "pendiente",
        mpPreferenceId: "pref-existente",
        mpInitPoint: "https://mp.example/checkout/pref-existente",
      });

      const result = await service.crearPreferencia("pedido-1", TENANT);

      expect(result).toEqual({ initPoint: "https://mp.example/checkout/pref-existente", preferenceId: "pref-existente" });
      expect(mpClient.crearPreferencia).not.toHaveBeenCalled();
      expect(prisma.pago.create).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when a Pago already exists and is no longer pendiente", async () => {
      prisma.pedido.findFirst.mockResolvedValue({
        id: "pedido-1",
        items: [{ platoId: "plato-1", nombre: "Milanesa", precioUnitario: 1500, cantidad: 2 }],
      });
      prisma.pago.findUnique.mockResolvedValue({ id: "pago-1", pedidoId: "pedido-1", estado: "aprobado" });

      await expect(service.crearPreferencia("pedido-1", TENANT)).rejects.toBeInstanceOf(BadRequestException);
      expect(mpClient.crearPreferencia).not.toHaveBeenCalled();
    });

    it("rejects preference creation when PUBLIC_BASE_URL is missing", async () => {
      delete process.env.PUBLIC_BASE_URL;
      prisma.pedido.findFirst.mockResolvedValue({
        id: "pedido-1",
        items: [{ platoId: "plato-1", nombre: "Milanesa", precioUnitario: 1500, cantidad: 1 }],
      });
      prisma.pago.findUnique.mockResolvedValue(null);

      await expect(service.crearPreferencia("pedido-1", TENANT)).rejects.toBeInstanceOf(BadRequestException);
      expect(mpClient.crearPreferencia).not.toHaveBeenCalled();
    });
    it("creates a new preference and persists a pendiente Pago when none exists", async () => {
      prisma.pedido.findFirst.mockResolvedValue({
        id: "pedido-1",
        items: [
          { platoId: "plato-1", nombre: "Milanesa", precioUnitario: 1500, cantidad: 2 },
          { platoId: "plato-2", nombre: "Gaseosa", precioUnitario: 500, cantidad: 1 },
        ],
      });
      prisma.pago.findUnique.mockResolvedValue(null);
      mpClient.crearPreferencia.mockResolvedValue({ preferenceId: "pref-1", initPoint: "https://mp.example/checkout/pref-1" });
      prisma.pago.create.mockResolvedValue({ id: "pago-1" });

      const result = await service.crearPreferencia("pedido-1", TENANT);

      expect(mpClient.crearPreferencia).toHaveBeenCalledWith({
        pedidoId: "pedido-1",
        items: [
          { id: "plato-1", title: "Milanesa", quantity: 2, unitPrice: 15 },
          { id: "plato-2", title: "Gaseosa", quantity: 1, unitPrice: 5 },
        ],
        notificationUrl: expect.stringContaining("/pagos/webhook"),
      });
      expect(prisma.pago.create).toHaveBeenCalledWith({
        data: {
          pedidoId: "pedido-1",
          mpPreferenceId: "pref-1",
          mpInitPoint: "https://mp.example/checkout/pref-1",
          estado: "pendiente",
          monto: 3500,
          ...TENANT,
        },
      });
      expect(result).toEqual({ initPoint: "https://mp.example/checkout/pref-1", preferenceId: "pref-1" });
    });
  });

  describe("procesarWebhook", () => {
    it("no-ops when the fetched payment has no external_reference", async () => {
      mpClient.obtenerPago.mockResolvedValue({ id: "pay-1", status: "approved", externalReference: null, transactionAmount: 1000 });

      await service.procesarWebhook("pay-1");

      expect(prisma.pago.findUnique).not.toHaveBeenCalled();
      expect(prisma.pago.update).not.toHaveBeenCalled();
      expect(pedidosService.updateEstado).not.toHaveBeenCalled();
    });

    it("no-ops when no Pago matches the payment's external_reference", async () => {
      mpClient.obtenerPago.mockResolvedValue({ id: "pay-1", status: "approved", externalReference: "pedido-1", transactionAmount: 1000 });
      prisma.pago.findUnique.mockResolvedValue(null);

      await service.procesarWebhook("pay-1");

      expect(prisma.pago.update).not.toHaveBeenCalled();
      expect(pedidosService.updateEstado).not.toHaveBeenCalled();
    });

    it("dedupes: skips reprocessing when this exact payment was already processed", async () => {
      mpClient.obtenerPago.mockResolvedValue({ id: "pay-1", status: "approved", externalReference: "pedido-1", transactionAmount: 1000 });
      prisma.pago.findUnique.mockResolvedValue({
        id: "pago-1",
        pedidoId: "pedido-1",
        estado: "aprobado",
        mpPaymentId: "pay-1",
        orgId: TENANT.orgId,
        sucursalId: TENANT.sucursalId,
      });

      await service.procesarWebhook("pay-1");

      expect(prisma.pago.update).not.toHaveBeenCalled();
      expect(pedidosService.updateEstado).not.toHaveBeenCalled();
    });

    it("on approved, marks Pago aprobado and advances the Pedido to cobrado via PedidosService", async () => {
      mpClient.obtenerPago.mockResolvedValue({ id: "pay-1", status: "approved", externalReference: "pedido-1", transactionAmount: 1000 });
      prisma.pago.findUnique.mockResolvedValue({
        id: "pago-1",
        pedidoId: "pedido-1",
        estado: "pendiente",
        mpPaymentId: null,
        orgId: TENANT.orgId,
        sucursalId: TENANT.sucursalId,
      });
      pedidosService.updateEstado.mockResolvedValue({ id: "pedido-1", estado: "cobrado" });

      await service.procesarWebhook("pay-1");

      expect(prisma.pago.update).toHaveBeenCalledWith({
        where: { id: "pago-1" },
        data: { estado: "aprobado", mpPaymentId: "pay-1" },
      });
      expect(pedidosService.updateEstado).toHaveBeenCalledWith("pedido-1", "cobrado", {
        orgId: TENANT.orgId,
        sucursalId: TENANT.sucursalId,
      });
    });

    it("on approved, when the Pedido is not yet entregado, still records the Pago as aprobado without throwing", async () => {
      mpClient.obtenerPago.mockResolvedValue({ id: "pay-1", status: "approved", externalReference: "pedido-1", transactionAmount: 1000 });
      prisma.pago.findUnique.mockResolvedValue({
        id: "pago-1",
        pedidoId: "pedido-1",
        estado: "pendiente",
        mpPaymentId: null,
        orgId: TENANT.orgId,
        sucursalId: TENANT.sucursalId,
      });
      pedidosService.updateEstado.mockRejectedValue(new BadRequestException("Cannot transition Pedido from abierto to cobrado"));

      await expect(service.procesarWebhook("pay-1")).resolves.toBeUndefined();
      expect(prisma.pago.update).toHaveBeenCalledWith({
        where: { id: "pago-1" },
        data: { estado: "aprobado", mpPaymentId: "pay-1" },
      });
    });

    it("on approved, rethrows an unexpected error from PedidosService instead of swallowing it", async () => {
      mpClient.obtenerPago.mockResolvedValue({ id: "pay-1", status: "approved", externalReference: "pedido-1", transactionAmount: 1000 });
      prisma.pago.findUnique.mockResolvedValue({
        id: "pago-1",
        pedidoId: "pedido-1",
        estado: "pendiente",
        mpPaymentId: null,
        orgId: TENANT.orgId,
        sucursalId: TENANT.sucursalId,
      });
      pedidosService.updateEstado.mockRejectedValue(new Error("db exploded"));

      await expect(service.procesarWebhook("pay-1")).rejects.toThrow("db exploded");
    });

    it("on rejected, marks Pago rechazado and never touches PedidosService", async () => {
      mpClient.obtenerPago.mockResolvedValue({ id: "pay-1", status: "rejected", externalReference: "pedido-1", transactionAmount: 1000 });
      prisma.pago.findUnique.mockResolvedValue({
        id: "pago-1",
        pedidoId: "pedido-1",
        estado: "pendiente",
        mpPaymentId: null,
        orgId: TENANT.orgId,
        sucursalId: TENANT.sucursalId,
      });

      await service.procesarWebhook("pay-1");

      expect(prisma.pago.update).toHaveBeenCalledWith({
        where: { id: "pago-1" },
        data: { estado: "rechazado", mpPaymentId: "pay-1" },
      });
      expect(pedidosService.updateEstado).not.toHaveBeenCalled();
    });

    it("on a non-terminal status (pending), leaves the Pago untouched", async () => {
      mpClient.obtenerPago.mockResolvedValue({ id: "pay-1", status: "pending", externalReference: "pedido-1", transactionAmount: 1000 });
      prisma.pago.findUnique.mockResolvedValue({
        id: "pago-1",
        pedidoId: "pedido-1",
        estado: "pendiente",
        mpPaymentId: null,
        orgId: TENANT.orgId,
        sucursalId: TENANT.sucursalId,
      });

      await service.procesarWebhook("pay-1");

      expect(prisma.pago.update).not.toHaveBeenCalled();
      expect(pedidosService.updateEstado).not.toHaveBeenCalled();
    });
  });
});
