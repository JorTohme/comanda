import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { CategoriasService } from "./categorias.service";
import { TenantContext } from "../../auth/jwt.service";
import { PrismaService } from "../../prisma/prisma.service";

const TENANT: TenantContext = {
  orgId: "00000000-0000-0000-0000-000000000011",
  sucursalId: "00000000-0000-0000-0000-000000000012",
};

describe("CategoriasService", () => {
  let service: CategoriasService;
  const prisma = {
    categoria: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
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

    const result = await service.create({ nombre: "Bebidas" }, TENANT);

    expect(prisma.categoria.create).toHaveBeenCalledWith({ data: { nombre: "Bebidas", ...TENANT } });
    expect(result).toEqual(created);
  });

  it("returns all categorias", async () => {
    const all = [
      { id: "cat-1", nombre: "Bebidas" },
      { id: "cat-2", nombre: "Postres" },
    ];
    prisma.categoria.findMany.mockResolvedValue(all);

    const result = await service.findAll(TENANT);

    expect(result).toEqual(all);
    expect(result).toHaveLength(2);
    expect(prisma.categoria.findMany).toHaveBeenCalledWith({ where: TENANT });
  });

  it("updates an existing categoria", async () => {
    const updated = { id: "cat-1", nombre: "Bebidas Frías" };
    prisma.categoria.findFirst.mockResolvedValue({ id: "cat-1" });
    prisma.categoria.update.mockResolvedValue(updated);

    const result = await service.update("cat-1", { nombre: "Bebidas Frías" }, TENANT);

    expect(prisma.categoria.update).toHaveBeenCalledWith({
      where: { id: "cat-1" },
      data: { nombre: "Bebidas Frías" },
    });
    expect(result).toEqual(updated);
  });

  it("throws NotFoundException when updating a nonexistent categoria", async () => {
    prisma.categoria.findFirst.mockResolvedValue(null);

    await expect(service.update("missing-id", { nombre: "X" }, TENANT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("deletes an existing categoria", async () => {
    const deleted = { id: "cat-1", nombre: "Bebidas" };
    prisma.categoria.findFirst.mockResolvedValue({ id: "cat-1" });
    prisma.categoria.delete.mockResolvedValue(deleted);

    const result = await service.remove("cat-1", TENANT);

    expect(prisma.categoria.delete).toHaveBeenCalledWith({ where: { id: "cat-1" } });
    expect(result).toEqual(deleted);
  });

  it("throws NotFoundException when deleting a nonexistent categoria", async () => {
    prisma.categoria.findFirst.mockResolvedValue(null);

    await expect(service.remove("missing-id", TENANT)).rejects.toBeInstanceOf(NotFoundException);
  });
});
