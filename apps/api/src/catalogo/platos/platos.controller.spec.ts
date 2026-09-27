import "reflect-metadata";
import { RolUsuario } from "@prisma/client";
import { ROLES_KEY } from "../../auth/roles.decorator";
import { PlatosController } from "./platos.controller";

describe("PlatosController roles metadata", () => {
  it("reserves full dish updates for admin and availability for admin or cocina", () => {
    const roles = Reflect.getMetadata(ROLES_KEY, PlatosController.prototype.update);
    expect(roles).toEqual([RolUsuario.admin]);
    const availabilityRoles = Reflect.getMetadata(ROLES_KEY, PlatosController.prototype.updateDisponibilidad);
    expect(availabilityRoles).toEqual([RolUsuario.admin, RolUsuario.cocina]);
  });

  it("keeps create and remove admin-only", () => {
    const createRoles = Reflect.getMetadata(ROLES_KEY, PlatosController.prototype.create);
    const removeRoles = Reflect.getMetadata(ROLES_KEY, PlatosController.prototype.remove);
    expect(createRoles).toEqual([RolUsuario.admin]);
    expect(removeRoles).toEqual([RolUsuario.admin]);
  });
});
