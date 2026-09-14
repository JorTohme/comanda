import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { CategoriasService } from "./categorias.service";
import { PrismaService } from "../../prisma/prisma.service";

describe("CategoriasService", () => {
  let service: CategoriasService;
  const prisma = {
    categoria: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [CategoriasService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(CategoriasService);
  });

  it("creates and returns a categoria", async () => {
    const created = { id: "cat-1", nombre: "Bebidas" };
    prisma.categoria.create.mockResolvedValue(created);

    const result = await service.create({ nombre: "Bebidas" });

    expect(prisma.categoria.create).toHaveBeenCalledWith({ data: { nombre: "Bebidas" } });
    expect(result).toEqual(created);
  });

  it("returns all categorias", async () => {
    const all = [
      { id: "cat-1", nombre: "Bebidas" },
      { id: "cat-2", nombre: "Postres" },
    ];
    prisma.categoria.findMany.mockResolvedValue(all);

    const result = await service.findAll();

    expect(result).toEqual(all);
    expect(result).toHaveLength(2);
  });

  it("updates an existing categoria", async () => {
    const updated = { id: "cat-1", nombre: "Bebidas Frías" };
    prisma.categoria.update.mockResolvedValue(updated);

    const result = await service.update("cat-1", { nombre: "Bebidas Frías" });

    expect(prisma.categoria.update).toHaveBeenCalledWith({
      where: { id: "cat-1" },
      data: { nombre: "Bebidas Frías" },
    });
    expect(result).toEqual(updated);
  });

  it("throws NotFoundException when updating a nonexistent categoria", async () => {
    prisma.categoria.update.mockRejectedValue({ code: "P2025" });

    await expect(service.update("missing-id", { nombre: "X" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("deletes an existing categoria", async () => {
    const deleted = { id: "cat-1", nombre: "Bebidas" };
    prisma.categoria.delete.mockResolvedValue(deleted);

    const result = await service.remove("cat-1");

    expect(prisma.categoria.delete).toHaveBeenCalledWith({ where: { id: "cat-1" } });
    expect(result).toEqual(deleted);
  });

  it("throws NotFoundException when deleting a nonexistent categoria", async () => {
    prisma.categoria.delete.mockRejectedValue({ code: "P2025" });

    await expect(service.remove("missing-id")).rejects.toBeInstanceOf(NotFoundException);
  });
});
