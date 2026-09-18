import "reflect-metadata";
import { RolUsuario } from "@prisma/client";
import { ROLES_KEY } from "../auth/roles.decorator";
import { PedidosController } from "./pedidos.controller";

describe("PedidosController roles metadata", () => {
  it("allows admin, mozo and caja to create a pedido (PC ordering, not just the mozo app)", () => {
    const roles = Reflect.getMetadata(ROLES_KEY, PedidosController.prototype.create);
    expect(roles).toEqual([RolUsuario.admin, RolUsuario.mozo, RolUsuario.caja]);
  });
});
