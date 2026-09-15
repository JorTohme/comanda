import { Test } from "@nestjs/testing";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { MesasService } from "./mesas.service";
import { PrismaService } from "../../prisma/prisma.service";

describe("MesasService", () => {
  let service: MesasService;
  const prisma = {
    mesa: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [MesasService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(MesasService);
  });

  it("creates a mesa defaulting estado to libre when omitted", async () => {
    const created = { id: "mesa-1", nombre: "Mesa 1", capacidad: 4, estado: "libre" };
    prisma.mesa.create.mockResolvedValue(created);

    const result = await service.create({ nombre: "Mesa 1", capacidad: 4 });

    expect(prisma.mesa.create).toHaveBeenCalledWith({
      data: { nombre: "Mesa 1", capacidad: 4, estado: "libre" },
    });
    expect(result.estado).toBe("libre");
  });

  it("creates a mesa honoring an explicit estado", async () => {
    const created = { id: "mesa-2", nombre: "Mesa 2", capacidad: 2, estado: "ocupada" };
    prisma.mesa.create.mockResolvedValue(created);

    const result = await service.create({ nombre: "Mesa 2", capacidad: 2, estado: "ocupada" });

    expect(prisma.mesa.create).toHaveBeenCalledWith({
      data: { nombre: "Mesa 2", capacidad: 2, estado: "ocupada" },
    });
    expect(result.estado).toBe("ocupada");
  });

  it("lists all mesas", async () => {
    const all = [{ id: "mesa-1" }, { id: "mesa-2" }];
    prisma.mesa.findMany.mockResolvedValue(all);

    const result = await service.findAll();

    expect(prisma.mesa.findMany).toHaveBeenCalledWith({});
    expect(result).toHaveLength(2);
  });

  it.each(["libre", "ocupada", "pedido_en_curso"] as const)(
    "persists estado=%s on update",
    async (estado) => {
      const updated = { id: "mesa-1", estado };
      prisma.mesa.update.mockResolvedValue(updated);

      const result = await service.update("mesa-1", { estado });

      expect(prisma.mesa.update).toHaveBeenCalledWith({
        where: { id: "mesa-1" },
        data: { estado },
      });
      expect(result.estado).toBe(estado);
    },
  );

  it("throws NotFoundException when updating a nonexistent mesa", async () => {
    prisma.mesa.update.mockRejectedValue({ code: "P2025" });

    await expect(service.update("missing-id", { estado: "ocupada" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("deletes an existing mesa and returns the deleted row", async () => {
    const deleted = { id: "mesa-1" };
    prisma.mesa.delete.mockResolvedValue(deleted);

    const result = await service.remove("mesa-1");

    expect(prisma.mesa.delete).toHaveBeenCalledWith({ where: { id: "mesa-1" } });
    expect(result).toEqual(deleted);
  });

  it("throws NotFoundException when deleting a nonexistent mesa", async () => {
    prisma.mesa.delete.mockRejectedValue({ code: "P2025" });

    await expect(service.remove("missing-id")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws ConflictException when deleting a mesa referenced by an existing Pedido", async () => {
    prisma.mesa.delete.mockRejectedValue({ code: "P2003" });

    await expect(service.remove("mesa-1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("assertMesaExists resolves silently when the mesa exists", async () => {
    prisma.mesa.findUnique.mockResolvedValue({ id: "mesa-1" });

    await expect(service.assertMesaExists("mesa-1")).resolves.toBeUndefined();
    expect(prisma.mesa.findUnique).toHaveBeenCalledWith({ where: { id: "mesa-1" } });
  });

  it("assertMesaExists throws BadRequestException when no mesa matches", async () => {
    prisma.mesa.findUnique.mockResolvedValue(null);

    await expect(service.assertMesaExists("missing-mesa")).rejects.toBeInstanceOf(
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
