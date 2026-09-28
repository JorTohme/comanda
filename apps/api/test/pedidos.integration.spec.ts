import { ConflictException } from "@nestjs/common";
import type { EstadoPedido } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { CajaService } from "../src/caja/caja.service";
import type { JwtClaims, TenantContext } from "../src/auth/jwt.service";
import { PedidosService, type CreatePedidoInput } from "../src/pedidos/pedidos.service";
import { MesasService } from "../src/salon/mesas/mesas.service";
import { moneyFixture } from "./money-fixture";

type CreateWithActor = (input: CreatePedidoInput, tenant: TenantContext, actor: JwtClaims) => Promise<any>;
type UpdateWithVersion = (
  id: string,
  input: { estado: EstadoPedido; expectedVersion: number },
  tenant: TenantContext,
  actor: JwtClaims,
) => Promise<any>;

function services(f: Awaited<ReturnType<typeof moneyFixture>>) {
  const realtime = { emitToSucursal: jest.fn() };
  return {
    realtime,
    pedidos: new PedidosService(
      f.prisma,
      new MesasService(f.prisma, realtime as never),
      new CajaService(f.prisma),
      realtime as never,
    ),
  };
}

function createAsActor(pedidos: PedidosService, input: CreatePedidoInput, tenant: TenantContext, actor: JwtClaims) {
  return (pedidos.create as unknown as CreateWithActor)(input, tenant, actor);
}

function updateWithVersion(
  pedidos: PedidosService,
  id: string,
  estado: EstadoPedido,
  expectedVersion: number,
  tenant: TenantContext,
  actor: JwtClaims,
) {
  return (pedidos.updateEstado as unknown as UpdateWithVersion)(id, { estado, expectedVersion }, tenant, actor);
}

function barraInput(clientRequestId = randomUUID()): CreatePedidoInput {
  return { tipoServicio: "barra", clientRequestId, items: [] };
}

