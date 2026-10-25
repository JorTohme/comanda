import { ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { PagosService } from "./pagos.service";
import type { JwtClaims, TenantContext } from "../auth/jwt.service";

const tenant: TenantContext = { orgId: "org", sucursalId: "branch" };
const admin: JwtClaims = { sub: "admin", ...tenant, rol: "admin", iat: 1, exp: 2 };

describe("PagosService authorization boundary", () => {
  const prisma = {} as never;
  const provider = {} as never;
  const cobros = {} as never;
  const realtime = {} as never;

  it("requires a caja/admin actor to create a preference before touching persistence", async () => {
    const service = new PagosService(prisma, provider, cobros, realtime);
    const actor = { ...admin, rol: "mozo" } as JwtClaims;
    await expect(service.crearPreferencia("pedido", tenant, actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("requires the configured merchant identity before fetching provider payment details", async () => {
    const previous = process.env.MERCADOPAGO_MERCHANT_ID;
    delete process.env.MERCADOPAGO_MERCHANT_ID;
    try {
      const service = new PagosService(prisma, provider, cobros, realtime);
      await expect(service.reconciliar("pago", "payment", tenant, admin)).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      if (previous === undefined) delete process.env.MERCADOPAGO_MERCHANT_ID;
      else process.env.MERCADOPAGO_MERCHANT_ID = previous;
    }
  });

  it("limits manual payment reconciliation to administrators", async () => {
    const service = new PagosService(prisma, provider, cobros, realtime);
    const actor = { ...admin, rol: "caja" } as JwtClaims;
    await expect(service.reconciliar("pago", "provider-payment", tenant, actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe("when Mercado Pago is not configured", () => {
    const previous = process.env.MERCADOPAGO_ACCESS_TOKEN;
    beforeEach(() => { delete process.env.MERCADOPAGO_ACCESS_TOKEN; });
    afterEach(() => {
      if (previous === undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN;
      else process.env.MERCADOPAGO_ACCESS_TOKEN = previous;
    });

    it("responds 503 for preference creation, webhook processing and reconciliation", async () => {
      const service = new PagosService(prisma, provider, cobros, realtime);
      const message = "Mercado Pago is not configured";
      await expect(service.crearPreferencia("pedido", tenant, admin)).rejects.toThrow(new ServiceUnavailableException(message));
      await expect(service.procesarWebhook("payment")).rejects.toThrow(new ServiceUnavailableException(message));
      await expect(service.reconciliar("pago", "payment", tenant, admin)).rejects.toThrow(new ServiceUnavailableException(message));
    });
  });
});
