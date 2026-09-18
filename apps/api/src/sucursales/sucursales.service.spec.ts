import { Test } from "@nestjs/testing";
import { ConflictException } from "@nestjs/common";
import { SucursalesService } from "./sucursales.service";
import { PrismaService } from "../prisma/prisma.service";

const ORG_ID = "00000000-0000-0000-0000-000000000011";

describe("SucursalesService", () => {
  let service: SucursalesService;
  const prisma = {
    sucursal: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [SucursalesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(SucursalesService);
  });

  it("creates and returns a sucursal scoped to the org", async () => {
    const created = { id: "suc-2", nombre: "Sucursal Centro", organizacionId: ORG_ID };
    prisma.sucursal.create.mockResolvedValue(created);

    const result = await service.create({ nombre: "Sucursal Centro" }, ORG_ID);

    expect(prisma.sucursal.create).toHaveBeenCalledWith({
      data: { nombre: "Sucursal Centro", organizacionId: ORG_ID },
    });
    expect(result).toEqual(created);
  });

  it("throws ConflictException when the name already exists in the same org", async () => {
    prisma.sucursal.create.mockRejectedValue({ code: "P2002" });

    await expect(service.create({ nombre: "Duplicada" }, ORG_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it("findAll filters only by organizacionId, not sucursalId", async () => {
    const all = [
      { id: "suc-1", nombre: "Casa Matriz", organizacionId: ORG_ID },
      { id: "suc-2", nombre: "Sucursal Centro", organizacionId: ORG_ID },
    ];
    prisma.sucursal.findMany.mockResolvedValue(all);

    const result = await service.findAll(ORG_ID);

    expect(result).toEqual(all);
    expect(prisma.sucursal.findMany).toHaveBeenCalledWith({ where: { organizacionId: ORG_ID } });
    expect(prisma.sucursal.findMany.mock.calls[0][0].where).not.toHaveProperty("sucursalId");
  });
});