describe("orders and fulfillment with PostgreSQL", () => {
  it("creates one order for 20 concurrent retries and conflicts when the same key changes payload", async () => {
    const f = await moneyFixture();
    try {
      const { pedidos } = services(f);
      const input = { ...barraInput(), items: [{ platoId: f.platoId, cantidad: 1 }] };
      const rows = await Promise.all(Array.from({ length: 20 }, () => createAsActor(pedidos, input, f.tenant, f.actor)));

      expect(new Set(rows.map((row) => row.id)).size).toBe(1);
      expect(rows[0].cobro).toBeNull();
      await expect(createAsActor(pedidos, { ...input, items: [{ platoId: f.platoId, cantidad: 2 }] }, f.tenant, f.actor))
        .rejects.toBeInstanceOf(ConflictException);
      expect(await f.prisma.pedido.count({ where: { ...f.tenant } })).toBe(1);
    } finally {
      await f.dispose();
    }
  });

  it("scopes the same idempotency key to a tenant and rejects a legacy key without a fingerprint", async () => {
    const f = await moneyFixture();
    const other = await moneyFixture();
    try {
      const a = services(f).pedidos;
      const b = services(other).pedidos;
      const key = randomUUID();
      const input = { ...barraInput(key), items: [{ platoId: f.platoId, cantidad: 1 }] };
      const first = await createAsActor(a, input, f.tenant, f.actor);
      const second = await createAsActor(b, {
        ...input, items: [{ platoId: other.platoId, cantidad: 1 }],
      }, other.tenant, other.actor);
      expect(second.id).not.toBe(first.id);

      const legacyKey = randomUUID();
      await f.prisma.pedido.create({
        data: {
          ...f.tenant, tipoServicio: "barra", clientRequestId: legacyKey, requestFingerprint: null,
          items: { create: { platoId: f.platoId, nombre: "Test dish", precioUnitario: 1000, cantidad: 1 } },
        },
      });
      await expect(createAsActor(a, {
        ...barraInput(legacyKey), items: [{ platoId: f.platoId, cantidad: 1 }],
      }, f.tenant, f.actor)).rejects.toBeInstanceOf(ConflictException);
    } finally {
      await other.dispose();
      await f.dispose();
    }
  });

  it("allows only one active order for a table under concurrent distinct keys", async () => {
    const f = await moneyFixture();
    try {
      const { pedidos } = services(f);
      const mesa = await f.prisma.mesa.create({
        data: { orgId: f.tenant.orgId, sucursalId: f.tenant.sucursalId, nombre: "1", capacidad: 4 },
      });
      const make = (key: string) => createAsActor(pedidos, {
        tipoServicio: "mesa", mesaId: mesa.id, clientRequestId: key,
        items: [{ platoId: f.platoId, cantidad: 1 }],
      }, f.tenant, f.actor);
      const outcomes = await Promise.allSettled([make(randomUUID()), make(randomUUID())]);

      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
      expect(await f.prisma.pedido.count({ where: { ...f.tenant, mesaId: mesa.id, estado: { not: "cerrado" } } })).toBe(1);
      expect((await f.prisma.mesa.findUniqueOrThrow({ where: { id: mesa.id } })).estado).toBe("pedido_en_curso");
    } finally {
      await f.dispose();
    }
  });

  it("rejects invalid quantities, empty orders, unavailable dishes, and blank delivery destinations", async () => {
    const f = await moneyFixture();
    try {
      const { pedidos } = services(f);
      for (const cantidad of [0, 1000]) {
        await expect(createAsActor(pedidos, {
          ...barraInput(), items: [{ platoId: f.platoId, cantidad }],
        }, f.tenant, f.actor)).rejects.toThrow();
      }
      await expect(createAsActor(pedidos, barraInput(), f.tenant, f.actor)).rejects.toThrow();
      await expect(createAsActor(pedidos, {
        ...barraInput(), items: Array.from({ length: 101 }, () => ({ platoId: f.platoId, cantidad: 1 })),
      }, f.tenant, f.actor)).rejects.toThrow();
      await expect(createAsActor(pedidos, {
        ...barraInput(), items: [{ platoId: f.platoId, cantidad: 999 }, { platoId: f.platoId, cantidad: 1 }],
      }, f.tenant, f.actor)).rejects.toThrow();
      await f.prisma.plato.update({ where: { id: f.platoId }, data: { precio: 2_147_483_647 } });
      await expect(createAsActor(pedidos, {
        ...barraInput(), items: [{ platoId: f.platoId, cantidad: 2 }],
      }, f.tenant, f.actor)).rejects.toThrow();
      await f.prisma.plato.update({ where: { id: f.platoId }, data: { precio: 1000 } });
      await f.prisma.plato.update({ where: { id: f.platoId }, data: { disponible: false } });
      await expect(createAsActor(pedidos, {
        ...barraInput(), items: [{ platoId: f.platoId, cantidad: 1 }],
      }, f.tenant, f.actor)).rejects.toThrow();
      await expect(createAsActor(pedidos, {
        tipoServicio: "delivery", plataforma: "  ", items: [{ platoId: f.platoId, cantidad: 1 }],
      }, f.tenant, f.actor)).rejects.toThrow();
    } finally {
      await f.dispose();
    }
  });

  it("enforces create actor role and tenant at the service boundary", async () => {
    const f = await moneyFixture();
    try {
      const { pedidos } = services(f);
      const input = { ...barraInput(), items: [{ platoId: f.platoId, cantidad: 1 }] };
      await expect(createAsActor(pedidos, input, f.tenant, { ...f.actor, rol: "cocina" }))
        .rejects.toThrow();
      await expect(createAsActor(pedidos, input, f.tenant, { ...f.actor, orgId: randomUUID() }))
        .rejects.toThrow();
      expect(await f.prisma.pedido.count({ where: f.tenant })).toBe(0);
    } finally {
      await f.dispose();
    }
  });

  it("uses expectedVersion as a branch-scoped compare-and-swap and requires receipt to close", async () => {
    const f = await moneyFixture();
    try {
      const { pedidos } = services(f);
      const order = await createAsActor(pedidos, {
        ...barraInput(), items: [{ platoId: f.platoId, cantidad: 1 }],
      }, f.tenant, f.actor);
      const outcomes = await Promise.allSettled([
        updateWithVersion(pedidos, order.id, "enviado_a_cocina", 0, f.tenant, f.actor),
        updateWithVersion(pedidos, order.id, "enviado_a_cocina", 0, f.tenant, f.actor),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
      expect((await f.prisma.pedido.findUniqueOrThrow({ where: { id: order.id } })).version).toBe(1);
      await expect(updateWithVersion(pedidos, order.id, "cerrado", 1, f.tenant, f.actor)).rejects.toThrow();
    } finally {
      await f.dispose();
    }
  });

  it("moves delivered orders to paid only with a live receipt and rejects browser cobrado", async () => {
    const f = await moneyFixture();
    try {
      const { pedidos } = services(f);
      const order = await f.prisma.pedido.create({
        data: { ...f.tenant, tipoServicio: "barra", estado: "listo" },
      });
      await f.prisma.cobro.create({
        data: {
          pedidoId: order.id, ...f.tenant, monto: 1000, metodo: "mercadopago",
          mpPaymentId: `live-${randomUUID()}`, cobradoEn: new Date(),
        },
      });
      const paid = await updateWithVersion(pedidos, order.id, "entregado", 0, f.tenant, f.actor);
      expect(paid.estado).toBe("cobrado");
      expect(paid.version).toBe(1);
      expect(paid.cobro).not.toBeNull();
      await expect(updateWithVersion(pedidos, order.id, "cobrado", 1, f.tenant, { ...f.actor, rol: "caja" }))
        .rejects.toThrow();
    } finally {
      await f.dispose();
    }
  });
});
