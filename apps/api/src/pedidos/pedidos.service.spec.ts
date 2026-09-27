import { Test } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { EstadoPedido } from "@prisma/client";
import { PedidosService } from "./pedidos.service";
import { TenantContext } from "../auth/jwt.service";
import { PrismaService } from "../prisma/prisma.service";
import { MesasService } from "../salon/mesas/mesas.service";
import { CajaService } from "../caja/caja.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { SIGUIENTE } from "./estado-pedido";

const ESTADOS: EstadoPedido[] = [
  "abierto",
  "enviado_a_cocina",
  "en_preparacion",
  "listo",
  "entregado",
  "cobrado",
  "cerrado",
];

const TENANT: TenantContext = {
  orgId: "00000000-0000-0000-0000-000000000011",
  sucursalId: "00000000-0000-0000-0000-000000000012",
};

describe("PedidosService", () => {
  let service: PedidosService;
  const prisma = {
    pedido: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    pago: { findFirst: jest.fn() },
    plato: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const mesas = {
    assertMesaExists: jest.fn(),
    marcarEstado: jest.fn(),
  };
  const caja = {
    assertTurnoAbierto: jest.fn(),
  };
  const realtime = {
    emitToSucursal: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(async (cb: (tx: typeof prisma) => unknown) => cb(prisma));
    caja.assertTurnoAbierto.mockResolvedValue({ id: "turno-1" });
    prisma.pago.findFirst.mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PedidosService,
        { provide: PrismaService, useValue: prisma },
        { provide: MesasService, useValue: mesas },
        { provide: CajaService, useValue: caja },
        { provide: RealtimeGateway, useValue: realtime },
      ],
    }).compile();

    service = moduleRef.get(PedidosService);
  });

  describe("create", () => {
    it("returns the existing pedido when clientRequestId already exists, without creating a duplicate", async () => {
      const existente = {
        id: "pedido-existente",
        tipoServicio: "barra",
        mesaId: null,
        estado: "abierto",
        clientRequestId: "req-1",
        items: [],
      };
      prisma.pedido.findFirst.mockResolvedValue(existente);

      const result = await service.create({
        tipoServicio: "barra",
        clientRequestId: "req-1",
        items: [{ platoId: "plato-1", cantidad: 1 }],
      }, TENANT);

      expect(prisma.pedido.findFirst).toHaveBeenCalledWith({
        where: { clientRequestId: "req-1", ...TENANT },
        include: { items: true },
      });
      expect(result).toEqual(existente);
      expect(prisma.pedido.create).not.toHaveBeenCalled();
      expect(mesas.marcarEstado).not.toHaveBeenCalled();
      expect(realtime.emitToSucursal).not.toHaveBeenCalled();
      expect(prisma.plato.findMany).not.toHaveBeenCalled();
    });

    it("creates normally when clientRequestId is new", async () => {
      prisma.pedido.findFirst.mockResolvedValue(null);
      prisma.plato.findMany.mockResolvedValue([{ id: "plato-1", nombre: "Milanesa", precio: 1500 }]);
      const pedidoCreado = {
        id: "pedido-1",
        tipoServicio: "barra",
        mesaId: null,
        estado: "abierto",
        clientRequestId: "req-2",
        items: [],
      };
      prisma.pedido.create.mockResolvedValue(pedidoCreado);

      const result = await service.create({
        tipoServicio: "barra",
        clientRequestId: "req-2",
        items: [{ platoId: "plato-1", cantidad: 1 }],
      }, TENANT);

      expect(prisma.pedido.create).toHaveBeenCalledWith({
        data: {
          tipoServicio: "barra",
          mesaId: null,
          plataforma: null,
          direccionEnvio: null,
          estado: "abierto",
          clientRequestId: "req-2",
          ...TENANT,
          items: { create: [{ platoId: "plato-1", nombre: "Milanesa", precioUnitario: 1500, cantidad: 1 }] },
        },
        include: { items: true },
      });
      expect(result).toEqual(pedidoCreado);
    });

    it("snapshots nombre and precioUnitario from Plato at creation, not a live read", async () => {
      prisma.plato.findMany.mockResolvedValue([
        { id: "plato-1", nombre: "Milanesa", precio: 1500 },
      ]);
      prisma.pedido.create.mockResolvedValue({
        id: "pedido-1",
        tipoServicio: "barra",
        mesaId: null,
        estado: "abierto",
        items: [{ id: "item-1", platoId: "plato-1", nombre: "Milanesa", precioUnitario: 1500, cantidad: 2 }],
      });

      const result = await service.create({
        tipoServicio: "barra",
        items: [{ platoId: "plato-1", cantidad: 2 }],
      }, TENANT);

      expect(prisma.pedido.create).toHaveBeenCalledWith({
        data: {
          tipoServicio: "barra",
          mesaId: null,
          plataforma: null,
          direccionEnvio: null,
          estado: "abierto",
          ...TENANT,
          items: {
            create: [{ platoId: "plato-1", nombre: "Milanesa", precioUnitario: 1500, cantidad: 2 }],
          },
        },
        include: { items: true },
      });
      expect(result.items[0].precioUnitario).toBe(1500);
      expect(result.items[0].nombre).toBe("Milanesa");
    });

    it("rejects an unknown platoId with BadRequestException and persists nothing", async () => {
      prisma.plato.findMany.mockResolvedValue([]);

      await expect(
        service.create({ tipoServicio: "barra", items: [{ platoId: "missing-plato", cantidad: 1 }] }, TENANT),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.pedido.create).not.toHaveBeenCalled();
    });

    it("rejects tipoServicio=mesa without mesaId", async () => {
      await expect(
        service.create({ tipoServicio: "mesa", items: [{ platoId: "plato-1", cantidad: 1 }] }, TENANT),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.pedido.create).not.toHaveBeenCalled();
    });

    it("rejects tipoServicio=barra with a mesaId", async () => {
      await expect(
        service.create({
          tipoServicio: "barra",
          mesaId: "mesa-1",
          items: [{ platoId: "plato-1", cantidad: 1 }],
        }, TENANT),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.pedido.create).not.toHaveBeenCalled();
    });

    it("rejects tipoServicio=takeaway with a mesaId", async () => {
      await expect(
        service.create({
          tipoServicio: "takeaway",
          mesaId: "mesa-1",
          items: [{ platoId: "plato-1", cantidad: 1 }],
        }, TENANT),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.pedido.create).not.toHaveBeenCalled();
    });

    it("rejects tipoServicio=delivery with a mesaId", async () => {
      await expect(
        service.create({
          tipoServicio: "delivery",
          mesaId: "mesa-1",
          direccionEnvio: "Calle 123",
          items: [{ platoId: "plato-1", cantidad: 1 }],
        }, TENANT),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.pedido.create).not.toHaveBeenCalled();
    });

    it("creates normally with tipoServicio=takeaway and no mesaId/plataforma/direccionEnvio", async () => {
      prisma.plato.findMany.mockResolvedValue([{ id: "plato-1", nombre: "Milanesa", precio: 1500 }]);
      prisma.pedido.create.mockResolvedValue({
        id: "pedido-1",
        tipoServicio: "takeaway",
        mesaId: null,
        plataforma: null,
        direccionEnvio: null,
        estado: "abierto",
        items: [],
      });

      await service.create({ tipoServicio: "takeaway", items: [{ platoId: "plato-1", cantidad: 1 }] }, TENANT);

      expect(prisma.pedido.create).toHaveBeenCalledWith({
        data: {
          tipoServicio: "takeaway",
          mesaId: null,
          plataforma: null,
          direccionEnvio: null,
          estado: "abierto",
          ...TENANT,
          items: { create: [{ platoId: "plato-1", nombre: "Milanesa", precioUnitario: 1500, cantidad: 1 }] },
        },
        include: { items: true },
      });
    });

    it("rejects tipoServicio=takeaway with plataforma set", async () => {
      await expect(
        service.create({
          tipoServicio: "takeaway",
          plataforma: "PedidosYa",
          items: [{ platoId: "plato-1", cantidad: 1 }],
        }, TENANT),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.pedido.create).not.toHaveBeenCalled();
    });

    it("rejects tipoServicio=takeaway with direccionEnvio set", async () => {
      await expect(
        service.create({
          tipoServicio: "takeaway",
          direccionEnvio: "Calle 123",
          items: [{ platoId: "plato-1", cantidad: 1 }],
        }, TENANT),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.pedido.create).not.toHaveBeenCalled();
    });

    it("rejects tipoServicio=mesa with plataforma set", async () => {
      mesas.assertMesaExists.mockResolvedValue(undefined);
      await expect(
        service.create({
          tipoServicio: "mesa",
          mesaId: "mesa-1",
          plataforma: "PedidosYa",
          items: [{ platoId: "plato-1", cantidad: 1 }],
        }, TENANT),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.pedido.create).not.toHaveBeenCalled();
    });

    it("rejects tipoServicio=barra with direccionEnvio set", async () => {
      await expect(
        service.create({
          tipoServicio: "barra",
          direccionEnvio: "Calle 123",
          items: [{ platoId: "plato-1", cantidad: 1 }],
        }, TENANT),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.pedido.create).not.toHaveBeenCalled();
    });

    it("creates normally with tipoServicio=delivery and plataforma only", async () => {
      prisma.plato.findMany.mockResolvedValue([{ id: "plato-1", nombre: "Milanesa", precio: 1500 }]);
      prisma.pedido.create.mockResolvedValue({
        id: "pedido-1",
        tipoServicio: "delivery",
        mesaId: null,
        plataforma: "PedidosYa",
        direccionEnvio: null,
        estado: "abierto",
        items: [],
      });

      await service.create({
        tipoServicio: "delivery",
        plataforma: "PedidosYa",
        items: [{ platoId: "plato-1", cantidad: 1 }],
      }, TENANT);

      expect(prisma.pedido.create).toHaveBeenCalledWith({
        data: {
          tipoServicio: "delivery",
          mesaId: null,
          plataforma: "PedidosYa",
          direccionEnvio: null,
          estado: "abierto",
          ...TENANT,
          items: { create: [{ platoId: "plato-1", nombre: "Milanesa", precioUnitario: 1500, cantidad: 1 }] },
        },
        include: { items: true },
      });
    });

    it("creates normally with tipoServicio=delivery and direccionEnvio only", async () => {
      prisma.plato.findMany.mockResolvedValue([{ id: "plato-1", nombre: "Milanesa", precio: 1500 }]);
      prisma.pedido.create.mockResolvedValue({
        id: "pedido-1",
        tipoServicio: "delivery",
        mesaId: null,
        plataforma: null,
        direccionEnvio: "Calle 123",
        estado: "abierto",
        items: [],
      });

      await service.create({
        tipoServicio: "delivery",
        direccionEnvio: "Calle 123",
        items: [{ platoId: "plato-1", cantidad: 1 }],
      }, TENANT);

      expect(prisma.pedido.create).toHaveBeenCalledWith({
        data: {
          tipoServicio: "delivery",
          mesaId: null,
          plataforma: null,
          direccionEnvio: "Calle 123",
          estado: "abierto",
          ...TENANT,
          items: { create: [{ platoId: "plato-1", nombre: "Milanesa", precioUnitario: 1500, cantidad: 1 }] },
        },
        include: { items: true },
      });
    });

    it("rejects tipoServicio=delivery with neither plataforma nor direccionEnvio", async () => {
      await expect(
        service.create({ tipoServicio: "delivery", items: [{ platoId: "plato-1", cantidad: 1 }] }, TENANT),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.pedido.create).not.toHaveBeenCalled();
    });

    it("rejects tipoServicio=delivery with both plataforma and direccionEnvio", async () => {
      await expect(
        service.create({
          tipoServicio: "delivery",
          plataforma: "PedidosYa",
          direccionEnvio: "Calle 123",
          items: [{ platoId: "plato-1", cantidad: 1 }],
        }, TENANT),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.pedido.create).not.toHaveBeenCalled();
    });

    it("rejects tipoServicio=mesa with an unknown mesaId via assertMesaExists", async () => {
      mesas.assertMesaExists.mockRejectedValue(new BadRequestException("Mesa missing-mesa not found"));

      await expect(
        service.create({
          tipoServicio: "mesa",
          mesaId: "missing-mesa",
          items: [{ platoId: "plato-1", cantidad: 1 }],
        }, TENANT),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.pedido.create).not.toHaveBeenCalled();
    });

    it("on success with tipoServicio=mesa, calls marcarEstado inside the $transaction callback", async () => {
      mesas.assertMesaExists.mockResolvedValue(undefined);
      prisma.plato.findMany.mockResolvedValue([{ id: "plato-1", nombre: "Milanesa", precio: 1500 }]);
      prisma.pedido.create.mockResolvedValue({
        id: "pedido-1",
        tipoServicio: "mesa",
        mesaId: "mesa-1",
        estado: "abierto",
        items: [],
      });

      await service.create({
        tipoServicio: "mesa",
        mesaId: "mesa-1",
        items: [{ platoId: "plato-1", cantidad: 1 }],
      }, TENANT);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mesas.marcarEstado).toHaveBeenCalledWith(prisma, "mesa-1", "pedido_en_curso");
      expect(mesas.assertMesaExists).toHaveBeenCalledWith("mesa-1", TENANT);
    });

    it("on success with tipoServicio=barra, never calls marcarEstado", async () => {
      prisma.plato.findMany.mockResolvedValue([{ id: "plato-1", nombre: "Milanesa", precio: 1500 }]);
      prisma.pedido.create.mockResolvedValue({
        id: "pedido-1",
        tipoServicio: "barra",
        mesaId: null,
        estado: "abierto",
        items: [],
      });

      await service.create({ tipoServicio: "barra", items: [{ platoId: "plato-1", cantidad: 1 }] }, TENANT);

      expect(mesas.marcarEstado).not.toHaveBeenCalled();
    });

    it("on success with tipoServicio=mesa, emits pedido.actualizado and mesa.actualizada", async () => {
      mesas.assertMesaExists.mockResolvedValue(undefined);
      mesas.marcarEstado.mockResolvedValue({ id: "mesa-1", estado: "pedido_en_curso" });
      prisma.plato.findMany.mockResolvedValue([{ id: "plato-1", nombre: "Milanesa", precio: 1500 }]);
      const pedidoCreado = {
        id: "pedido-1",
        tipoServicio: "mesa",
        mesaId: "mesa-1",
        estado: "abierto",
        items: [],
      };
      prisma.pedido.create.mockResolvedValue(pedidoCreado);

      await service.create({
        tipoServicio: "mesa",
        mesaId: "mesa-1",
        items: [{ platoId: "plato-1", cantidad: 1 }],
      }, TENANT);

      expect(realtime.emitToSucursal).toHaveBeenCalledWith(TENANT.sucursalId, "pedido.actualizado", pedidoCreado);
      expect(realtime.emitToSucursal).toHaveBeenCalledWith(TENANT.sucursalId, "mesa.actualizada", {
        id: "mesa-1",
        estado: "pedido_en_curso",
      });
    });

    it("on success with tipoServicio=barra, emits only pedido.actualizado", async () => {
      prisma.plato.findMany.mockResolvedValue([{ id: "plato-1", nombre: "Milanesa", precio: 1500 }]);
      const pedidoCreado = {
        id: "pedido-1",
        tipoServicio: "barra",
        mesaId: null,
        estado: "abierto",
        items: [],
      };
      prisma.pedido.create.mockResolvedValue(pedidoCreado);

      await service.create({ tipoServicio: "barra", items: [{ platoId: "plato-1", cantidad: 1 }] }, TENANT);

      expect(realtime.emitToSucursal).toHaveBeenCalledWith(TENANT.sucursalId, "pedido.actualizado", pedidoCreado);
      expect(realtime.emitToSucursal).not.toHaveBeenCalledWith(TENANT.sucursalId, "mesa.actualizada", expect.anything());
    });
  });

  describe("updateEstado", () => {
    describe.each(ESTADOS.flatMap((actual) => ESTADOS.map((destino) => [actual, destino] as const)))(
      "%s -> %s",
      (actual, destino) => {
        const esLegal = SIGUIENTE[actual] === destino;

        it(esLegal ? "accepts the legal transition" : "rejects the illegal transition", async () => {
          prisma.pedido.findFirst.mockResolvedValue({
            id: "pedido-1",
            estado: actual,
            tipoServicio: "barra",
            mesaId: null,
          });

          if (esLegal) {
            prisma.pedido.update.mockResolvedValue({ id: "pedido-1", estado: destino, items: [] });

            const result = await service.updateEstado("pedido-1", destino, TENANT);

            expect(result.estado).toBe(destino);
            const expectedData =
              destino === "cobrado" ? { estado: destino, turnoCajaId: "turno-1" } : { estado: destino };
            expect(prisma.pedido.update).toHaveBeenCalledWith({
              where: { id: "pedido-1" },
              data: expectedData,
              include: { items: true },
            });
            if (destino === "cobrado") {
              expect(caja.assertTurnoAbierto).toHaveBeenCalledWith(TENANT);
            } else {
              expect(caja.assertTurnoAbierto).not.toHaveBeenCalled();
            }
          } else {
            await expect(service.updateEstado("pedido-1", destino, TENANT)).rejects.toBeInstanceOf(
              BadRequestException,
            );
            expect(prisma.pedido.update).not.toHaveBeenCalled();
          }
        });
      },
    );

    it("settles an approved payment when marking the pedido as entregado", async () => {
      prisma.pedido.findFirst.mockResolvedValue({
        id: "pedido-1",
        estado: "listo",
        tipoServicio: "barra",
        mesaId: null,
      });
      prisma.pago.findFirst.mockResolvedValue({ id: "pago-1" });
      prisma.pedido.update.mockResolvedValue({ id: "pedido-1", estado: "cobrado", items: [] });

      const result = await service.updateEstado("pedido-1", "entregado", TENANT);

      expect(prisma.pago.findFirst).toHaveBeenCalledWith({
        where: { pedidoId: "pedido-1", estado: "aprobado", ...TENANT },
        select: { id: true },
      });
      expect(caja.assertTurnoAbierto).toHaveBeenCalledWith(TENANT);
      expect(prisma.pedido.update).toHaveBeenCalledWith({
        where: { id: "pedido-1" },
        data: { estado: "cobrado", turnoCajaId: "turno-1" },
        include: { items: true },
      });
      expect(result.estado).toBe("cobrado");
    });
    it("reaching cerrado on a mesa pedido calls marcarEstado(tx, mesaId, libre) and emits both events", async () => {
      prisma.pedido.findFirst.mockResolvedValue({
        id: "pedido-1",
        estado: "cobrado",
        tipoServicio: "mesa",
        mesaId: "mesa-1",
      });
      const pedidoActualizado = { id: "pedido-1", estado: "cerrado", items: [] };
      prisma.pedido.update.mockResolvedValue(pedidoActualizado);
      mesas.marcarEstado.mockResolvedValue({ id: "mesa-1", estado: "libre" });

      await service.updateEstado("pedido-1", "cerrado", TENANT);

      expect(mesas.marcarEstado).toHaveBeenCalledWith(prisma, "mesa-1", "libre");
      expect(realtime.emitToSucursal).toHaveBeenCalledWith(TENANT.sucursalId, "pedido.actualizado", pedidoActualizado);
      expect(realtime.emitToSucursal).toHaveBeenCalledWith(TENANT.sucursalId, "mesa.actualizada", {
        id: "mesa-1",
        estado: "libre",
      });
    });

    it("reaching cerrado on a barra pedido does not call marcarEstado nor emit mesa.actualizada", async () => {
      prisma.pedido.findFirst.mockResolvedValue({
        id: "pedido-1",
        estado: "cobrado",
        tipoServicio: "barra",
        mesaId: null,
      });
      const pedidoActualizado = { id: "pedido-1", estado: "cerrado", items: [] };
      prisma.pedido.update.mockResolvedValue(pedidoActualizado);

      await service.updateEstado("pedido-1", "cerrado", TENANT);

      expect(mesas.marcarEstado).not.toHaveBeenCalled();
      expect(realtime.emitToSucursal).toHaveBeenCalledWith(TENANT.sucursalId, "pedido.actualizado", pedidoActualizado);
      expect(realtime.emitToSucursal).not.toHaveBeenCalledWith(TENANT.sucursalId, "mesa.actualizada", expect.anything());
    });

    it("maps P2025 to NotFoundException on a nonexistent id", async () => {
      prisma.pedido.findFirst.mockResolvedValue(null);

      await expect(service.updateEstado("missing-id", "enviado_a_cocina", TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("transitioning entregado -> cobrado calls cajaService.assertTurnoAbierto(tenant)", async () => {
      prisma.pedido.findFirst.mockResolvedValue({
        id: "pedido-1",
        estado: "entregado",
        tipoServicio: "barra",
        mesaId: null,
      });
      prisma.pedido.update.mockResolvedValue({ id: "pedido-1", estado: "cobrado", items: [] });

      await service.updateEstado("pedido-1", "cobrado", TENANT);

      expect(caja.assertTurnoAbierto).toHaveBeenCalledWith(TENANT);
    });

    it("on success, tx.pedido.update data includes turnoCajaId from the open turno alongside estado cobrado", async () => {
      caja.assertTurnoAbierto.mockResolvedValue({ id: "turno-42" });
      prisma.pedido.findFirst.mockResolvedValue({
        id: "pedido-1",
        estado: "entregado",
        tipoServicio: "barra",
        mesaId: null,
      });
      prisma.pedido.update.mockResolvedValue({ id: "pedido-1", estado: "cobrado", items: [] });

      await service.updateEstado("pedido-1", "cobrado", TENANT);

      expect(prisma.pedido.update).toHaveBeenCalledWith({
        where: { id: "pedido-1" },
        data: { estado: "cobrado", turnoCajaId: "turno-42" },
        include: { items: true },
      });
    });

    it("rejects entregado -> cobrado with no open turno and persists nothing", async () => {
      caja.assertTurnoAbierto.mockRejectedValue(new BadRequestException("No hay un turno de caja abierto"));
      prisma.pedido.findFirst.mockResolvedValue({
        id: "pedido-1",
        estado: "entregado",
        tipoServicio: "barra",
        mesaId: null,
      });

      await expect(service.updateEstado("pedido-1", "cobrado", TENANT)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.pedido.update).not.toHaveBeenCalled();
    });
  });

  describe("findOne", () => {
    it("returns the Pedido with its items when it exists", async () => {
      const pedido = { id: "pedido-1", estado: "abierto", items: [] };
      prisma.pedido.findFirst.mockResolvedValue(pedido);

      const result = await service.findOne("pedido-1", TENANT);

      expect(prisma.pedido.findFirst).toHaveBeenCalledWith({
        where: { id: "pedido-1", ...TENANT },
        include: { items: true },
      });
      expect(result).toEqual(pedido);
    });

    it("maps P2025 to NotFoundException on a nonexistent id", async () => {
      prisma.pedido.findFirst.mockResolvedValue(null);

      await expect(service.findOne("missing-id", TENANT)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("findAll", () => {
    it("lists all pedidos with their items", async () => {
      const all = [{ id: "pedido-1", items: [] }, { id: "pedido-2", items: [] }];
      prisma.pedido.findMany.mockResolvedValue(all);

      const result = await service.findAll(TENANT);

      expect(prisma.pedido.findMany).toHaveBeenCalledWith({ where: TENANT, include: { items: true } });
      expect(result).toHaveLength(2);
    });
  });
});
