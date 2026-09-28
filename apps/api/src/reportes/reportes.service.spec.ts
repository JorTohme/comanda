import { Test } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { ReportesService, toSafeInteger } from "./reportes.service";
import { TenantContext } from "../auth/jwt.service";
import { PrismaService } from "../prisma/prisma.service";

const TENANT: TenantContext = {
  orgId: "00000000-0000-0000-0000-000000000011",
  sucursalId: "00000000-0000-0000-0000-000000000012",
};

describe("ReportesService", () => {
  let service: ReportesService;
  const prisma = {
    $queryRaw: jest.fn(),
    sucursal: { findFirstOrThrow: jest.fn(), findMany: jest.fn() },
    pedido: { count: jest.fn() },
    cobro: { count: jest.fn() },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.sucursal.findFirstOrThrow.mockResolvedValue({ timezone: "America/Argentina/Buenos_Aires" });
    prisma.sucursal.findMany.mockResolvedValue([{ id: TENANT.sucursalId, nombre: "Test", timezone: "America/Argentina/Buenos_Aires" }]);
    prisma.pedido.count.mockResolvedValue(0);
    prisma.cobro.count.mockResolvedValue(0);
    const moduleRef = await Test.createTestingModule({
      providers: [ReportesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(ReportesService);
  });

  describe("obtenerReportes", () => {
    it("throws BadRequestException when desde is after hasta, without querying", async () => {
      await expect(
        service.obtenerReportes({ desde: "2024-02-10", hasta: "2024-02-01" }, TENANT),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it.each(["2026-02-30", "2026-09-27T00:00:00Z", "2026-9-7"])("rejects non-real or non-date-only input %s", async (date) => {
      await expect(service.obtenerReportes({ desde: date, hasta: date }, TENANT)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("rejects date windows longer than 366 days", async () => {
      await expect(service.obtenerReportes({ desde: "2025-01-01", hasta: "2026-01-02" }, TENANT)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("scopes raw queries to the tenant and uses branch-local SQL date boundaries", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.obtenerReportes({ desde: "2024-02-01", hasta: "2024-02-03" }, TENANT);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
      for (const [index, [sql]] of prisma.$queryRaw.mock.calls.entries()) {
        expect(sql.values).toContain(TENANT.orgId);
        expect(sql.values).toContain(TENANT.sucursalId);
        if (index < 3) expect(sql.sql).toMatch(/AT TIME ZONE/);
      }
    });

    it("shapes ventasPorDia rows into an ISO date string and a numeric total", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ fecha: new Date("2024-02-01T00:00:00.000Z"), total: 5000 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.obtenerReportes({ desde: "2024-02-01", hasta: "2024-02-01" }, TENANT);

      expect(result.ventasPorDia).toEqual([{ fecha: "2024-02-01", total: 5000 }]);
    });

    it("shapes platosMasPedidos rows with platoId, nombre and a numeric cantidad", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ platoId: "plato-1", nombre: "Milanesa", cantidad: 12 }])
        .mockResolvedValueOnce([]);

      const result = await service.obtenerReportes({ desde: "2024-02-01", hasta: "2024-02-01" }, TENANT);

      expect(result.platosMasPedidos).toEqual([{ platoId: "plato-1", nombre: "Milanesa", cantidad: 12 }]);
    });

    it("shapes horasPico rows with numeric hora and pedidos", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ hora: 13, pedidos: 7 }]);

      const result = await service.obtenerReportes({ desde: "2024-02-01", hasta: "2024-02-01" }, TENANT);

      expect(result.horasPico).toEqual([{ hora: 13, pedidos: 7 }]);
    });

    it("defensively coerces bigint/numeric-string raw values to plain numbers", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ fecha: new Date("2024-02-01T00:00:00.000Z"), total: 5000n }])
        .mockResolvedValueOnce([{ platoId: "plato-1", nombre: "Milanesa", cantidad: "12" }])
        .mockResolvedValueOnce([{ hora: 13, pedidos: 7n }]);

      const result = await service.obtenerReportes({ desde: "2024-02-01", hasta: "2024-02-01" }, TENANT);

      expect(result.ventasPorDia[0]).toEqual({ fecha: "2024-02-01", total: 5000 });
      expect(typeof result.ventasPorDia[0].total).toBe("number");
      expect(result.platosMasPedidos[0].cantidad).toBe(12);
      expect(typeof result.platosMasPedidos[0].cantidad).toBe("number");
      expect(result.horasPico[0].pedidos).toBe(7);
      expect(typeof result.horasPico[0].pedidos).toBe("number");
    });

    it("returns empty arrays for all three metrics when no pedidos match the range", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.obtenerReportes({ desde: "2024-02-01", hasta: "2024-02-28" }, TENANT);

      expect(result).toEqual({
        ventasPorDia: [], platosMasPedidos: [], horasPico: [],
        cobrosSinFecha: 0, pedidosLegadoSinCobro: 0, timezone: "America/Argentina/Buenos_Aires",
      });
    });

    it("counts unresolved legacy pedidos globally without assigning them to a report date", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ cobrosSinFecha: 0n, pedidosLegadoSinCobro: 3n }]);

      const result = await service.obtenerReportes({ desde: "2026-09-27", hasta: "2026-09-27" }, TENANT);
      const unresolvedQuery = prisma.$queryRaw.mock.calls.find(([sql]) => sql.sql.includes('"pedidosLegadoSinCobro"'))?.[0].sql;

      expect(result.pedidosLegadoSinCobro).toBe(3);
      expect(unresolvedQuery).not.toMatch(/p\."createdAt"/);
    });
  });

  describe("obtenerConsolidado", () => {
    it("throws BadRequestException when desde is after hasta, without querying", async () => {
      await expect(
        service.obtenerConsolidado({ desde: "2024-02-10", hasta: "2024-02-01" }, TENANT.orgId),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("scopes all three raw queries to orgId only (no sucursalId filter)", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.obtenerConsolidado({ desde: "2024-02-01", hasta: "2024-02-03" }, TENANT.orgId);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
      for (const [index, [sql]] of prisma.$queryRaw.mock.calls.entries()) {
        expect(sql.values).toContain(TENANT.orgId);
        if (index < 3) expect(sql.sql).toMatch(/AT TIME ZONE/);
      }
    });

    it("groups the breakdown by sucursal instead of mixing totals", async () => {
      const sucA = "00000000-0000-0000-0000-0000000000a1";
      const sucB = "00000000-0000-0000-0000-0000000000b2";
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { sucursalId: sucA, sucursalNombre: "Casa Matriz", fecha: new Date("2024-02-01T00:00:00.000Z"), total: 5000 },
          { sucursalId: sucB, sucursalNombre: "Sucursal Centro", fecha: new Date("2024-02-01T00:00:00.000Z"), total: 3000 },
        ])
        .mockResolvedValueOnce([
          { sucursalId: sucA, sucursalNombre: "Casa Matriz", platoId: "plato-1", nombre: "Milanesa", cantidad: 12 },
        ])
        .mockResolvedValueOnce([
          { sucursalId: sucB, sucursalNombre: "Sucursal Centro", hora: 13, pedidos: 4 },
        ]);
      prisma.sucursal.findMany.mockResolvedValue([
        { id: sucA, nombre: "Casa Matriz", timezone: "America/Argentina/Buenos_Aires" },
        { id: sucB, nombre: "Sucursal Centro", timezone: "America/Los_Angeles" },
      ]);

      const result = await service.obtenerConsolidado({ desde: "2024-02-01", hasta: "2024-02-01" }, TENANT.orgId);

      expect(result).toHaveLength(2);
      const casaMatriz = result.find((r) => r.sucursalId === sucA);
      const centro = result.find((r) => r.sucursalId === sucB);
      expect(casaMatriz).toMatchObject({
        sucursalNombre: "Casa Matriz",
        ventasPorDia: [{ fecha: "2024-02-01", total: 5000 }],
        platosMasPedidos: [{ platoId: "plato-1", nombre: "Milanesa", cantidad: 12 }],
        horasPico: [],
      });
      expect(centro).toMatchObject({
        sucursalNombre: "Sucursal Centro",
        ventasPorDia: [{ fecha: "2024-02-01", total: 3000 }],
        platosMasPedidos: [],
        horasPico: [{ hora: 13, pedidos: 4 }],
      });
    });

    it("returns branches with empty metrics when no pedidos match the range", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.obtenerConsolidado({ desde: "2024-02-01", hasta: "2024-02-28" }, TENANT.orgId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sucursalId: TENANT.sucursalId,
        timezone: "America/Argentina/Buenos_Aires",
        ventasPorDia: [], platosMasPedidos: [], horasPico: [],
        cobrosSinFecha: 0, pedidosLegadoSinCobro: 0,
      });
    });
  });

  describe("toSafeInteger", () => {
    it("preserves totals above int32 when still exactly representable", () => {
      expect(toSafeInteger("4000000000")).toBe(4_000_000_000);
      expect(toSafeInteger(4_000_000_000n)).toBe(4_000_000_000);
    });

    it.each(["9007199254740992", 9007199254740992n, Number.NaN, "not-a-number"])("rejects unsafe input %s", (value) => {
      expect(() => toSafeInteger(value as number | bigint | string)).toThrow(BadRequestException);
    });
  });
});
