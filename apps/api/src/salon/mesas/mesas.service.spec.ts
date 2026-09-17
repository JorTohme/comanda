import { Test } from "@nestjs/testing";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { MesasService } from "./mesas.service";
import { TenantContext } from "../../auth/jwt.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeGateway } from "../../realtime/realtime.gateway";

const TENANT: TenantContext = {
  orgId: "00000000-0000-0000-0000-000000000011",
  sucursalId: "00000000-0000-0000-0000-000000000012",
};

describe("MesasService", () => {
  let service: MesasService;
  const prisma = {
    mesa: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const realtime = {
    emitToSucursal: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MesasService,
        { provide: PrismaService, useValue: prisma },
        { provide: RealtimeGateway, useValue: realtime },
      ],
    }).compile();

    service = moduleRef.get(MesasService);
  });

  it("creates a mesa defaulting estado to libre when omitted", async () => {
    const created = { id: "mesa-1", nombre: "Mesa 1", capacidad: 4, estado: "libre" };
    prisma.mesa.create.mockResolvedValue(created);

    const result = await service.create({ nombre: "Mesa 1", capacidad: 4 }, TENANT);

    expect(prisma.mesa.create).toHaveBeenCalledWith({
      data: { nombre: "Mesa 1", capacidad: 4, estado: "libre", ...TENANT },
    });
    expect(result.estado).toBe("libre");
    expect(realtime.emitToSucursal).toHaveBeenCalledWith(TENANT.sucursalId, "mesa.actualizada", created);
  });

  it("creates a mesa honoring an explicit estado", async () => {
    const created = { id: "mesa-2", nombre: "Mesa 2", capacidad: 2, estado: "ocupada" };
    prisma.mesa.create.mockResolvedValue(created);

    const result = await service.create({ nombre: "Mesa 2", capacidad: 2, estado: "ocupada" }, TENANT);

    expect(prisma.mesa.create).toHaveBeenCalledWith({
      data: { nombre: "Mesa 2", capacidad: 2, estado: "ocupada", ...TENANT },
    });
    expect(result.estado).toBe("ocupada");
  });

  it("lists all mesas", async () => {
    const all = [{ id: "mesa-1" }, { id: "mesa-2" }];
    prisma.mesa.findMany.mockResolvedValue(all);

    const result = await service.findAll(TENANT);

    expect(prisma.mesa.findMany).toHaveBeenCalledWith({ where: TENANT });
    expect(result).toHaveLength(2);
  });

  it("persists spatial fields (posX, posY, rotacion, forma, ancho, alto) when passed to update", async () => {
    const updated = { id: "mesa-1", posX: 40, posY: 12, rotacion: 90, forma: "circle", ancho: 90, alto: 90 };
    prisma.mesa.findFirst.mockResolvedValue({ id: "mesa-1" });
    prisma.mesa.update.mockResolvedValue(updated);

    const result = await service.update(
      "mesa-1",
      { posX: 40, posY: 12, rotacion: 90, forma: "circle", ancho: 90, alto: 90 },
      TENANT,
    );

    expect(prisma.mesa.update).toHaveBeenCalledWith({
      where: { id: "mesa-1" },
      data: { posX: 40, posY: 12, rotacion: 90, forma: "circle", ancho: 90, alto: 90 },
    });
    expect(result).toEqual(updated);
  });

  it.each(["libre", "ocupada", "pedido_en_curso"] as const)(
    "persists estado=%s on update",
    async (estado) => {
      const updated = { id: "mesa-1", estado };
      prisma.mesa.findFirst.mockResolvedValue({ id: "mesa-1" });
      prisma.mesa.update.mockResolvedValue(updated);

      const result = await service.update("mesa-1", { estado }, TENANT);

      expect(prisma.mesa.update).toHaveBeenCalledWith({
        where: { id: "mesa-1" },
        data: { estado },
      });
      expect(result.estado).toBe(estado);
      expect(realtime.emitToSucursal).toHaveBeenCalledWith(TENANT.sucursalId, "mesa.actualizada", updated);
    },
  );

  it("throws NotFoundException when updating a nonexistent mesa", async () => {
    prisma.mesa.findFirst.mockResolvedValue(null);

    await expect(service.update("missing-id", { estado: "ocupada" }, TENANT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("deletes an existing mesa and returns the deleted row", async () => {
    const deleted = { id: "mesa-1" };
    prisma.mesa.findFirst.mockResolvedValue({ id: "mesa-1" });
    prisma.mesa.delete.mockResolvedValue(deleted);

    const result = await service.remove("mesa-1", TENANT);

    expect(prisma.mesa.delete).toHaveBeenCalledWith({ where: { id: "mesa-1" } });
    expect(result).toEqual(deleted);
  });

  it("throws NotFoundException when deleting a nonexistent mesa", async () => {
    prisma.mesa.findFirst.mockResolvedValue(null);

    await expect(service.remove("missing-id", TENANT)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws ConflictException when deleting a mesa referenced by an existing Pedido", async () => {
    prisma.mesa.delete.mockRejectedValue({ code: "P2003" });
    prisma.mesa.findFirst.mockResolvedValue({ id: "mesa-1" });

    await expect(service.remove("mesa-1", TENANT)).rejects.toBeInstanceOf(ConflictException);
  });

  it("assertMesaExists resolves silently when the mesa exists", async () => {
    prisma.mesa.findFirst.mockResolvedValue({ id: "mesa-1" });

    await expect(service.assertMesaExists("mesa-1", TENANT)).resolves.toBeUndefined();
    expect(prisma.mesa.findFirst).toHaveBeenCalledWith({ where: { id: "mesa-1", ...TENANT }, select: { id: true } });
  });

  it("assertMesaExists throws BadRequestException when no mesa matches", async () => {
    prisma.mesa.findFirst.mockResolvedValue(null);

    await expect(service.assertMesaExists("missing-mesa", TENANT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("marcarEstado updates the mesa estado against the passed transaction client", async () => {
    const tx = { mesa: { update: jest.fn().mockResolvedValue({ id: "mesa-1", estado: "libre" }) } };

    await service.marcarEstado(tx as never, "mesa-1", "libre");

    expect(tx.mesa.update).toHaveBeenCalledWith({
      where: { id: "mesa-1" },
      data: { estado: "libre" },
    });
    expect(prisma.mesa.update).not.toHaveBeenCalled();
  });
});
