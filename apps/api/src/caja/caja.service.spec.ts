import { Test } from "@nestjs/testing";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { CajaService } from "./caja.service";
import { TenantContext } from "../auth/jwt.service";
import { PrismaService } from "../prisma/prisma.service";

const TENANT: TenantContext = {
  orgId: "00000000-0000-0000-0000-000000000011",
  sucursalId: "00000000-0000-0000-0000-000000000012",
};

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
  };

  beforeEach(async () => {
    jest.resetAllMocks();
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

      const result = await service.abrirTurno({ montoInicial: 10000 }, "usuario-1", TENANT);

      expect(prisma.turnoCaja.findFirst).toHaveBeenCalledWith({ where: { ...TENANT, estado: "abierto" } });
      expect(prisma.turnoCaja.create).toHaveBeenCalledWith({
        data: { montoInicial: 10000, abiertoPorId: "usuario-1", ...TENANT },
      });
      expect(result).toEqual(created);
    });

    it("throws ConflictException when an open turno already exists for the tenant", async () => {
      prisma.turnoCaja.findFirst.mockResolvedValue({ id: "turno-existing", estado: "abierto" });

      await expect(service.abrirTurno({ montoInicial: 5000 }, "usuario-1", TENANT)).rejects.toBeInstanceOf(
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
        service.registrarMovimiento("missing-turno", { tipo: "ingreso", monto: 100, descripcion: "x" }, TENANT),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.movimientoCaja.create).not.toHaveBeenCalled();
    });

    it("throws ConflictException when the turno is already cerrado", async () => {
      prisma.turnoCaja.findFirst.mockResolvedValue({ id: "turno-1", estado: "cerrado", ...TENANT });

      await expect(
        service.registrarMovimiento("turno-1", { tipo: "egreso", monto: 100, descripcion: "x" }, TENANT),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.movimientoCaja.create).not.toHaveBeenCalled();
    });
  });

  describe("cerrarTurno", () => {
    const turnoConDatos = {
      id: "turno-1",
      montoInicial: 10000,
      movimientos: [
        { tipo: "ingreso", monto: 200 },
        { tipo: "egreso", monto: 150 },
      ],
      pedidos: [
        {
          items: [
            { precioUnitario: 1000, cantidad: 2 },
            { precioUnitario: 500, cantidad: 1 },
          ],
        },
        { items: [{ precioUnitario: 300, cantidad: 3 }] },
      ],
    };
    // montoInicial 10000 + ventas (2000+500+900=3400) + movimientos (200-150=50) = 13450

    beforeEach(() => {
      prisma.turnoCaja.findFirst.mockResolvedValue({ id: "turno-1", estado: "abierto", ...TENANT });
      prisma.turnoCaja.findFirstOrThrow.mockResolvedValue(turnoConDatos);
      prisma.turnoCaja.update.mockImplementation(({ data }) => Promise.resolve({ id: "turno-1", ...data }));
    });

    it("computes totalCalculado from pedidos items and movimientos", async () => {
      const result = await service.cerrarTurno("turno-1", { montoDeclarado: 13450 }, "usuario-1", TENANT);

      expect(result.totalCalculado).toBe(13450);
    });

    it("computes a positive diferencia when montoDeclarado exceeds totalCalculado", async () => {
      const result = await service.cerrarTurno("turno-1", { montoDeclarado: 13500 }, "usuario-1", TENANT);

      expect(result.diferencia).toBe(50);
    });

    it("computes a negative diferencia when montoDeclarado is under totalCalculado", async () => {
      const result = await service.cerrarTurno("turno-1", { montoDeclarado: 13400 }, "usuario-1", TENANT);

      expect(result.diferencia).toBe(-50);
    });

    it("computes a zero diferencia when montoDeclarado matches totalCalculado exactly", async () => {
      const result = await service.cerrarTurno("turno-1", { montoDeclarado: 13450 }, "usuario-1", TENANT);

      expect(result.diferencia).toBe(0);
    });

    it("persists estado=cerrado, cerradoPorId and cerradoEn", async () => {
      await service.cerrarTurno("turno-1", { montoDeclarado: 13450 }, "usuario-1", TENANT);

      expect(prisma.turnoCaja.update).toHaveBeenCalledWith({
        where: { id: "turno-1" },
        data: expect.objectContaining({
          estado: "cerrado",
          cerradoPorId: "usuario-1",
          cerradoEn: expect.any(Date),
          montoDeclarado: 13450,
          totalCalculado: 13450,
          diferencia: 0,
        }),
      });
    });

    it("throws ConflictException when the turno is already cerrado", async () => {
      prisma.turnoCaja.findFirst.mockResolvedValue({ id: "turno-1", estado: "cerrado", ...TENANT });

      await expect(
        service.cerrarTurno("turno-1", { montoDeclarado: 100 }, "usuario-1", TENANT),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.turnoCaja.update).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when the turno isn't owned by the tenant", async () => {
      prisma.turnoCaja.findFirst.mockResolvedValue(null);

      await expect(
        service.cerrarTurno("missing-turno", { montoDeclarado: 100 }, "usuario-1", TENANT),
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
        montoInicial: 1000,
        movimientos: [{ tipo: "ingreso", monto: 200 }],
        pedidos: [{ items: [{ precioUnitario: 100, cantidad: 2 }] }],
      });

      const result = await service.obtenerActual(TENANT);

      expect(prisma.turnoCaja.findFirst).toHaveBeenCalledWith({
        where: { ...TENANT, estado: "abierto" },
        include: { movimientos: true, pedidos: { include: { items: true } } },
      });
      expect(result?.totalCalculado).toBe(1400);
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
});
