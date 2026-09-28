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
});
