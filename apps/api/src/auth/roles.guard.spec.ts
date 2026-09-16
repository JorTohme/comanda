import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { RolUsuario } from "@prisma/client";
import { Roles } from "./roles.decorator";
import { RolesGuard } from "./roles.guard";

class FakeController {
  @Roles(RolUsuario.admin, RolUsuario.mozo)
  restricted() {}

  open() {}
}

function buildContext(rol: RolUsuario, handlerName: keyof FakeController): ExecutionContext {
  return {
    getHandler: () => FakeController.prototype[handlerName],
    getClass: () => FakeController,
    switchToHttp: () => ({ getRequest: () => ({ user: { rol } }) }),
  } as unknown as ExecutionContext;
}

describe("RolesGuard", () => {
  const guard = new RolesGuard(new Reflector());

  it("allows access when no @Roles metadata is present", () => {
    expect(guard.canActivate(buildContext(RolUsuario.mozo, "open"))).toBe(true);
  });

  it("allows access when the user's role matches", () => {
    expect(guard.canActivate(buildContext(RolUsuario.admin, "restricted"))).toBe(true);
  });

  it("throws ForbiddenException when the user's role does not match", () => {
    expect(() => guard.canActivate(buildContext(RolUsuario.cocina, "restricted"))).toThrow(ForbiddenException);
  });
});
