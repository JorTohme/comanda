import { Prisma } from "@prisma/client";
import { ReportesService, toSafeInteger } from "../src/reportes/reportes.service";
import { moneyFixture } from "./money-fixture";

describe("ReportesService PostgreSQL timezone semantics", () => {
  let fixture: Awaited<ReturnType<typeof moneyFixture>>;
  let reports: ReportesService;

  async function createPedido(options: {
    createdAt: string;
    cobradoEn?: string | null;
    monto?: number;
    estado?: "cobrado" | "cerrado";
    cantidad?: number;
  }) {
    const pedido = await fixture.prisma.pedido.create({
      data: {
        tipoServicio: "mesa",
        estado: options.estado ?? "cobrado",
        orgId: fixture.tenant.orgId,
        sucursalId: fixture.tenant.sucursalId,
        createdAt: new Date(options.createdAt),
        items: {
          create: [{ platoId: fixture.platoId, nombre: "Fixture", precioUnitario: options.monto ?? 1000, cantidad: options.cantidad ?? 1 }],
        },
      },
    });
    if (options.cobradoEn !== undefined) {
      await fixture.prisma.cobro.create({
        data: {
          pedidoId: pedido.id,
          orgId: fixture.tenant.orgId,
          sucursalId: fixture.tenant.sucursalId,
          monto: options.monto ?? 1000,
          metodo: "efectivo",
          cobradoEn: options.cobradoEn === null ? null : new Date(options.cobradoEn),
        },
      });
    }
    return pedido;
  }

  beforeAll(async () => {
    fixture = await moneyFixture();
    reports = new ReportesService(fixture.prisma);
  });

  beforeEach(async () => {
    await fixture.prisma.cobro.deleteMany({ where: { orgId: fixture.tenant.orgId } });
    await fixture.prisma.pedido.deleteMany({ where: { orgId: fixture.tenant.orgId } });
    await fixture.prisma.sucursal.update({
      where: { id: fixture.tenant.sucursalId },
      data: { timezone: "America/Argentina/Buenos_Aires" },
    });
  });

  afterAll(async () => fixture?.dispose());

  it("groups receipt dates in the branch timezone, not the order-created day", async () => {
    await createPedido({ createdAt: "2026-09-26T23:00:00.000Z", cobradoEn: "2026-09-27T03:01:00.000Z" });

    const buenosAires = await reports.obtenerReportes({ desde: "2026-09-27", hasta: "2026-09-27" }, fixture.tenant);
    expect(buenosAires.ventasPorDia).toEqual([{ fecha: "2026-09-27", total: 1000 }]);
    expect(buenosAires.timezone).toBe("America/Argentina/Buenos_Aires");

    await fixture.prisma.sucursal.update({ where: { id: fixture.tenant.sucursalId }, data: { timezone: "America/Los_Angeles" } });
    const losAngeles = await reports.obtenerReportes({ desde: "2026-09-26", hasta: "2026-09-26" }, fixture.tenant);
    expect(losAngeles.ventasPorDia).toEqual([{ fecha: "2026-09-26", total: 1000 }]);
    expect(losAngeles.horasPico).toEqual([{ hora: 16, pedidos: 1 }]);
  });

  it("sums receipts above int32 without multiplying sales by item count", async () => {
    await createPedido({ createdAt: "2026-09-27T14:00:00.000Z", cobradoEn: "2026-09-27T14:01:00.000Z", monto: 2_000_000_000, cantidad: 2 });
    await createPedido({ createdAt: "2026-09-27T15:00:00.000Z", cobradoEn: "2026-09-27T15:01:00.000Z", monto: 2_000_000_000, cantidad: 3 });

    const result = await reports.obtenerReportes({ desde: "2026-09-27", hasta: "2026-09-27" }, fixture.tenant);
    expect(result.ventasPorDia).toEqual([{ fecha: "2026-09-27", total: 4_000_000_000 }]);
    expect(result.platosMasPedidos).toEqual([{ platoId: fixture.platoId, nombre: "Fixture", cantidad: 5 }]);
  });

  it("excludes unknown collection dates and reports unknown legacy orders separately", async () => {
    await createPedido({ createdAt: "2020-01-01T14:00:00.000Z", cobradoEn: null, monto: 5000 });
    await createPedido({ createdAt: "2026-09-27T15:00:00.000Z" });

    const result = await reports.obtenerReportes({ desde: "2026-09-27", hasta: "2026-09-27" }, fixture.tenant);
    expect(result.ventasPorDia).toEqual([]);
    expect(result.platosMasPedidos).toEqual([]);
    expect(result.cobrosSinFecha).toBe(1);
    expect(result.pedidosLegadoSinCobro).toBe(1);
  });

  it("returns zero-data branches in consolidated output and applies 23-hour DST days", async () => {
    const emptyBranch = await fixture.prisma.sucursal.create({
      data: { nombre: "No activity", organizacionId: fixture.tenant.orgId, timezone: "America/Los_Angeles" },
    });
    const result = await reports.obtenerConsolidado({ desde: "2026-09-27", hasta: "2026-09-27" }, fixture.tenant.orgId);
    expect(result).toHaveLength(2);
    expect(result.find((branch) => branch.sucursalId === emptyBranch.id)).toMatchObject({
      timezone: "America/Los_Angeles", ventasPorDia: [], platosMasPedidos: [], horasPico: [],
    });

    const rows = await fixture.prisma.$queryRaw<Array<{ hours: number }>>(Prisma.sql`
      SELECT EXTRACT(EPOCH FROM (((DATE '2026-03-08' + 1)::timestamp AT TIME ZONE 'America/New_York')
        - (DATE '2026-03-08'::timestamp AT TIME ZONE 'America/New_York'))) / 3600 AS hours
    `);
    expect(Number(rows[0].hours)).toBe(23);
    expect(() => toSafeInteger("9007199254740992")).toThrow();
  });
});
