import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { JwtClaims, TenantContext } from "./jwt.service";

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): TenantContext => {
  const { orgId, sucursalId } = context.switchToHttp().getRequest<{ user: JwtClaims }>().user;
  return { orgId, sucursalId };
});
