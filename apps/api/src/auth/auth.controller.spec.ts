import "reflect-metadata";
import { UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { JwtService } from "./jwt.service";

// Regression test for the @Public() design bug: AuthController used to have @Public()
// at the class level, which would have made switch-sucursal unauthenticated too (no
// request.user, @CurrentUser() would break). @Public() only lives on login,
// refresh, logout, and invitation acceptance, so switch-sucursal stays protected.
function buildContext(handlerName: keyof AuthController, headers: Record<string, string> = {}): ExecutionContext {
  return {
    getHandler: () => AuthController.prototype[handlerName],
    getClass: () => AuthController,
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe("AuthController @Public() scoping", () => {
  const guard = new JwtAuthGuard(new Reflector(), {} as JwtService);

  it("rejects switch-sucursal without a Bearer token", () => {
    expect(() => guard.canActivate(buildContext("switchSucursal"))).toThrow(UnauthorizedException);
  });

  it("still allows login without a Bearer token", () => {
    expect(guard.canActivate(buildContext("login"))).toBe(true);
  });

  it("still allows invitation acceptance without a Bearer token", () => {
    expect(guard.canActivate(buildContext("acceptInvitation"))).toBe(true);
  });

  it("still allows refresh without a Bearer token", () => {
    expect(guard.canActivate(buildContext("refresh"))).toBe(true);
  });

  it("still allows logout without a Bearer token", () => {
    expect(guard.canActivate(buildContext("logout"))).toBe(true);
  });
});
