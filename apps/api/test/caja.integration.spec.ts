import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { Cobro, Pedido } from "@comanda/shared";
import type { JwtClaims, TenantContext } from "../src/auth/jwt.service";
import type { PrismaService } from "../src/prisma/prisma.service";
import { CajaService } from "../src/caja/caja.service";
import type { Prisma, Pago } from "@prisma/client";
import { lockSucursal } from "../src/prisma/branch-lock";
import { moneyFixture } from "./money-fixture";

describe("cash drawer snapshots with PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof moneyFixture>>;
  let caja: CajaService;
  const realtime = { emitToSucursal: jest.fn() };

  beforeEach(async () => {
    fixture = await moneyFixture();
    realtime.emitToSucursal.mockReset();
    caja = new CajaService(fixture.prisma, realtime as never);
  });

  afterEach(async () => fixture.dispose());

  it("allows only one open shift when two callers race", async () => {
    const results = await Promise.allSettled([
      caja.abrirTurno({ montoInicial: 1000 }, fixture.tenant, fixture.actor),
      caja.abrirTurno({ montoInicial: 1000 }, fixture.tenant, fixture.actor),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(ConflictException);
    await expect(fixture.prisma.turnoCaja.count({ where: { ...fixture.tenant, estado: "abierto" } })).resolves.toBe(1);
  });

  it("freezes only proven cash receipts, not delivered orders assigned to a legacy shift", async () => {
    const turno = await caja.abrirTurno({ montoInicial: 1000 }, fixture.tenant, fixture.actor);
    await fixture.prisma.pedido.create({
      data: {
        id: randomUUID(), tipoServicio: "barra", estado: "entregado", turnoCajaId: turno.id,
        ...fixture.tenant,
        items: { create: { id: randomUUID(), platoId: fixture.platoId, nombre: "Test dish", precioUnitario: 2000, cantidad: 1 } },
      },
    });

    const closed = await caja.cerrarTurno(turno.id, { montoDeclarado: 1000 }, fixture.tenant, fixture.actor);

    expect(closed).toMatchObject({ totalCalculado: 1000, totalDigital: 0, totalVentas: 0, semantica: "efectivo" });
  });

  it("returns the frozen snapshot for an identical close retry and conflicts on a changed declaration", async () => {
    const turno = await caja.abrirTurno({ montoInicial: 1000 }, fixture.tenant, fixture.actor);
    const first = await caja.cerrarTurno(turno.id, { montoDeclarado: 1000 }, fixture.tenant, fixture.actor);

    const retry = await caja.cerrarTurno(turno.id, { montoDeclarado: 1000 }, fixture.tenant, fixture.actor);
    await expect(caja.cerrarTurno(turno.id, { montoDeclarado: 900 }, fixture.tenant, fixture.actor))
      .rejects.toBeInstanceOf(ConflictException);

    expect(retry).toMatchObject({ id: first.id, totalCalculado: first.totalCalculado, diferencia: first.diferencia });
  });

  it("returns the existing cash Cobro on concurrent duplicate collection and after the shift closes", async () => {
    const turno = await caja.abrirTurno({ montoInicial: 1000 }, fixture.tenant, fixture.actor);
    const pedido = await deliveredOrder(fixture);
    const cobros = createCobrosService(fixture, caja);

    const collected = await Promise.all([
      cobros.cobrarEfectivo(pedido.id, fixture.tenant, fixture.actor),
      cobros.cobrarEfectivo(pedido.id, fixture.tenant, fixture.actor),
    ]);
    expect(collected[0].cobro?.id).toBe(collected[1].cobro?.id);
    expect(await fixture.prisma.cobro.count({ where: { pedidoId: pedido.id } })).toBe(1);

    await caja.cerrarTurno(turno.id, { montoDeclarado: 2000 }, fixture.tenant, fixture.actor);
    const replay = await cobros.cobrarEfectivo(pedido.id, fixture.tenant, fixture.actor);
    expect(replay.cobro?.id).toBe(collected[0].cobro?.id);
  });

  it("rejects cash collection when a digital receipt already exists", async () => {
    await caja.abrirTurno({ montoInicial: 1000 }, fixture.tenant, fixture.actor);
    const pedido = await deliveredOrder(fixture);
    const pago = await paymentFor(fixture, pedido.id, 1000);
    await postDigital(fixture, caja, pago);

    await expect(createCobrosService(fixture, caja).cobrarEfectivo(pedido.id, fixture.tenant, fixture.actor))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it("makes digital receipt replay idempotent only for the same provider payment", async () => {
    await caja.abrirTurno({ montoInicial: 0 }, fixture.tenant, fixture.actor);
    const pedido = await deliveredOrder(fixture);
    const pago = await paymentFor(fixture, pedido.id, 1000);
    const first = await postDigital(fixture, caja, pago);
    const replay = await postDigital(fixture, caja, pago);
    const otherPayment = await paymentFor(fixture, pedido.id, 1000);
    await expect(fixture.prisma.$transaction(async (tx) => {
      await lockSucursal(tx, fixture.tenant);
      return createCobrosService(fixture, caja).postDigital(tx, otherPayment, otherPayment.mpPaymentId!, new Date(), fixture.tenant);
    })).rejects.toBeInstanceOf(ConflictException);
    expect(replay.id).toBe(first.id);
  });

  it("counts digital receipts separately from the physical snapshot and sales total", async () => {
    const turno = await caja.abrirTurno({ montoInicial: 1000 }, fixture.tenant, fixture.actor);
    const pedido = await deliveredOrder(fixture);
    const pago = await paymentFor(fixture, pedido.id, 800);
    await postDigital(fixture, caja, pago);

    const open = await caja.obtenerActual(fixture.tenant);
    expect(open).toMatchObject({ totalCalculado: 1000, totalDigital: 800, totalVentas: 800 });
    const closed = await caja.cerrarTurno(turno.id, { montoDeclarado: 1000 }, fixture.tenant, fixture.actor);
    expect(closed).toMatchObject({ totalCalculado: 1000, totalDigital: 800, totalVentas: 800 });
  });

  it("posts a late digital receipt without assigning it to a closed shift or changing its snapshot", async () => {
    const turno = await caja.abrirTurno({ montoInicial: 1000 }, fixture.tenant, fixture.actor);
    const pedido = await deliveredOrder(fixture);
    const pago = await paymentFor(fixture, pedido.id, 800);
    const closed = await caja.cerrarTurno(turno.id, { montoDeclarado: 1000 }, fixture.tenant, fixture.actor);

    const receipt = await postDigital(fixture, caja, pago);
    const after = await caja.obtenerUno(turno.id, fixture.tenant);
    expect(receipt.turnoCajaId).toBeNull();
    expect(after.totalCalculado).toBe(closed.totalCalculado);
    expect(after.cobrosDigitalesSinTurno).toBe(1);
  });

  it("includes a cash receipt committed before close and rejects cash/movement after close", async () => {
    const turno = await caja.abrirTurno({ montoInicial: 1000 }, fixture.tenant, fixture.actor);
    const pedido = await deliveredOrder(fixture);
    await createCobrosService(fixture, caja).cobrarEfectivo(pedido.id, fixture.tenant, fixture.actor);
    const closed = await caja.cerrarTurno(turno.id, { montoDeclarado: 2000 }, fixture.tenant, fixture.actor);

    expect(closed).toMatchObject({ totalCalculado: 2000, totalDigital: 0, totalVentas: 1000 });
    await expect(createCobrosService(fixture, caja).cobrarEfectivo((await deliveredOrder(fixture)).id, fixture.tenant, fixture.actor))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(caja.registrarMovimiento(turno.id, { tipo: "ingreso", monto: 50, descripcion: "late" }, fixture.tenant, fixture.actor))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it.each(["cash-first", "close-first"] as const)("serializes %s at the Sucursal lock", async (order) => {
    const turno = await caja.abrirTurno({ montoInicial: 1000 }, fixture.tenant, fixture.actor);
    const pedido = await deliveredOrder(fixture);
    const cobros = createCobrosService(fixture, caja);
    const cash = () => cobros.cobrarEfectivo(pedido.id, fixture.tenant, fixture.actor);
    const close = () => caja.cerrarTurno(turno.id, { montoDeclarado: order === "cash-first" ? 2000 : 1000 }, fixture.tenant, fixture.actor);
    const [first, second] = order === "cash-first" ? [cash, close] : [close, cash];
    const results = await runOrderedBranchRace(fixture, first, second);

    expect(results[0].status).toBe("fulfilled");
    if (order === "cash-first") {
      expect(results[1].status).toBe("fulfilled");
      expect((results[1] as PromiseFulfilledResult<{ totalCalculado: number }>).value.totalCalculado).toBe(2000);
    } else {
      expect(results[1].status).toBe("rejected");
      expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
      expect(await fixture.prisma.cobro.count({ where: { pedidoId: pedido.id } })).toBe(0);
    }
  });

  it("reports tenant-wide unassigned digital receipts and per-shift legacy orders", async () => {
    const turno = await caja.abrirTurno({ montoInicial: 500 }, fixture.tenant, fixture.actor);
    const pedido = await deliveredOrder(fixture, turno.id);
    const pago = await paymentFor(fixture, pedido.id, 1000);
    await postDigital(fixture, caja, pago);
    const legacyOrder = await deliveredOrder(fixture, turno.id);
    await fixture.prisma.turnoCaja.update({ where: { id: turno.id }, data: { semantica: "legacy_mixta" } });

    const actual = await caja.obtenerActual(fixture.tenant);
    expect(actual).toMatchObject({ cobrosDigitalesSinTurno: 0, pedidosLegacySinCobro: 1, semantica: "legacy_mixta" });
    const [unassignedPedido] = await fixture.prisma.pedido.findMany({ where: { id: legacyOrder.id } });
    expect(unassignedPedido.turnoCajaId).toBe(turno.id);
  });

  it("preserves legacy closed totals and idempotently returns their historical snapshot", async () => {
    const turno = await caja.abrirTurno({ montoInicial: 500 }, fixture.tenant, fixture.actor);
    const legacy = await fixture.prisma.turnoCaja.update({
      where: { id: turno.id },
      data: { semantica: "legacy_mixta", estado: "cerrado", montoDeclarado: 1700, totalCalculado: 1600, totalDigital: null, totalVentas: null, diferencia: 100, cerradoPorId: fixture.actor.sub, cerradoEn: new Date() },
    });
    const returned = await caja.cerrarTurno(legacy.id, { montoDeclarado: 1700 }, fixture.tenant, fixture.actor);
    await expect(caja.cerrarTurno(legacy.id, { montoDeclarado: 1701 }, fixture.tenant, fixture.actor)).rejects.toBeInstanceOf(ConflictException);
    expect(returned).toMatchObject({ totalCalculado: 1600, diferencia: 100, semantica: "legacy_mixta" });
    expect(await fixture.prisma.turnoCaja.findUnique({ where: { id: legacy.id } })).toMatchObject({ totalCalculado: 1600, diferencia: 100 });
  });

  it("blocks new receipts, movements, and close on an open legacy mixed shift", async () => {
    const turno = await caja.abrirTurno({ montoInicial: 500 }, fixture.tenant, fixture.actor);
    await fixture.prisma.turnoCaja.update({ where: { id: turno.id }, data: { semantica: "legacy_mixta" } });
    const pedido = await deliveredOrder(fixture);
    await expect(createCobrosService(fixture, caja).cobrarEfectivo(pedido.id, fixture.tenant, fixture.actor)).rejects.toBeInstanceOf(ConflictException);
    await expect(caja.registrarMovimiento(turno.id, { tipo: "ingreso", monto: 50, descripcion: "blocked" }, fixture.tenant, fixture.actor)).rejects.toBeInstanceOf(ConflictException);
    await expect(caja.cerrarTurno(turno.id, { montoDeclarado: 500 }, fixture.tenant, fixture.actor)).rejects.toBeInstanceOf(ConflictException);
    expect(await fixture.prisma.cobro.count({ where: { pedidoId: pedido.id } })).toBe(0);
    expect(await fixture.prisma.turnoCaja.findUnique({ where: { id: turno.id } })).toMatchObject({ estado: "abierto", totalCalculado: null });
  });

  it("rejects cash mutations from actors without caja permission", async () => {
    const mozo = { ...fixture.actor, rol: "mozo" as const };
    await expect(caja.abrirTurno({ montoInicial: 0 }, fixture.tenant, mozo)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

async function deliveredOrder(
  fixture: Awaited<ReturnType<typeof moneyFixture>>,
  turnoCajaId?: string,
) {
  return fixture.prisma.pedido.create({
    data: {
      id: randomUUID(), tipoServicio: "barra", estado: "entregado", turnoCajaId,
      ...fixture.tenant,
      items: { create: {
        id: randomUUID(), platoId: fixture.platoId, nombre: "Test dish", precioUnitario: 1000, cantidad: 1,
      } },
    },
  });
}

async function paymentFor(
  fixture: Awaited<ReturnType<typeof moneyFixture>>,
  pedidoId: string,
  monto: number,
): Promise<Pago> {
  return fixture.prisma.pago.create({
    data: { pedidoId, monto, estado: "aprobado", mpPaymentId: `payment-${randomUUID()}`, externalReference: randomUUID(), ...fixture.tenant },
  });
}

async function postDigital(
  fixture: Awaited<ReturnType<typeof moneyFixture>>,
  caja: CajaService,
  pago: Pago,
): Promise<Cobro> {
  const cobros = createCobrosService(fixture, caja);
  return fixture.prisma.$transaction(async (tx) => {
    await lockSucursal(tx, fixture.tenant);
    return cobros.postDigital(tx, pago, pago.mpPaymentId!, new Date(), fixture.tenant);
  });
}

interface CobrosServiceContract {
  cobrarEfectivo(id: string, tenant: TenantContext, actor: JwtClaims): Promise<Pedido>;
  postDigital(tx: Prisma.TransactionClient, pago: Pago, paymentId: string, cobradoEn: Date, tenant: TenantContext): Promise<Cobro>;
}

function createCobrosService(
  fixture: Awaited<ReturnType<typeof moneyFixture>>,
  caja: CajaService,
): CobrosServiceContract {
  const { CobrosService } = require("../src/pedidos/cobros.service") as {
    CobrosService: new (prisma: PrismaService, caja: CajaService, realtime: { emitToSucursal: jest.Mock }) => CobrosServiceContract;
  };
  return new CobrosService(fixture.prisma, caja, { emitToSucursal: jest.fn() });
}

async function runOrderedBranchRace(
  fixture: Awaited<ReturnType<typeof moneyFixture>>,
  firstOperation: () => Promise<unknown>,
  secondOperation: () => Promise<unknown>,
): Promise<PromiseSettledResult<unknown>[]> {
  return lockQueueScenario(fixture, firstOperation, secondOperation);
}

async function lockQueueScenario(
  fixture: Awaited<ReturnType<typeof moneyFixture>>,
  firstOperation: () => Promise<unknown>,
  secondOperation: () => Promise<unknown>,
): Promise<PromiseSettledResult<unknown>[]> {
  let unlock!: () => void;
  let announceLock!: (pid: number) => void;
  const locked = new Promise<number>((resolve) => { announceLock = resolve; });
  const release = new Promise<void>((resolve) => { unlock = resolve; });
  const holder = fixture.prisma.$transaction(async (tx) => {
    const { lockSucursal } = await import("../src/prisma/branch-lock");
    await lockSucursal(tx, fixture.tenant);
    const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    announceLock(pid);
    await release;
  });
  const blockerPid = await locked;
  const waitUntilBlocked = async (count: number) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const [row] = await fixture.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> ${blockerPid}
          AND state = 'active' AND wait_event_type = 'Lock'
          AND cardinality(pg_blocking_pids(pid)) > 0
          AND query LIKE '%SELECT "id" FROM "Sucursal"%'
      `;
      if (row.count >= count) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`Expected ${count} transaction(s) waiting on branch lock ${blockerPid}`);
  };

  const operations: Promise<unknown>[] = [];
  try {
    const first = firstOperation();
    operations.push(first);
    await waitUntilBlocked(1);
    const second = secondOperation();
    operations.push(second);
    await waitUntilBlocked(2);
    unlock();
    return await Promise.allSettled(operations);
  } finally {
    unlock();
    await holder;
    await Promise.allSettled(operations);
  }
}
