import { Test } from "@nestjs/testing";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { CajaService } from "./caja.service";
import { TenantContext } from "../auth/jwt.service";
import { PrismaService } from "../prisma/prisma.service";
import type { JwtClaims } from "../auth/jwt.service";

const TENANT: TenantContext = {
  orgId: "00000000-0000-0000-0000-000000000011",
  sucursalId: "00000000-0000-0000-0000-000000000012",
};
const ACTOR: JwtClaims = { ...TENANT, sub: "00000000-0000-0000-0000-000000000013", rol: "admin", iat: 1, exp: 2 };

describe("CajaService", () => {
  let service: CajaService;
  const prisma = {
    turnoCaja: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    movimientoCaja: {
      create: jest.fn(),
    },
    cobro: { count: jest.fn().mockResolvedValue(0) },
    pedido: { count: jest.fn().mockResolvedValue(0) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: TENANT.sucursalId }]),
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.cobro.count.mockResolvedValue(0);
    prisma.pedido.count.mockResolvedValue(0);
    prisma.$queryRaw.mockResolvedValue([{ id: TENANT.sucursalId }]);
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    const moduleRef = await Test.createTestingModule({
      providers: [CajaService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(CajaService);
  });

  describe("abrirTurno", () => {
    it("creates a turno scoped to the tenant with abiertoPorId from usuarioId", async () => {
      prisma.turnoCaja.findFirst.mockResolvedValue(null);
      const created = { id: "turno-1", montoInicial: 10000, abiertoPorId: "usuario-1", estado: "abierto", ...TENANT };
      prisma.turnoCaja.create.mockResolvedValue(created);

      const result = await service.abrirTurno({ montoInicial: 10000 }, TENANT, ACTOR);

      expect(prisma.turnoCaja.findFirst).toHaveBeenCalledWith({ where: { ...TENANT, estado: "abierto" } });
      expect(prisma.turnoCaja.create).toHaveBeenCalledWith({
        data: { montoInicial: 10000, abiertoPorId: ACTOR.sub, semantica: "efectivo", ...TENANT },
      });
      expect(result).toEqual(created);
    });

    it("throws ConflictException when an open turno already exists for the tenant", async () => {
      prisma.turnoCaja.findFirst.mockResolvedValue({ id: "turno-existing", estado: "abierto" });

      await expect(service.abrirTurno({ montoInicial: 5000 }, TENANT, ACTOR)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.turnoCaja.create).not.toHaveBeenCalled();
    });
  });

  describe("registrarMovimiento", () => {
    it("creates a MovimientoCaja row scoped to the turno", async () => {
      prisma.turnoCaja.findFirst.mockResolvedValue({ id: "turno-1", estado: "abierto", ...TENANT });
      const created = { id: "mov-1", turnoCajaId: "turno-1", tipo: "ingreso", monto: 500, descripcion: "propina" };
      prisma.movimientoCaja.create.mockResolvedValue(created);

      const result = await service.registrarMovimiento(
        "turno-1",
        { tipo: "ingreso", monto: 500, descripcion: "propina" },
        TENANT,
        ACTOR,
      );

      expect(prisma.turnoCaja.findFirst).toHaveBeenCalledWith({ where: { id: "turno-1", ...TENANT } });
      expect(prisma.movimientoCaja.create).toHaveBeenCalledWith({
        data: { turnoCajaId: "turno-1", tipo: "ingreso", monto: 500, descripcion: "propina" },
      });
      expect(result).toEqual(created);
    });

    it("throws NotFoundException when the turno isn't owned by the tenant", async () => {
      prisma.turnoCaja.findFirst.mockResolvedValue(null);

      await expect(
        service.registrarMovimiento("missing-turno", { tipo: "ingreso", monto: 100, descripcion: "x" }, TENANT, ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.movimientoCaja.create).not.toHaveBeenCalled();
    });

    it("throws ConflictException when the turno is already cerrado", async () => {
      prisma.turnoCaja.findFirst.mockResolvedValue({ id: "turno-1", estado: "cerrado", ...TENANT });

      await expect(
        service.registrarMovimiento("turno-1", { tipo: "egreso", monto: 100, descripcion: "x" }, TENANT, ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.movimientoCaja.create).not.toHaveBeenCalled();
    });
  });

  describe("cerrarTurno", () => {
    const turnoConDatos = {
      id: "turno-1",
      montoInicial: 10000,
      semantica: "efectivo",
      movimientos: [
        { tipo: "ingreso", monto: 200 },
        { tipo: "egreso", monto: 150 },
      ],
      cobros: [{ metodo: "efectivo", monto: 3400 }, { metodo: "mercadopago", monto: 300 }],
    };
    // Drawer: 10000 + cash receipts 3400 + net movements 50 = 13450.

    beforeEach(() => {
      prisma.turnoCaja.findFirst.mockResolvedValue({ ...turnoConDatos, estado: "abierto", ...TENANT });
      prisma.turnoCaja.update.mockImplementation(({ data }) => Promise.resolve({ id: "turno-1", ...data }));
    });

    it("computes totalCalculado from pedidos items and movimientos", async () => {
      const result = await service.cerrarTurno("turno-1", { montoDeclarado: 13450 }, TENANT, ACTOR);

      expect(result.totalCalculado).toBe(13450);
    });

    it("computes a positive diferencia when montoDeclarado exceeds totalCalculado", async () => {
      const result = await service.cerrarTurno("turno-1", { montoDeclarado: 13500 }, TENANT, ACTOR);

      expect(result.diferencia).toBe(50);
    });

    it("computes a negative diferencia when montoDeclarado is under totalCalculado", async () => {
      const result = await service.cerrarTurno("turno-1", { montoDeclarado: 13400 }, TENANT, ACTOR);

      expect(result.diferencia).toBe(-50);
    });

    it("computes a zero diferencia when montoDeclarado matches totalCalculado exactly", async () => {
      const result = await service.cerrarTurno("turno-1", { montoDeclarado: 13450 }, TENANT, ACTOR);

      expect(result.diferencia).toBe(0);
    });

    it("persists estado=cerrado, cerradoPorId and cerradoEn", async () => {
      await service.cerrarTurno("turno-1", { montoDeclarado: 13450 }, TENANT, ACTOR);

      expect(prisma.turnoCaja.update).toHaveBeenCalledWith({
        where: { id: "turno-1", ...TENANT },
        data: expect.objectContaining({
          estado: "cerrado",
          cerradoPorId: ACTOR.sub,
          cerradoEn: expect.any(Date),
          montoDeclarado: 13450,
          totalCalculado: 13450,
          diferencia: 0,
        }),
      });
    });

    it("returns an identical frozen close and conflicts on a changed declaration", async () => {
      prisma.turnoCaja.findFirst.mockResolvedValue({ ...turnoConDatos, estado: "cerrado", montoDeclarado: 100, totalCalculado: 150, diferencia: -50, ...TENANT });

      await expect(service.cerrarTurno("turno-1", { montoDeclarado: 100 }, TENANT, ACTOR)).resolves.toMatchObject({ totalCalculado: 150 });
      await expect(service.cerrarTurno("turno-1", { montoDeclarado: 101 }, TENANT, ACTOR)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.turnoCaja.update).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when the turno isn't owned by the tenant", async () => {
      prisma.turnoCaja.findFirst.mockResolvedValue(null);

      await expect(
        service.cerrarTurno("missing-turno", { montoDeclarado: 100 }, TENANT, ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.turnoCaja.update).not.toHaveBeenCalled();
    });
  });

  describe("obtenerActual", () => {
    it("returns null when no turno is open for the tenant", async () => {
      prisma.turnoCaja.findFirst.mockResolvedValue(null);

      const result = await service.obtenerActual(TENANT);

      expect(result).toBeNull();
    });

    it("returns the open turno with a computed totalCalculado when one exists", async () => {
      prisma.turnoCaja.findFirst.mockResolvedValue({
        id: "turno-1",
        estado: "abierto",
        montoInicial: 1000,
        semantica: "efectivo",
        movimientos: [{ tipo: "ingreso", monto: 200 }],
        pedidos: [],
        cobros: [{ metodo: "efectivo", monto: 200 }],
        totalCalculado: null,
        totalDigital: null,
        totalVentas: null,
      });
      prisma.cobro.count.mockResolvedValue(0);
      prisma.pedido.count.mockResolvedValue(0);

      const result = await service.obtenerActual(TENANT);

      expect(prisma.turnoCaja.findFirst).toHaveBeenCalledWith({
        where: { ...TENANT, estado: "abierto" },
        include: { movimientos: true, cobros: true, pedidos: { include: { items: true } } },
      });
      expect(result?.totalCalculado).toBe(1400);
      expect(result?.totalVentas).toBe(200);
    });
  });

  describe("assertTurnoAbierto", () => {
    it("resolves with the turno when one is open", async () => {
      const turno = { id: "turno-1", estado: "abierto", ...TENANT };
      prisma.turnoCaja.findFirst.mockResolvedValue(turno);

      await expect(service.assertTurnoAbierto(TENANT)).resolves.toEqual(turno);
    });

    it("throws BadRequestException when none is open", async () => {
      prisma.turnoCaja.findFirst.mockResolvedValue(null);

      await expect(service.assertTurnoAbierto(TENANT)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("listar", () => {
    it("lists all turnos for the tenant ordered by abiertoEn desc", async () => {
      const all = [{ id: "turno-2" }, { id: "turno-1" }];
      prisma.turnoCaja.findMany.mockResolvedValue(all);

      const result = await service.listar(TENANT);

      expect(prisma.turnoCaja.findMany).toHaveBeenCalledWith({ where: TENANT, orderBy: { abiertoEn: "desc" } });
      expect(result).toEqual(all);
    });
  });

  describe("calcularTotales", () => {
    it("separates expected physical cash, digital receipts, and sales", () => {
      expect(service.calcularTotales({
        montoInicial: 1000,
        movimientos: [{ tipo: "ingreso", monto: 100 }, { tipo: "egreso", monto: 50 }],
        cobros: [{ metodo: "efectivo", monto: 700 }, { metodo: "mercadopago", monto: 800 }],
      })).toEqual({ totalCalculado: 1750, totalDigital: 800, totalVentas: 1500 });
    });

    it("rejects sums outside signed database integer bounds", () => {
      expect(() => service.calcularTotales({ montoInicial: 2_147_483_647, movimientos: [], cobros: [{ metodo: "efectivo", monto: 1 }] })).toThrow(BadRequestException);
      expect(() => service.calcularTotales({ montoInicial: 0, movimientos: [{ tipo: "egreso", monto: 2_147_483_647 }, { tipo: "egreso", monto: 2_147_483_647 }], cobros: [] })).toThrow(BadRequestException);
    });
  });
});
