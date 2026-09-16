import "reflect-metadata";
import { RolUsuario } from "@prisma/client";
import { ROLES_KEY } from "../../auth/roles.decorator";
import { PlatosController } from "./platos.controller";

describe("PlatosController roles metadata", () => {
  it("allows admin and cocina to update a plato", () => {
    const roles = Reflect.getMetadata(ROLES_KEY, PlatosController.prototype.update);
    expect(roles).toEqual([RolUsuario.admin, RolUsuario.cocina]);
  });

  it("keeps create and remove admin-only", () => {
    const createRoles = Reflect.getMetadata(ROLES_KEY, PlatosController.prototype.create);
    const removeRoles = Reflect.getMetadata(ROLES_KEY, PlatosController.prototype.remove);
    expect(createRoles).toEqual([RolUsuario.admin]);
    expect(removeRoles).toEqual([RolUsuario.admin]);
  });
});
