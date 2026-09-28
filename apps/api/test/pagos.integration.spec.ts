import { randomUUID } from "node:crypto";
import { ServiceUnavailableException, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHmac } from "node:crypto";
import { CajaService } from "../src/caja/caja.service";
import { CobrosService } from "../src/pedidos/cobros.service";
import type { JwtClaims } from "../src/auth/jwt.service";
import { PedidosService } from "../src/pedidos/pedidos.service";
import { MesasService } from "../src/salon/mesas/mesas.service";
import { PagosService } from "../src/pagos/pagos.service";
import { PagosController } from "../src/pagos/pagos.controller";
import { PrismaService } from "../src/prisma/prisma.service";
import type { MercadoPagoClient, PagoMercadoPago } from "../src/pagos/mercadopago.client";
import { moneyFixture } from "./money-fixture";

const oldMerchant = process.env.MERCADOPAGO_MERCHANT_ID;
const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
const oldWebhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
const MERCHANT = "merchant-expected";
const paymentId = "payment-123";

async function setup(initialState: "abierto" | "entregado" = "entregado") {
  process.env.MERCADOPAGO_MERCHANT_ID = MERCHANT;
  const f = await moneyFixture();
  const pedido = await f.prisma.pedido.create({
    data: { ...f.tenant, tipoServicio: "barra", estado: initialState, items: { create: [{ platoId: f.platoId, nombre: "Test dish", precioUnitario: 1000, cantidad: 1 }] } },
    include: { items: true },
  });
  const reference = randomUUID();
  const pago = await f.prisma.pago.create({
    data: { ...f.tenant, pedidoId: pedido.id, monto: 1000, externalReference: reference, merchantId: MERCHANT,
      mpPreferenceId: "preference-expected", mpInitPoint: "https://example.test/checkout" },
  });
  const valid: PagoMercadoPago = {
    id: paymentId, status: "approved", externalReference: reference, amountCents: 1000, currency: "ARS",
    merchantId: MERCHANT, preferenceId: pago.mpPreferenceId, approvedAt: new Date("2026-09-27T18:00:00.000Z"),
  };
  const provider = { obtenerPago: jest.fn().mockResolvedValue(valid), buscarPreferencias: jest.fn(), crearPreferencia: jest.fn() };
  const realtime = { emitToSucursal: jest.fn() };
  const caja = new CajaService(f.prisma);
  const pedidos = new PedidosService(f.prisma, new MesasService(f.prisma, realtime as never), caja, realtime as never);
  const pagos = new PagosService(f.prisma, provider as unknown as MercadoPagoClient,
    new CobrosService(f.prisma, caja, realtime as never), realtime as never);
  return { f, pedido, pago, valid, provider, realtime, pagos, caja, pedidos };
}

