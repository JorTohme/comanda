import { Test } from "@nestjs/testing";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { PlatosService } from "./platos.service";
import { TenantContext } from "../../auth/jwt.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeGateway } from "../../realtime/realtime.gateway";
import { JwtService } from "../../auth/jwt.service";

const TENANT: TenantContext = {
  orgId: "00000000-0000-0000-0000-000000000011",
  sucursalId: "00000000-0000-0000-0000-000000000012",
};

describe("PlatosService", () => {
  let service: PlatosService;
  const prisma = {
    plato: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    categoria: {
      findFirst: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const realtime = {
    emitToSucursal: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$queryRaw.mockResolvedValue([{ id: TENANT.sucursalId }]);
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatosService,
        { provide: PrismaService, useValue: prisma },
        { provide: RealtimeGateway, useValue: realtime },
      ],
    }).compile();

    service = moduleRef.get(PlatosService);
  });

  it("creates a plato defaulting disponible to true when omitted", async () => {
    prisma.categoria.findFirst.mockResolvedValue({ id: "cat-1", nombre: "Bebidas" });
    const created = {
      id: "plato-1",
      nombre: "Agua",
      precio: 1000,
      disponible: true,
      categoriaId: "cat-1",
    };
    prisma.plato.create.mockResolvedValue(created);

    const result = await service.create({ nombre: "Agua", precio: 1000, categoriaId: "cat-1" }, TENANT);

    expect(prisma.plato.create).toHaveBeenCalledWith({
      data: { nombre: "Agua", precio: 1000, categoriaId: "cat-1", disponible: true, ...TENANT },
    });
    expect(result.disponible).toBe(true);
  });

  it("publishes a created plato only after the transaction has committed", async () => {
    const timeline: string[] = [];
    const created = {
      id: "00000000-0000-0000-0000-000000000031", nombre: "Agua", precio: 1000, disponible: true,
      categoriaId: "00000000-0000-0000-0000-000000000021", ...TENANT, createdAt: new Date(), updatedAt: new Date(),
    };
    prisma.categoria.findFirst.mockResolvedValue({ id: created.categoriaId });
    prisma.plato.create.mockResolvedValue(created);
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => {
      const result = await callback(prisma);
      timeline.push("commit");
      return result;
    });
    realtime.emitToSucursal.mockImplementation(() => timeline.push("event"));

    await service.create({ nombre: "Agua", precio: 1000, categoriaId: created.categoriaId }, TENANT);

    expect(timeline).toEqual(["commit", "event"]);
    expect(realtime.emitToSucursal).toHaveBeenCalledWith(TENANT.sucursalId, "plato.creado", created);
  });

  it("rejects creation when categoriaId does not reference an existing categoria", async () => {
    prisma.categoria.findFirst.mockResolvedValue(null);

    await expect(
      service.create({ nombre: "Agua", precio: 1000, categoriaId: "missing-cat" }, TENANT),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.plato.create).not.toHaveBeenCalled();
  });

  it("lists all platos", async () => {
    const all = [{ id: "plato-1" }, { id: "plato-2" }];
    prisma.plato.findMany.mockResolvedValue(all);

    const result = await service.findAll(undefined, TENANT);

    expect(prisma.plato.findMany).toHaveBeenCalledWith({ where: TENANT });
    expect(result).toHaveLength(2);
  });

  it("lists platos filtered by categoriaId", async () => {
    const filtered = [{ id: "plato-1", categoriaId: "cat-1" }];
    prisma.plato.findMany.mockResolvedValue(filtered);

    const result = await service.findAll("cat-1", TENANT);

    expect(prisma.plato.findMany).toHaveBeenCalledWith({ where: { ...TENANT, categoriaId: "cat-1" } });
    expect(result).toEqual(filtered);
  });

  it("toggles disponible on update", async () => {
    const updated = { id: "plato-1", disponible: false };
    prisma.plato.findFirst.mockResolvedValue({ id: "plato-1" });
    prisma.plato.update.mockResolvedValue(updated);

    const result = await service.update("plato-1", { disponible: false }, TENANT);

    expect(prisma.plato.update).toHaveBeenCalledWith({
      where: { id: "plato-1" },
      data: { disponible: false },
    });
    expect(result.disponible).toBe(false);
    expect(realtime.emitToSucursal).toHaveBeenCalledWith(TENANT.sucursalId, "plato.actualizado", updated);
  });

  it("throws NotFoundException when updating a nonexistent plato", async () => {
    prisma.plato.findFirst.mockResolvedValue(null);

    await expect(service.update("missing-id", { disponible: false }, TENANT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("rejects update when categoriaId does not reference an existing categoria", async () => {
    prisma.plato.findFirst.mockResolvedValue({ id: "plato-1" });
    prisma.categoria.findFirst.mockResolvedValue(null);

    await expect(
      service.update("plato-1", { categoriaId: "missing-cat" }, TENANT),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.plato.update).not.toHaveBeenCalled();
  });

  it("deletes an existing plato", async () => {
    const deleted = { id: "plato-1" };
    prisma.plato.findFirst.mockResolvedValue({ id: "plato-1" });
    prisma.plato.delete.mockResolvedValue(deleted);

    const result = await service.remove("plato-1", TENANT);

    expect(prisma.plato.delete).toHaveBeenCalledWith({ where: { id: "plato-1" } });
    expect(result).toEqual(deleted);
  });

  it("throws NotFoundException when deleting a nonexistent plato", async () => {
    prisma.plato.findFirst.mockResolvedValue(null);

    await expect(service.remove("missing-id", TENANT)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws ConflictException when deleting a plato referenced by an existing ItemPedido", async () => {
    prisma.plato.delete.mockRejectedValue({ code: "P2003" });
    prisma.plato.findFirst.mockResolvedValue({ id: "plato-1" });

    await expect(service.remove("plato-1", TENANT)).rejects.toBeInstanceOf(ConflictException);
  });

  it("publishes a tenant-scoped delete envelope after removing a plato", async () => {
    const id = "00000000-0000-0000-0000-000000000031";
    prisma.plato.findFirst.mockResolvedValue({ id });
    prisma.plato.delete.mockResolvedValue({ id, ...TENANT });

    await service.remove(id, TENANT);

    expect(realtime.emitToSucursal).toHaveBeenCalledWith(TENANT.sucursalId, "plato.eliminado", { id, ...TENANT });
  });

  it("does not publish when the transaction fails", async () => {
    prisma.$transaction.mockRejectedValue(new Error("commit failed"));

    await expect(service.update("plato-1", { disponible: false }, TENANT)).rejects.toThrow("commit failed");

    expect(realtime.emitToSucursal).not.toHaveBeenCalled();
  });

  it("keeps a committed catalog write successful when the real gateway transport throws", async () => {
    prisma.categoria.findFirst.mockResolvedValue({ id: "cat-1" });
    prisma.plato.create.mockResolvedValue({ id: "plato-1" });
    const gateway = new RealtimeGateway({} as JwtService);
    gateway.server = { to: jest.fn().mockImplementation(() => { throw new Error("redis down"); }) } as never;
    const withRealGateway = new PlatosService(prisma as never, gateway);

    await expect(withRealGateway.create({ nombre: "Agua", precio: 1000, categoriaId: "cat-1" }, TENANT)).resolves.toEqual({ id: "plato-1" });
  });
});