describe("payment identity reconciliation with PostgreSQL", () => {
  afterAll(() => {
    if (oldMerchant === undefined) delete process.env.MERCADOPAGO_MERCHANT_ID; else process.env.MERCADOPAGO_MERCHANT_ID = oldMerchant;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldWebhookSecret === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET; else process.env.MERCADOPAGO_WEBHOOK_SECRET = oldWebhookSecret;
  });

  it.each([
    ["payment id", { id: "other-payment" }, /payment id/i],
    ["amount", { amountCents: 1001 }, /amount/i],
    ["currency", { currency: "USD" }, /currency/i],
    ["external reference", { externalReference: "different-attempt" }, /external reference/i],
    ["preference", { preferenceId: "different-preference" }, /preference/i],
    ["merchant", { merchantId: "other-merchant" }, /merchant/i],
    ["approval date", { approvedAt: null }, /approval date/i],
  ] as const)("persists an incident for a mismatched provider %s without a receipt", async (_label, patch, reason) => {
    const ctx = await setup();
    try {
      ctx.provider.obtenerPago.mockResolvedValue({ ...ctx.valid, ...patch });
      await expect(ctx.pagos.reconciliar(ctx.pago.id, paymentId, ctx.f.tenant, ctx.f.actor)).resolves.toMatchObject({ estado: "incidente" });
      expect((await ctx.f.prisma.pago.findUniqueOrThrow({ where: { id: ctx.pago.id } })).incidente).toMatch(reason);
      expect(await ctx.f.prisma.cobro.count({ where: { pedidoId: ctx.pedido.id } })).toBe(0);
      expect((await ctx.f.prisma.pedido.findUniqueOrThrow({ where: { id: ctx.pedido.id } })).estado).toBe("entregado");
    } finally { await ctx.f.dispose(); }
  });

  it("posts one unassigned receipt, is idempotent, and only settles an order after delivery", async () => {
    const ctx = await setup("abierto");
    try {
      await ctx.pagos.procesarWebhook(paymentId);
      await ctx.pagos.procesarWebhook(paymentId);
      expect(await ctx.f.prisma.cobro.count({ where: { pedidoId: ctx.pedido.id } })).toBe(1);
      const receipt = await ctx.f.prisma.cobro.findUniqueOrThrow({ where: { pedidoId: ctx.pedido.id } });
      expect(receipt).toMatchObject({ monto: 1000, metodo: "mercadopago", turnoCajaId: null, cobradoEn: ctx.valid.approvedAt });
      expect((await ctx.f.prisma.pedido.findUniqueOrThrow({ where: { id: ctx.pedido.id } })).estado).toBe("abierto");

      for (const [version, estado] of ["enviado_a_cocina", "en_preparacion", "listo", "entregado"].entries()) {
        await ctx.pedidos.updateEstado(ctx.pedido.id, { estado: estado as "enviado_a_cocina" | "en_preparacion" | "listo" | "entregado", expectedVersion: version }, ctx.f.tenant, ctx.f.actor);
      }
      expect((await ctx.f.prisma.pedido.findUniqueOrThrow({ where: { id: ctx.pedido.id } })).estado).toBe("cobrado");
    } finally { await ctx.f.dispose(); }
  });

  it("repairs a previously approved payment with no Cobro", async () => {
    const ctx = await setup();
    try {
      await ctx.f.prisma.pago.update({ where: { id: ctx.pago.id }, data: { estado: "aprobado", mpPaymentId: paymentId } });
      await ctx.pagos.procesarWebhook(paymentId);
      expect(await ctx.f.prisma.cobro.count({ where: { pedidoId: ctx.pedido.id } })).toBe(1);
    } finally { await ctx.f.dispose(); }
  });

  it("does not downgrade approval for a late rejected notification", async () => {
    const ctx = await setup();
    try {
      await ctx.pagos.procesarWebhook(paymentId);
      ctx.provider.obtenerPago.mockResolvedValue({ ...ctx.valid, status: "rejected", approvedAt: null });
      await ctx.pagos.procesarWebhook(paymentId);
      expect((await ctx.f.prisma.pago.findUniqueOrThrow({ where: { id: ctx.pago.id } })).estado).toBe("aprobado");
      expect(await ctx.f.prisma.cobro.count({ where: { pedidoId: ctx.pedido.id } })).toBe(1);
    } finally { await ctx.f.dispose(); }
  });

  it("returns a retryable provider error rather than acknowledging a failed lookup", async () => {
    const ctx = await setup();
    try {
      ctx.provider.obtenerPago.mockRejectedValue(new Error("provider timeout"));
      await expect(ctx.pagos.procesarWebhook(paymentId)).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally { await ctx.f.dispose(); }
  });

  it("recovers a transient provider timeout on retry and records exactly one receipt", async () => {
    const ctx = await setup();
    try {
      ctx.provider.obtenerPago.mockRejectedValueOnce(new Error("provider timeout")).mockResolvedValueOnce(ctx.valid);
      await expect(ctx.pagos.procesarWebhook(paymentId)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(await ctx.f.prisma.cobro.count({ where: { pedidoId: ctx.pedido.id } })).toBe(0);
      await expect(ctx.pagos.procesarWebhook(paymentId)).resolves.toMatchObject({ estado: "aprobado" });
      expect(await ctx.f.prisma.cobro.count({ where: { pedidoId: ctx.pedido.id } })).toBe(1);
    } finally { await ctx.f.dispose(); }
  });

  it("returns HTTP 503 for a signed webhook whose provider lookup failed", async () => {
    process.env.MERCADOPAGO_MERCHANT_ID = MERCHANT;
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "integration-webhook-secret";
    const ctx = await setup();
    let app: INestApplication | undefined;
    try {
      ctx.provider.obtenerPago.mockRejectedValue(new Error("provider timeout"));
      const pagos = new PagosService(ctx.f.prisma, ctx.provider as unknown as MercadoPagoClient,
        new CobrosService(ctx.f.prisma, ctx.caja, ctx.realtime as never), ctx.realtime as never);
      const module = await Test.createTestingModule({
        controllers: [PagosController],
        providers: [{ provide: PagosService, useValue: pagos }],
      }).compile();
      const nestApp = module.createNestApplication({ logger: false });
      app = nestApp;
      await nestApp.listen(0, "127.0.0.1");
      const address = nestApp.getHttpServer().address() as { port: number };
      const timestamp = String(Date.now());
      const requestId = randomUUID();
      const manifest = `id:${paymentId};request-id:${requestId};ts:${timestamp};`;
      const signature = createHmac("sha256", process.env.MERCADOPAGO_WEBHOOK_SECRET).update(manifest).digest("hex");
      const response = await fetch(`http://127.0.0.1:${address.port}/pagos/webhook?type=payment&data.id=${paymentId}`, {
        method: "POST", headers: { "content-type": "application/json", "x-request-id": requestId, "x-signature": `ts=${timestamp},v1=${signature}` },
        body: JSON.stringify({ type: "payment", data: { id: paymentId } }),
      });
      expect(response.status).toBe(503);
    } finally {
      if (app) await app.close();
      await ctx.f.dispose();
    }
  });

  it("preserves an effective cash receipt when an approved provider payment collides", async () => {
    const ctx = await setup();
    try {
      await ctx.caja.abrirTurno({ montoInicial: 0 }, ctx.f.tenant, ctx.f.actor);
      const cobros = new CobrosService(ctx.f.prisma, ctx.caja, ctx.realtime as never);
      await cobros.cobrarEfectivo(ctx.pedido.id, ctx.f.tenant, ctx.f.actor);
      await ctx.pagos.procesarWebhook(paymentId);
      const receipt = await ctx.f.prisma.cobro.findUniqueOrThrow({ where: { pedidoId: ctx.pedido.id } });
      expect(receipt.metodo).toBe("efectivo");
      expect((await ctx.f.prisma.pago.findUniqueOrThrow({ where: { id: ctx.pago.id } })).estado).toBe("incidente");
    } finally { await ctx.f.dispose(); }
  });

  it("creates preferences using the attempt UUID as provider reference and persists the verified result", async () => {
    process.env.MERCADOPAGO_MERCHANT_ID = MERCHANT;
    process.env.PUBLIC_BASE_URL = "https://api.example.test";
    const f = await moneyFixture();
    try {
      const pedido = await f.prisma.pedido.create({ data: { ...f.tenant, tipoServicio: "barra", items: { create: [{ platoId: f.platoId, nombre: "Test dish", precioUnitario: 1000, cantidad: 1 }] } }, include: { items: true } });
      const realtime = { emitToSucursal: jest.fn() };
      const caja = new CajaService(f.prisma);
      const provider = {
        crearPreferencia: jest.fn(async (input: { externalReference: string }) => ({
          preferenceId: "pref-1", initPoint: "https://mp.example/checkout", externalReference: input.externalReference,
          merchantId: MERCHANT, monto: 1000, currency: "ARS",
        })),
        obtenerPago: jest.fn(), buscarPreferencias: jest.fn(),
      };
      const service = new PagosService(f.prisma, provider as unknown as MercadoPagoClient,
        new CobrosService(f.prisma, caja, realtime as never), realtime as never);
      const response = await service.crearPreferencia(pedido.id, f.tenant, f.actor);
      const attempt = await f.prisma.pago.findFirstOrThrow({ where: { pedidoId: pedido.id } });
      expect(attempt.externalReference).toBe(attempt.id);
      expect(provider.crearPreferencia).toHaveBeenCalledWith(expect.objectContaining({ externalReference: attempt.id }));
      expect(response).toEqual({ preferenceId: "pref-1", initPoint: "https://mp.example/checkout" });
      expect(attempt).toMatchObject({ estado: "pendiente", mpPreferenceId: "pref-1", mpInitPoint: "https://mp.example/checkout", leaseUntil: null });
    } finally { await f.dispose(); }
  });

  it.each([
    ["reference", (reference: string) => ({ preferenceId: "pref-1", initPoint: "https://mp.example/checkout", externalReference: `${reference}-wrong`, merchantId: MERCHANT, monto: 1000, currency: "ARS" })],
    ["merchant", (reference: string) => ({ preferenceId: "pref-1", initPoint: "https://mp.example/checkout", externalReference: reference, merchantId: "other", monto: 1000, currency: "ARS" })],
    ["amount", (reference: string) => ({ preferenceId: "pref-1", initPoint: "https://mp.example/checkout", externalReference: reference, merchantId: MERCHANT, monto: 1001, currency: "ARS" })],
    ["currency", (reference: string) => ({ preferenceId: "pref-1", initPoint: "https://mp.example/checkout", externalReference: reference, merchantId: MERCHANT, monto: 1000, currency: "USD" })],
    ["checkout URL", (reference: string) => ({ preferenceId: "pref-1", initPoint: "http://unsafe.example/checkout", externalReference: reference, merchantId: MERCHANT, monto: 1000, currency: "ARS" })],
  ] as const)("records a blocking incident for an unverified preference %s", async (_field, resultFor) => {
    process.env.MERCADOPAGO_MERCHANT_ID = MERCHANT;
    process.env.PUBLIC_BASE_URL = "https://api.example.test";
    const f = await moneyFixture();
    try {
      const pedido = await f.prisma.pedido.create({ data: { ...f.tenant, tipoServicio: "barra", items: { create: [{ platoId: f.platoId, nombre: "Test dish", precioUnitario: 1000, cantidad: 1 }] } } });
      const provider = { crearPreferencia: jest.fn(async (input: { externalReference: string }) => resultFor(input.externalReference)), obtenerPago: jest.fn(), buscarPreferencias: jest.fn() };
      const realtime = { emitToSucursal: jest.fn() };
      const caja = new CajaService(f.prisma);
      const service = new PagosService(f.prisma, provider as unknown as MercadoPagoClient,
        new CobrosService(f.prisma, caja, realtime as never), realtime as never);
      await expect(service.crearPreferencia(pedido.id, f.tenant, f.actor)).rejects.toMatchObject({ status: 409 });
      const attempt = await f.prisma.pago.findFirstOrThrow({ where: { pedidoId: pedido.id } });
      expect(attempt).toMatchObject({ estado: "incidente", leaseUntil: null });
      await expect(service.crearPreferencia(pedido.id, f.tenant, f.actor)).rejects.toMatchObject({ status: 409 });
      expect(provider.crearPreferencia).toHaveBeenCalledTimes(1);
    } finally { await f.dispose(); }
  });

  it("serializes competing checkout attempts with a lease while provider creation stays outside the transaction", async () => {
    process.env.MERCADOPAGO_MERCHANT_ID = MERCHANT;
    process.env.PUBLIC_BASE_URL = "https://api.example.test";
    const f = await moneyFixture();
    try {
      const pedido = await f.prisma.pedido.create({ data: { ...f.tenant, tipoServicio: "barra", items: { create: [{ platoId: f.platoId, nombre: "Test dish", precioUnitario: 1000, cantidad: 1 }] } } });
      let started!: () => void;
      let release!: () => void;
      const providerStarted = new Promise<void>((resolve) => { started = resolve; });
      const providerRelease = new Promise<void>((resolve) => { release = resolve; });
      const provider = {
        crearPreferencia: jest.fn(async (input: { externalReference: string }) => {
          started();
          await providerRelease;
          return { preferenceId: "pref-1", initPoint: "https://mp.example/checkout", externalReference: input.externalReference, merchantId: MERCHANT, monto: 1000, currency: "ARS" };
        }),
        obtenerPago: jest.fn(), buscarPreferencias: jest.fn(),
      };
      const realtime = { emitToSucursal: jest.fn() };
      const caja = new CajaService(f.prisma);
      const service = new PagosService(f.prisma, provider as unknown as MercadoPagoClient,
        new CobrosService(f.prisma, caja, realtime as never), realtime as never);
      const first = service.crearPreferencia(pedido.id, f.tenant, f.actor);
      await providerStarted;
      await expect(service.crearPreferencia(pedido.id, f.tenant, f.actor)).rejects.toMatchObject({ status: 409 });
      expect(provider.crearPreferencia).toHaveBeenCalledTimes(1);
      release();
      await expect(first).resolves.toMatchObject({ preferenceId: "pref-1" });
      expect((await f.prisma.pago.findMany({ where: { pedidoId: pedido.id } })).length).toBe(1);
    } finally { await f.dispose(); }
  });

  it("marks a definitive provider rejection terminal and permits a fresh attempt", async () => {
    process.env.MERCADOPAGO_MERCHANT_ID = MERCHANT;
    process.env.PUBLIC_BASE_URL = "https://api.example.test";
    const f = await moneyFixture();
    try {
      const pedido = await f.prisma.pedido.create({ data: { ...f.tenant, tipoServicio: "barra", items: { create: [{ platoId: f.platoId, nombre: "Test dish", precioUnitario: 1000, cantidad: 1 }] } } });
      const rejected = Object.assign(new Error("validation rejected"), { status: 400 });
      const provider = {
        crearPreferencia: jest.fn().mockRejectedValueOnce(rejected).mockImplementation(async (input: { externalReference: string }) => ({
          preferenceId: "pref-retry", initPoint: "https://mp.example/retry", externalReference: input.externalReference,
          merchantId: MERCHANT, monto: 1000, currency: "ARS",
        })), obtenerPago: jest.fn(), buscarPreferencias: jest.fn(),
      };
      const realtime = { emitToSucursal: jest.fn() };
      const caja = new CajaService(f.prisma);
      const service = new PagosService(f.prisma, provider as unknown as MercadoPagoClient,
        new CobrosService(f.prisma, caja, realtime as never), realtime as never);
      await expect(service.crearPreferencia(pedido.id, f.tenant, f.actor)).rejects.toMatchObject({ status: 400 });
      const oldAttempt = await f.prisma.pago.findFirstOrThrow({ where: { pedidoId: pedido.id } });
      expect(oldAttempt.estado).toBe("rechazado");
      await expect(service.crearPreferencia(pedido.id, f.tenant, f.actor)).resolves.toMatchObject({ preferenceId: "pref-retry" });
      const attempts = await f.prisma.pago.findMany({ where: { pedidoId: pedido.id } });
      expect(attempts).toHaveLength(2);
      expect(attempts.every((attempt) => attempt.externalReference === attempt.id)).toBe(true);
      expect(attempts.some((attempt) => attempt.estado === "pendiente")).toBe(true);
      expect(provider.crearPreferencia).toHaveBeenCalledTimes(2);
    } finally { await f.dispose(); }
  });

  it("does not create another preference after an expired reservation has no provider match", async () => {
    process.env.MERCADOPAGO_MERCHANT_ID = MERCHANT;
    process.env.PUBLIC_BASE_URL = "https://api.example.test";
    const f = await moneyFixture();
    try {
      const pedido = await f.prisma.pedido.create({ data: { ...f.tenant, tipoServicio: "barra", items: { create: [{ platoId: f.platoId, nombre: "Test dish", precioUnitario: 1000, cantidad: 1 }] } } });
      const attemptId = randomUUID();
      await f.prisma.pago.create({ data: { ...f.tenant, id: attemptId, pedidoId: pedido.id, externalReference: attemptId, monto: 1000,
        merchantId: MERCHANT, estado: "creando", leaseUntil: new Date(Date.now() - 1000) } });
      const realtime = { emitToSucursal: jest.fn() };
      const caja = new CajaService(f.prisma);
      const provider = { buscarPreferencias: jest.fn().mockResolvedValue([]), crearPreferencia: jest.fn(), obtenerPago: jest.fn() };
      const service = new PagosService(f.prisma, provider as unknown as MercadoPagoClient,
        new CobrosService(f.prisma, caja, realtime as never), realtime as never);
      await expect(service.crearPreferencia(pedido.id, f.tenant, f.actor)).rejects.toMatchObject({ status: 409 });
      expect(provider.buscarPreferencias).toHaveBeenCalledWith(attemptId);
      expect(provider.crearPreferencia).not.toHaveBeenCalled();
      expect((await f.prisma.pago.findUniqueOrThrow({ where: { id: attemptId } })).estado).toBe("incidente");
    } finally { await f.dispose(); }
  });

  it("recovers an expired preference reservation only from one fully verified provider match", async () => {
    process.env.MERCADOPAGO_MERCHANT_ID = MERCHANT;
    process.env.PUBLIC_BASE_URL = "https://api.example.test";
    const f = await moneyFixture();
    try {
      const pedido = await f.prisma.pedido.create({ data: { ...f.tenant, tipoServicio: "barra", items: { create: [{ platoId: f.platoId, nombre: "Test dish", precioUnitario: 1000, cantidad: 1 }] } } });
      const attemptId = randomUUID();
      await f.prisma.pago.create({ data: { ...f.tenant, id: attemptId, pedidoId: pedido.id, externalReference: attemptId, monto: 1000,
        merchantId: MERCHANT, estado: "creando", leaseUntil: new Date(Date.now() - 1000) } });
      const realtime = { emitToSucursal: jest.fn() };
      const caja = new CajaService(f.prisma);
      const provider = { buscarPreferencias: jest.fn().mockResolvedValue([{
        preferenceId: "recovered-pref", initPoint: "https://mp.example/recovered", externalReference: attemptId,
        merchantId: MERCHANT, monto: 1000, currency: "ARS",
      }]), crearPreferencia: jest.fn(), obtenerPago: jest.fn() };
      const service = new PagosService(f.prisma, provider as unknown as MercadoPagoClient,
        new CobrosService(f.prisma, caja, realtime as never), realtime as never);
      await expect(service.crearPreferencia(pedido.id, f.tenant, f.actor)).resolves.toEqual({ preferenceId: "recovered-pref", initPoint: "https://mp.example/recovered" });
      expect(provider.crearPreferencia).not.toHaveBeenCalled();
      expect(await f.prisma.pago.findMany({ where: { pedidoId: pedido.id } })).toHaveLength(1);
      expect(await f.prisma.pago.findUniqueOrThrow({ where: { id: attemptId } })).toMatchObject({ estado: "pendiente", mpPreferenceId: "recovered-pref" });
    } finally { await f.dispose(); }
  });
});
